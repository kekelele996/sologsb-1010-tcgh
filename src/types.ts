export type RuleKind = 'letter' | 'number' | 'punctuation' | 'contraction' | 'special';
export type LineStatus = 'unchecked' | 'reviewed' | 'questionable' | 'approved' | 'recheck';
export type IssueSeverity = 'error' | 'warning' | 'info';
/** 规则变更落在已批准行上的原因：原规则（匹配原文变了）、输出（盲文变了）、启停（启用/停用/新增/删除） */
export type RuleChangeReason = 'rule' | 'output' | 'enabled';

export interface TranscriptionRule {
  id: string;
  source: string;
  output: string;
  kind: RuleKind;
  enabled: boolean;
  suspicious: boolean;
  description: string;
}

/** 批准时实际用到的单条规则快照 */
export interface ApprovalRuleBasis {
  id: string;
  source: string;
  output: string;
  kind: RuleKind;
}

/** 一次批准留下的转写依据：当时的规则集、所用规则与盲文结果 */
export interface ApprovalBasis {
  approvedAt: string;
  ruleSetId: string;
  ruleSetName: string;
  braille: string;
  rules: ApprovalRuleBasis[];
}

/** 触发已批准行回到待复核的一条规则变更 */
export interface RuleChangeEntry {
  ruleId?: string;
  ruleLabel: string;
  reason: RuleChangeReason;
  detail: string;
}

/** 行上记录的复核信息：批准时结果、变化原因与发生时间 */
export interface RecheckInfo {
  previousBraille: string;
  reasons: RuleChangeEntry[];
  changedAt: string;
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
  /** 批准时保存的转写依据；非已批准/待复核状态下为空 */
  approvedBasis?: ApprovalBasis;
  /** 规则变更导致盲文变化、回到待复核时的明细 */
  recheck?: RecheckInfo;
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
