import type { GrumpConfig } from "../domain/types.js";

export const DEFAULT_CONFIG: GrumpConfig = {
  enabled: true,
  muted: false,
  commentary: {
    enabled: true,
    cooldownMs: 10_000,
    maxContextChars: 12_000,
    maxOutputChars: 140,
    minScoreToSpeak: 4,
    recentMessages: 6,
    reactionModel: {
      mode: "auto",
      allowActiveModelFallback: true,
      allowLocalFallback: true,
    },
  },
  ui: {
    showTeaser: true,
    reactionShowMs: 10_000,
    reactionFadeMs: 3_000,
    teaserTimeoutMs: 15_000,
    minColsFullSprite: 100,
  },
};
