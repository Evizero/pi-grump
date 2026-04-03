export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";
export type TriggerKind =
  | "large_change"
  | "structural_change"
  | "sensitive_material"
  | "risky_command"
  | "tool_failure"
  | "simplification"
  | "ambient_observation"
  | "name_mentioned"
  | "long_assistant_message"
  | "whisper";
export type StatName = "GRUMP" | "WIT" | "YAGNI" | "OBSERVABILITY" | "DISCIPLINE" | "CRAFT" | "PARANOIA";
export type LegendaryId = "gramps" | "pi";
export type Stats = Record<StatName, number>;
export type RecentScope = "small" | "medium" | "large" | "unclear";

export interface GrumpIdentity {
  rarity: Rarity;
  legendaryId?: LegendaryId;
  name: string;
  spriteVariant: string;
  stats: Stats;
}

export interface TriggerEvent {
  kind: TriggerKind;
  score: number;
  summary: string;
  evidence: string[];
  source: string;
  createdAt: number;
  recentScope: RecentScope;
}

export interface ToolRecord {
  toolName: string;
  args: any;
  result: any;
  isError: boolean;
}

export interface RuntimeTimers {
  reactionFade?: NodeJS.Timeout;
  reactionClear?: NodeJS.Timeout;
  teaserClear?: NodeJS.Timeout;
  animationTick?: NodeJS.Timeout;
  manifestFrame?: NodeJS.Timeout;
}

export interface RuntimeState {
  enabled: boolean;
  muted: boolean;
  identity: GrumpIdentity | null;
  reactionText: string | null;
  reactionStartedAt: number | null;
  lastReactionAttemptAt: number | null;
  latestReactionRequestId: number;
  reactionHistory: string[];
  recentNominations: Array<{ key: string; at: number; context: string }>;
  pendingTurnTools: ToolRecord[];
  pendingToolInputs: Record<string, any>;
  teaserShownThisSession: boolean;
  teaserActiveUntil: number | null;
  timers: RuntimeTimers;
  editorActive: boolean;
  lastKnownCols: number | null;
  reactionBackendSummary: string | null;
  reactionBackendNoticeKey: string | null;
}

export type ReactionModelMode = "auto" | "configured" | "active" | "local-only";

export interface GrumpConfig {
  enabled: boolean;
  muted: boolean;
  commentary: {
    enabled: boolean;
    cooldownMs: number;
    maxContextChars: number;
    maxOutputChars: number;
    minScoreToSpeak: number;
    recentMessages: number;
    reactionModel: {
      mode: ReactionModelMode;
      provider?: string;
      model?: string;
      allowActiveModelFallback: boolean;
      allowLocalFallback: boolean;
    };
  };
  ui: {
    showTeaser: boolean;
    reactionShowMs: number;
    reactionFadeMs: number;
    teaserTimeoutMs: number;
    minColsFullSprite: number;
  };
  identity?: GrumpIdentity;
}

export interface GrumpPresentation {
  laneLines: string[];
  laneWidth: number;
  bubbleLines: string[];
  bubbleWidth: number;
  bubbleTailRow: number;
  laneAnchorRow: number;
  compact: boolean;
}
