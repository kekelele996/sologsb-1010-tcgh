import type {
  ApprovalBasis,
  ApprovalRuleBasis,
  BrailleToken,
  ProofIssue,
  ProjectState,
  RuleChangeEntry,
  RuleSet,
  TextbookLine,
  TranscriptionRule,
} from './types';

const LETTERS: Record<string, string> = {
  a: '⠁', b: '⠃', c: '⠉', d: '⠙', e: '⠑', f: '⠋', g: '⠛', h: '⠓', i: '⠊', j: '⠚',
  k: '⠅', l: '⠇', m: '⠍', n: '⠝', o: '⠕', p: '⠏', q: '⠟', r: '⠗', s: '⠎', t: '⠞',
  u: '⠥', v: '⠧', w: '⠺', x: '⠭', y: '⠽', z: '⠵',
};

const DEFAULT_PUNCTUATION: Record<string, string> = {
  ',': '⠂', ';': '⠆', ':': '⠒', '.': '⠲', '!': '⠖', '?': '⠦', '(': '⠐⠣', ')': '⠐⠜',
  '-': '⠤', '—': '⠠⠤', '"': '⠦', "'": '⠄', '/': '⠸⠌', '&': '⠈⠯', '@': '⠈⠁',
};

const DIGITS: Record<string, string> = {
  '0': '⠚', '1': '⠁', '2': '⠃', '3': '⠉', '4': '⠙', '5': '⠑', '6': '⠋', '7': '⠛', '8': '⠓', '9': '⠊',
};

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function activeRule(ruleSet: RuleSet, source: string, kind: TranscriptionRule['kind']): TranscriptionRule | undefined {
  return ruleSet.rules.find((rule) => rule.enabled && rule.kind === kind && rule.source.toLocaleLowerCase() === source.toLocaleLowerCase());
}

function matchContraction(ruleSet: RuleSet, source: string, index: number): TranscriptionRule | undefined {
  if (!ruleSet.contractions) return undefined;
  const before = source[index - 1] ?? '';
  if (/[\p{L}\p{N}]/u.test(before)) return undefined;

  const candidates = ruleSet.rules
    .filter((rule) => rule.enabled && rule.kind === 'contraction')
    .sort((a, b) => b.source.length - a.source.length);

  const rest = source.slice(index).toLocaleLowerCase();
  return candidates.find((rule) => rest.startsWith(rule.source.toLocaleLowerCase()));
}

function addToken(
  tokens: BrailleToken[],
  text: string,
  braille: string,
  kind: BrailleToken['kind'],
  offset: number,
  rule?: TranscriptionRule,
): void {
  tokens.push({
    id: uid('token'),
    text,
    braille,
    kind,
    ruleId: rule?.id,
    suspicious: Boolean(rule?.suspicious),
    offset,
  });
}

export function transcribeLine(source: string, ruleSet: RuleSet, continuesPrevious = false): BrailleToken[] {
  const tokens: BrailleToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const lower = char.toLocaleLowerCase();

    if (/\s/u.test(char)) {
      addToken(tokens, char, ' ', 'special', index);
      index += 1;
      continue;
    }

    const contraction = matchContraction(ruleSet, source, index);
    if (contraction) {
      addToken(tokens, source.slice(index, index + contraction.source.length), contraction.output, 'contraction', index, contraction);
      index += contraction.source.length;
      continue;
    }

    if (/\d/u.test(char)) {
      const start = index;
      let number = '';
      while (index < source.length && /\d/u.test(source[index])) {
        number += source[index];
        index += 1;
      }
      const numberRule = activeRule(ruleSet, '#', 'number');
      addToken(tokens, number, `${numberRule?.output ?? '⠼'}${[...number].map((digit) => DIGITS[digit]).join('')}`, 'number', start, numberRule);
      continue;
    }

    if (/[A-Z]/u.test(char)) {
      const capitalRule = activeRule(ruleSet, 'capital', 'special');
      addToken(tokens, char, `${capitalRule?.output ?? '⠠'}${LETTERS[lower]}`, 'letter', index, capitalRule);
      index += 1;
      continue;
    }

    if (/[a-z]/iu.test(char)) {
      const rule = activeRule(ruleSet, lower, 'letter');
      const output = rule?.output ?? LETTERS[lower] ?? '⠿';
      addToken(tokens, char, output, 'letter', index, rule);
      if (!rule) {
        addToken(tokens, '', '⟦未配置⟧', 'special', index);
      }
      index += 1;
      continue;
    }

    const punctuation = activeRule(ruleSet, char, 'punctuation') ?? activeRule(ruleSet, char.toLocaleLowerCase(), 'punctuation');
    if (punctuation) {
      addToken(tokens, char, punctuation.output, 'punctuation', index, punctuation);
      index += 1;
      continue;
    }

    const fallback = DEFAULT_PUNCTUATION[char];
    addToken(tokens, char, fallback ?? '⠿', 'punctuation', index);
    if (!fallback) addToken(tokens, '', '⟦无对应规则⟧', 'special', index);
    index += 1;
  }

  if (source.trimEnd().endsWith('-')) {
    addToken(tokens, '', ruleSet.hyphenMode === 'cross-line' ? '⠤↳' : '⠤', 'special', Math.max(0, source.length - 1));
  }

  if (continuesPrevious) {
    tokens.unshift({
      id: uid('token'),
      text: '',
      braille: '↳ ',
      kind: 'special',
      suspicious: true,
      offset: 0,
    });
  }

  return tokens;
}

