import type {
  ApprovalBasis,
  BrailleToken,
  ProofIssue,
  ProjectState,
  RecheckReason,
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

export function brailleOfTokens(tokens: BrailleToken[]): string {
  return tokens.map((token) => token.braille).join('');
}

/** 捕获批准一行时的转写依据：规则集设置、实际用到的规则快照和当时盲文结果 */
export function captureApprovalBasis(line: TextbookLine, ruleSet: RuleSet): ApprovalBasis {
  const usedRuleMap = new Map<string, TranscriptionRule>();
  for (const token of line.tokens) {
    if (token.ruleId) {
      const rule = ruleSet.rules.find((item) => item.id === token.ruleId);
      if (rule && !usedRuleMap.has(rule.id)) usedRuleMap.set(rule.id, rule);
    }
  }
  return {
    ruleSetId: ruleSet.id,
    contractions: ruleSet.contractions,
    hyphenMode: ruleSet.hyphenMode,
    source: line.source,
    braille: brailleOfTokens(line.tokens),
    usedRules: [...usedRuleMap.values()].map((rule) => ({
      id: rule.id,
      source: rule.source,
      output: rule.output,
      enabled: rule.enabled,
    })),
    continuesPrevious: line.continuesPrevious,
    approvedAt: new Date().toISOString(),
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
    if (nextLine.status !== 'approved' && nextLine.status !== 'recheck') nextLine.status = 'questionable';
  } else if (issues.length > 0 && nextLine.status === 'unchecked') {
    nextLine.status = 'questionable';
  }

  return { line: nextLine, issues };
}

/** 比对批准依据与当前规则集，给出打回复核的原因类别和涉及规则 */
function classifyRuleDrift(
  basis: ApprovalBasis,
  currentSet: RuleSet,
  currentTokens: BrailleToken[],
): { reasons: RecheckReason[]; ruleIds: string[] } {
  const reasons = new Set<RecheckReason>();
  const ruleIds = new Set<string>();
  const recorded = new Map(basis.usedRules.map((rule) => [rule.id, rule]));

  // 逐规则比对批准快照与当前规则：停用/启用、原文（匹配方式）、输出
  for (const oldRule of basis.usedRules) {
    const currentRule = currentSet.rules.find((rule) => rule.id === oldRule.id);
    if (!currentRule) {
      // 规则被删除，匹配方式不再相同
      reasons.add('source-rule');
      ruleIds.add(oldRule.id);
      continue;
    }
    if (currentRule.enabled !== oldRule.enabled) {
      reasons.add('toggle');
      ruleIds.add(currentRule.id);
    }
    if (currentRule.source !== oldRule.source) {
      reasons.add('source-rule');
      ruleIds.add(currentRule.id);
    }
    if (currentRule.output !== oldRule.output) {
      reasons.add('output');
      ruleIds.add(currentRule.id);
    }
  }

  // 当前行用到、但批准快照里没有的规则：新规则开始参与或新启用的规则
  for (const token of currentTokens) {
    if (!token.ruleId) continue;
    if (!recorded.has(token.ruleId)) {
      const currentRule = currentSet.rules.find((rule) => rule.id === token.ruleId);
      if (!currentRule) continue;
      if (currentRule.kind === 'contraction') {
        reasons.add('toggle');
      } else {
        reasons.add('source-rule');
      }
      ruleIds.add(currentRule.id);
    }
  }

  // 缩写总开关变化：影响缩写规则是否参与转写
  if (currentSet.contractions !== basis.contractions) {
    reasons.add('toggle');
    currentSet.rules
      .filter((rule) => rule.kind === 'contraction')
      .forEach((rule) => ruleIds.add(rule.id));
  }

  // 跨行连字符模式变化：影响行尾连字符的输出
  if (currentSet.hyphenMode !== basis.hyphenMode) {
    reasons.add('output');
  }

  return { reasons: [...reasons], ruleIds: [...ruleIds] };
}

/**
 * 重新转录后复核批准状态：
 * - 盲文结果与批准时完全一致的行继续保留批准；
 * - 结果确实变化的已批准/待复核行回到待复核，并写明是原规则、输出、启停还是原文变化；
 * - 待复核行若结果回到与批准依据一致，自动恢复批准。
 */
function revalidateApprovals(
  state: ProjectState,
  lines: TextbookLine[],
  issues: ProofIssue[],
): { lines: TextbookLine[]; issues: ProofIssue[] } {
  const currentSet = state.ruleSets.find((item) => item.id === state.activeRuleSetId) ?? state.ruleSets[0];

  const nextLines = lines.map((line) => {
    const basis = line.approvalBasis;
    if (!basis || (line.status !== 'approved' && line.status !== 'recheck')) return line;

    const currentBraille = brailleOfTokens(line.tokens);
    const sameText = line.source === basis.source && line.continuesPrevious === basis.continuesPrevious;

    // 结果与批准依据一致：继续批准（含待复核行恢复批准的情况）
    if (sameText && currentBraille === basis.braille) {
      return { ...line, status: 'approved' as const, recheckReasons: undefined, recheckRuleIds: undefined, recheckAt: undefined };
    }

    const reasons = new Set<RecheckReason>();
    const ruleIds = new Set<string>();

    if (!sameText) {
      // 原文或跨行接续关系被直接编辑
      reasons.add('source-text');
    }

    if (currentBraille !== basis.braille) {
      const drift = classifyRuleDrift(basis, currentSet, line.tokens);
      drift.reasons.forEach((reason) => reasons.add(reason));
      drift.ruleIds.forEach((id) => ruleIds.add(id));
    }

    return {
      ...line,
      status: 'recheck' as const,
      recheckReasons: [...reasons],
      recheckRuleIds: [...ruleIds],
      recheckAt: line.status === 'recheck' ? (line.recheckAt ?? new Date().toISOString()) : new Date().toISOString(),
    };
  });

  // 保留批准的行，其旧问题不再挂账；待复核行的问题保持未解决等待处理
  const approvedIds = new Set(nextLines.filter((line) => line.status === 'approved' && line.approvalBasis).map((line) => line.id));
  const nextIssues = issues.map((item) => (approvedIds.has(item.lineId) ? { ...item, resolved: true } : item));

  return { lines: nextLines, issues: nextIssues };
}

export function analyzeProject(state: ProjectState): ProjectState {
  const ruleSet = state.ruleSets.find((item) => item.id === state.activeRuleSetId) ?? state.ruleSets[0];
  const transcribedLines: TextbookLine[] = [];
  const issues: ProofIssue[] = [];

  state.lines.forEach((line, index) => {
    const previousSourceContinues = Boolean(state.lines[index - 1]?.source.trimEnd().endsWith('-'));
    const tokens = transcribeLine(line.source, ruleSet, previousSourceContinues);
    const analyzed = analyzeLine({ ...line, tokens }, state.lines[index - 1]);
    transcribedLines.push(analyzed.line);
    issues.push(...analyzed.issues);
  });

  const revalidated = revalidateApprovals(state, transcribedLines, issues);

  return {
    ...state,
    lines: revalidated.lines,
    issues: revalidated.issues,
    lastCheckedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
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
