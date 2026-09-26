export type RuleKind = 'letter' | 'number' | 'punctuation' | 'contraction' | 'special';
export type LineStatus = 'unchecked' | 'reviewed' | 'questionable' | 'approved' | 'recheck';
export type IssueSeverity = 'error' | 'warning' | 'info';
/** 已批准行被打回复核的原因类别 */
export type RecheckReason = 'source-rule' | 'output' | 'toggle' | 'source-text';

/** 批准一行时留存的转写依据，用于规则变更后判断盲文结果是否真的变化 */
export interface ApprovalBasis {
  /** 批准时所在规则集 */
  ruleSetId: string;
  /** 批准时规则集的缩写总开关 */
  contractions: boolean;
  /** 批准时规则集的跨行连字符模式 */
  hyphenMode: RuleSet['hyphenMode'];
  /** 批准时的原文 */
  source: string;
  /** 批准时的盲文结果 */
  braille: string;
  /** 批准该行时实际用到的规则：id、原文、输出、是否启用 */
  usedRules: Array<{ id: string; source: string; output: string; enabled: boolean }>;
  /** 批准时该行是否接续上一行（跨行连字符） */
  continuesPrevious: boolean;
  /** 批准时间 */
  approvedAt: string;
}

export interface TranscriptionRule {
  id: string;
  source: string;
  output: string;
  kind: RuleKind;
  enabled: boolean;
  suspicious: boolean;
  description: string;
}

export interface RuleSet {
  id: string;
  name: string;
  description: string;
  contractions: boolean;
  hyphenMode: 'cross-line' | 'inline';
  rules: TranscriptionRule[];
}

export interface BrailleToken {
  id: string;
  text: string;
  braille: string;
  kind: RuleKind;
  ruleId?: string;
  suspicious: boolean;
  offset: number;
}

export interface TextbookLine {
  id: string;
  source: string;
  tokens: BrailleToken[];
  status: LineStatus;
  note: string;
  continuesPrevious: boolean;
  continuesNext: boolean;
  /** 最近一次批准时的转写依据；打回复核后保留以便对照 */
  approvalBasis?: ApprovalBasis;
  /** 待复核原因类别 */
  recheckReasons?: RecheckReason[];
  /** 待复核涉及的规则 id（原文编辑时可能为空） */
  recheckRuleIds?: string[];
  /** 进入待复核的时间 */
  recheckAt?: string;
}

export interface ProofIssue {
  id: string;
  lineId: string;
  tokenId?: string;
  ruleId?: string;
  severity: IssueSeverity;
  code: string;
  message: string;
  resolved: boolean;
}

export interface VersionSnapshot {
  id: string;
  name: string;
  createdAt: string;
  action: string;
  snapshot: Omit<ProjectState, 'versions'>;
}

export interface ProjectState {
  id: string;
  title: string;
  author: string;
  activeRuleSetId: string;
  ruleSets: RuleSet[];
  lines: TextbookLine[];
  selectedLineId: string;
  issues: ProofIssue[];
  versions: VersionSnapshot[];
  lastCheckedAt: string;
  updatedAt: string;
}

export interface HistoryState {
  past: ProjectState[];
  present: ProjectState;
  future: ProjectState[];
  lastAction: string;
}