export function brailleOfTokens(tokens: BrailleToken[]): string {
  return tokens.map((token) => token.braille).join('');
}

/** 从当前行实际生效的盲文单元中提取批准依据所用的规则快照 */
export function buildApprovalBasis(line: TextbookLine, ruleSet: RuleSet): ApprovalBasis {
  const used = new Map<string, ApprovalRuleBasis>();
  for (const token of line.tokens) {
    if (!token.ruleId || used.has(token.ruleId)) continue;
    const rule = ruleSet.rules.find((item) => item.id === token.ruleId);
    used.set(token.ruleId, rule
      ? { id: rule.id, source: rule.source, output: rule.output, kind: rule.kind }
      : { id: token.ruleId, source: token.text, output: token.braille, kind: token.kind });
  }
  return {
    approvedAt: new Date().toISOString(),
    ruleSetId: ruleSet.id,
    ruleSetName: ruleSet.name,
    braille: brailleOfTokens(line.tokens),
    rules: [...used.values()],
  };
}

const ruleLabel = (rule?: Pick<TranscriptionRule, 'source' | 'kind'>): string => {
  const source = rule?.source;
  if (!source) return rule?.kind === 'number' ? '数字符' : '规则';
  return source === 'capital' ? '大写符' : source;
};

/** 比对规则集前后差异，生成按 原规则/输出/启停 分类的变更条目 */
export function ruleSetChanges(previous: RuleSet, next: RuleSet): RuleChangeEntry[] {
  const changes: RuleChangeEntry[] = [];
  const before = new Map(previous.rules.map((rule) => [rule.id, rule]));
  const after = new Map(next.rules.map((rule) => [rule.id, rule]));

  for (const rule of next.rules) {
    const old = before.get(rule.id);
    if (!old) {
      if (rule.enabled) changes.push({ ruleId: rule.id, ruleLabel: ruleLabel(rule), reason: 'enabled', detail: `“${ruleLabel(rule)}”为新增并启用规则` });
      continue;
    }
    if (old.enabled !== rule.enabled) {
      changes.push({ ruleId: rule.id, ruleLabel: ruleLabel(rule), reason: 'enabled', detail: `“${ruleLabel(rule)}”已${rule.enabled ? '启用' : '停用'}` });
    }
    if (old.enabled && rule.enabled && old.source !== rule.source) {
      changes.push({ ruleId: rule.id, ruleLabel: ruleLabel(old), reason: 'rule', detail: `“${ruleLabel(old)}”的原规则改为“${ruleLabel(rule)}”` });
    }
    if (old.enabled && rule.enabled && old.output !== rule.output) {
      changes.push({ ruleId: rule.id, ruleLabel: ruleLabel(rule), reason: 'output', detail: `“${ruleLabel(rule)}”的盲文输出 ${old.output} 改为 ${rule.output}` });
    }
  }

  for (const rule of previous.rules) {
    if (!after.has(rule.id) && rule.enabled) {
      changes.push({ ruleId: rule.id, ruleLabel: ruleLabel(rule), reason: 'enabled', detail: `“${ruleLabel(rule)}”规则已删除（停用）` });
    }
  }

  if (previous.contractions !== next.contractions) {
    changes.push({ ruleId: 'setting:contractions', ruleLabel: '缩写开关', reason: 'enabled', detail: next.contractions ? '已启用词级缩写' : '已停用词级缩写' });
  }
  if (previous.hyphenMode !== next.hyphenMode) {
    changes.push({ ruleId: 'setting:hyphenMode', ruleLabel: '跨行连字符', reason: 'output', detail: '跨行连字符处理方式已调整' });
  }
  return changes;
}

