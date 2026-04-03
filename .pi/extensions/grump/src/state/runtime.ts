import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { GrumpConfig, RuntimeState } from "../domain/types.js";
import { now } from "../utils/text.js";
import { replaceTimer } from "../utils/timers.js";

export function createInitialRuntimeState(): RuntimeState {
  return {
    enabled: true,
    muted: false,
    identity: null,
    reactionText: null,
    reactionStartedAt: null,
    lastReactionAttemptAt: null,
    latestReactionRequestId: 0,
    reactionHistory: [],
    recentNominations: [],
    pendingTurnTools: [],
    pendingToolInputs: {},
    teaserShownThisSession: false,
    teaserActiveUntil: null,
    timers: {},
    editorActive: false,
    lastKnownCols: null,
    reactionBackendSummary: null,
    reactionBackendNoticeKey: null,
  };
}

export function clearTransientState(state: RuntimeState): void {
  state.reactionText = null;
  state.reactionStartedAt = null;
  state.lastReactionAttemptAt = null;
  state.reactionHistory = [];
  state.recentNominations = [];
  state.reactionBackendSummary = null;
  state.reactionBackendNoticeKey = null;
}

export function pushReactionHistory(state: RuntimeState, text: string, max = 3): void {
  state.reactionHistory.push(text);
  while (state.reactionHistory.length > max) state.reactionHistory.shift();
}

export function setReactionVisible(
  state: RuntimeState,
  ctx: ExtensionContext | ExtensionCommandContext,
  text: string,
  config: GrumpConfig,
  requestRender: (() => void) | null,
  syncUi: (ctx: ExtensionContext | ExtensionCommandContext) => void,
): void {
  state.reactionText = text;
  state.reactionStartedAt = now();
  syncUi(ctx);
  requestRender?.();
  const fadeDelay = Math.max(0, config.ui.reactionShowMs - config.ui.reactionFadeMs);
  replaceTimer(state, "reactionFade", setTimeout(() => {
    syncUi(ctx);
    requestRender?.();
  }, fadeDelay));
  replaceTimer(state, "reactionClear", setTimeout(() => {
    state.reactionText = null;
    state.reactionStartedAt = null;
    syncUi(ctx);
    requestRender?.();
  }, config.ui.reactionShowMs));
}