function mergeReasons(existing: RuleChangeEntry[] | undefined, incoming: RuleChangeEntry[]): RuleChangeEntry[] {
  const map = new Map<string, RuleChangeEntry>();
  for (const entry of [...(existing ?? []), ...incoming]) {
    const key = `${entry.ruleId ?? entry.ruleLabel}:${entry.reason}`;
    if (!map.has(key)) map.set(key, entry);
  }
  return [...map.values()];
}

function issue(
  line: TextbookLine,
  code: string,
  message: string,
  severity: ProofIssue['severity'],
  token?: BrailleToken,
): ProofIssue {
  return {
    id: uid('issue'),
    lineId: line.id,
    tokenId: token?.id,
    ruleId: token?.ruleId,
    severity,
    code,
    message,
    resolved: false,
  };
}

function analyzeLine(line: TextbookLine, previousLine?: TextbookLine): { line: TextbookLine; issues: ProofIssue[] } {
  const issues: ProofIssue[] = [];
  const tokenText = line.tokens.map((token) => token.braille).join('');
  const hasContinuation = line.source.trimEnd().endsWith('-');
  const previousContinues = Boolean(previousLine?.source.trimEnd().endsWith('-'));
  const nextLine = {
    ...line,
    continuesPrevious: previousContinues,
    continuesNext: hasContinuation,
  };

  if (hasContinuation) {
    issues.push(issue(nextLine, 'cross-line-hyphen', '此行以连字符结尾，已插入跨行连接标记；请核对断词位置。', 'warning', nextLine.tokens.at(-1)));
  }

  for (const token of nextLine.tokens) {
    if (token.suspicious) {
      issues.push(issue(nextLine, 'suspicious-rule', `规则“${token.text}”被标记为可疑转写。`, 'warning', token));
    }
    if (token.text && token.braille.includes('⟦')) {
      issues.push(issue(nextLine, 'unknown-symbol', `“${token.text}”没有可用的转写规则。`, 'error', token));
    }
  }

  if (tokenText.replace(/\s/g, '').length > 42) {
    issues.push(issue(nextLine, 'line-too-long', `盲文结果为 ${tokenText.replace(/\s/g, '').length} 格，建议重新分词。`, 'info'));
  }

  if (hasContinuation && nextLine.source.trimEnd().split(/\s+/).at(-1)?.replace(/-$/, '').length === 1) {
    issues.push(issue(nextLine, 'orphan-fragment', '断词后仅剩一个字母，教学排版中通常应整体移到下一行。', 'warning'));
  }

  if (issues.some((item) => item.severity === 'error')) {
    nextLine.status = 'questionable';
  } else if (issues.length > 0 && nextLine.status === 'unchecked') {
    nextLine.status = 'questionable';
  }

  return { line: nextLine, issues };
}

/**
 * 按当前规则集重新转录并校对全部行。
 *
 * 传入 ruleChanges 时，对已批准行做对账：
 * - 盲文结果与批准依据一致（规则改动没影响到该行）→ 保留批准；
 * - 结果确实变化且命中本次变更的规则 → 回到 recheck 待复核，并写明 原规则/输出/启停 原因；
 * - 待复核行因规则改回而恢复原结果 → 自动恢复批准。
 * 无 ruleChanges（如载入旧草稿）时，为缺少依据的历史已批准行补齐依据。
 */
export function analyzeProject(state: ProjectState, ruleChanges: RuleChangeEntry[] = []): ProjectState {
  const ruleSet = state.ruleSets.find((item) => item.id === state.activeRuleSetId) ?? state.ruleSets[0];
  const nextLines: TextbookLine[] = [];
  const issues: ProofIssue[] = [];
  const changedAt = new Date().toISOString();

  state.lines.forEach((line, index) => {
    const previousSourceContinues = Boolean(state.lines[index - 1]?.source.trimEnd().endsWith('-'));
    const tokens = transcribeLine(line.source, ruleSet, previousSourceContinues);
    const analyzed = analyzeLine({ ...line, tokens }, state.lines[index - 1]);
    let nextLine = analyzed.line;
    const wasRecheck = line.status === 'recheck';

    if ((line.status === 'approved' || wasRecheck) && line.approvedBasis) {
      const basis = line.approvedBasis;
      const currentBraille = brailleOfTokens(tokens);
      // 命中判断要同时看批准时用过的规则和当前生效的规则：
      // 停用/删除/改原文后规则不会出现在新 token 里，但它在批准依据里；
      // 新增/启用的规则则只出现在新 token 里。
      const relevantIds = new Set<string>([
        ...tokens.map((token) => token.ruleId).filter((id): id is string => Boolean(id)),
        ...basis.rules.map((rule) => rule.id),
      ]);
      if (basis.rules.some((rule) => rule.kind === 'contraction') || tokens.some((token) => token.kind === 'contraction')) {
        relevantIds.add('setting:contractions');
      }
      if (line.source.trimEnd().endsWith('-')) relevantIds.add('setting:hyphenMode');
      const hit = ruleChanges.filter((entry) => !entry.ruleId || relevantIds.has(entry.ruleId));

      if (currentBraille === basis.braille) {
        // 结果与批准时一致：批准继续有效（含规则改回、自动恢复的情况）。
        nextLine = { ...nextLine, status: 'approved', recheck: undefined, approvedBasis: basis };
      } else if (hit.length > 0 || wasRecheck) {
        // 结果确实变化：只回退命中变更规则的行；待复核行继续累积原因。
        nextLine = {
          ...nextLine,
          status: 'recheck',
          recheck: {
            previousBraille: basis.braille,
            reasons: mergeReasons(wasRecheck ? line.recheck?.reasons : undefined, hit),
            changedAt: hit.length > 0 ? changedAt : (line.recheck?.changedAt ?? changedAt),
          },
        };
      }
      // 已批准但结果变化且未命中本次变更（理论上不该发生）：维持批准不动。
    } else if (line.status === 'approved' && ruleChanges.length === 0) {
      // 旧版本数据迁移：为没有批准依据的历史已批准行补存当前依据。
      const basis = buildApprovalBasis(analyzed.line, ruleSet);
      nextLine = { ...nextLine, status: 'approved', approvedBasis: basis };
    }

    nextLines.push(nextLine);
    issues.push(...analyzed.issues);
  });

  return {
    ...state,
    lines: nextLines,
    issues,
    lastCheckedAt: changedAt,
    updatedAt: changedAt,
  };
}

/** 规则集发生改动后的统一入口：先生成差异，再按差异重新转录对账 */
export function applyRuleSetChange(state: ProjectState, nextRuleSet: RuleSet): ProjectState {
  const previous = state.ruleSets.find((item) => item.id === nextRuleSet.id) ?? state.ruleSets[0];
  const changes = ruleSetChanges(previous, nextRuleSet);
  return analyzeProject(
    { ...state, ruleSets: state.ruleSets.map((set) => (set.id === nextRuleSet.id ? nextRuleSet : set)) },
    changes,
  );
}

/** 切换规则集：两个规则集整体对比，只回退盲文确实变化的已批准行 */
export function switchRuleSet(state: ProjectState, nextRuleSetId: string): ProjectState {
  if (nextRuleSetId === state.activeRuleSetId) return state;
  const previous = state.ruleSets.find((item) => item.id === state.activeRuleSetId) ?? state.ruleSets[0];
  const target = state.ruleSets.find((item) => item.id === nextRuleSetId) ?? state.ruleSets[0];
  const changes = ruleSetChanges(previous, target).map((entry) =>
    entry.ruleId?.startsWith('setting:') ? entry : { ...entry, detail: `切换为「${target.name}」：${entry.detail}` },
  );
  return analyzeProject({ ...state, activeRuleSetId: nextRuleSetId, issues: [] }, changes);
}

export function updateRuleInSet(ruleSet: RuleSet, ruleId: string, patch: Partial<TranscriptionRule>): RuleSet {
  return {
    ...ruleSet,
    rules: ruleSet.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
  };
}

export function makeRule(source: string, output: string, suspicious: boolean, kind: TranscriptionRule['kind'] = 'contraction'): TranscriptionRule {
  return {
    id: uid('rule'),
    source,
    output,
    kind,
    enabled: true,
    suspicious,
    description: '自定义规则',
  };
}

export function outputText(state: ProjectState): string {
  return state.lines.map((line, index) => `${String(index + 1).padStart(3, '0')}  ${line.tokens.map((token) => token.braille).join('')}`).join('\n');
}

export function brailleCellCount(state: ProjectState): number {
  return state.lines.reduce((total, line) => total + line.tokens.reduce((count, token) => count + token.braille.replace(/\s/g, '').length, 0), 0);
}
