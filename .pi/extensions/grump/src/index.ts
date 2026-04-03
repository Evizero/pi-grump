import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig, saveConfigPatch } from "./config/store.js";
import { getSelectionCompletionValues, getSelectionHelpText, makeIdentity, makeIdentityFromSelection } from "./domain/identity.js";
import type { RuntimeState, TriggerEvent, GrumpConfig } from "./domain/types.js";
import {
  AMBIENT_TOOL_CHANCE,
  getRecentContextEntries,
  inferRecentScope,
  maybeNominateTurn,
  messageMentionsGrumpName,
  nominateAssistantMessage,
} from "./generation/context.js";
import { describeReactionBackend, generateReaction } from "./generation/react.js";
import { clearTransientState, createInitialRuntimeState, pushReactionHistory, setReactionVisible } from "./state/runtime.js";
import { openGrumpCard, getCardSummaryLines, showManifestPresentation } from "./ui/card.js";
import { createGrumpEditorFactory } from "./ui/editor.js";
import { renderFallbackLines } from "./ui/widget.js";
import { highlightGrumpTriggers, isRpcMode, now } from "./utils/text.js";
import { clearTimers, replaceTimer } from "./utils/timers.js";

export default function piGrumpExtension(pi: ExtensionAPI): void {
  const state = createInitialRuntimeState();
  let config: GrumpConfig = loadConfig();
  let lastCtx: ExtensionContext | ExtensionCommandContext | null = null;
  let editorInstalled = false;
  let requestEditorRender: (() => void) | null = null;
  const publicSubcommands = ["status", "model", "whisper", "reset", "off", "on", "list", "help"] as const;

  function getPublicHelpText(): string {
    return [
      "/grump — manifest or show your grump",
      "/grump status — show current grump status",
      "/grump model — inspect or configure grump reaction model behavior",
      "/grump whisper <text> — whisper directly to grump without involving the assistant",
      "/grump off — mute grump",
      "/grump on — unmute grump",
      "/grump reset — roll a fresh grump",
      "/grump help — show this help",
    ].join("\n");
  }

  function markContext(ctx: ExtensionContext | ExtensionCommandContext): void {
    lastCtx = ctx;
  }

  function formatModelRef(model: { provider: string; id: string } | undefined): string {
    return model ? `${model.provider}/${model.id}` : "none";
  }

  function getReactionModelConfig() {
    const settings = config.commentary.reactionModel;
    return {
      mode: settings.mode,
      provider: settings.provider,
      model: settings.model,
      allowActiveModelFallback: settings.allowActiveModelFallback,
      allowLocalFallback: settings.allowLocalFallback,
    };
  }

  function getModelCommandHelp(): string {
    return [
      "/grump model — show active model, configured grump model mode, and effective backend",
      "/grump model auto — use provider-family auto selection",
      "/grump model active — always use pi's active model for grump reactions",
      "/grump model local-only — never call a model for grump reactions",
      "/grump model configured <provider> <model> — use an explicit reaction model",
    ].join("\n");
  }

  async function showModelSummary(ctx: ExtensionCommandContext): Promise<void> {
    const settings = getReactionModelConfig();
    const backendSummary = state.reactionBackendSummary ?? await describeReactionBackend(ctx as any, config);
    const lines = [
      backendSummary,
      `assistant model: ${formatModelRef(ctx.model as any)}`,
      settings.mode === "configured"
        ? `configured reaction model: ${settings.provider && settings.model ? `${settings.provider}/${settings.model}` : "none"}`
        : "configured reaction model: n/a",
      `allow active fallback: ${settings.allowActiveModelFallback ? "yes" : "no"}`,
      `allow local fallback: ${settings.allowLocalFallback ? "yes" : "no"}`,
      "",
      getModelCommandHelp(),
    ];
    ctx.ui.notify(lines.join("\n"), "info");
  }

  async function setReactionModelConfig(
    ctx: ExtensionCommandContext,
    patch: GrumpConfig["commentary"]["reactionModel"],
    message: string,
  ): Promise<void> {
    await saveConfigPatch(ctx.cwd, { commentary: { reactionModel: patch } as any });
    refreshConfig(ctx);
    state.reactionBackendSummary = await describeReactionBackend(ctx as any, config);
    ctx.ui.notify(`${message}\n${state.reactionBackendSummary}`, "info");
  }

  function supportsInteractiveTui(ctx: ExtensionContext | ExtensionCommandContext): boolean {
    return ctx.hasUI && !isRpcMode();
  }

  function refreshConfig(ctx: ExtensionContext | ExtensionCommandContext): void {
    markContext(ctx);
    config = loadConfig(ctx.cwd);
    state.enabled = config.enabled;
    state.muted = config.muted;
    state.identity = config.identity ?? null;
    if (ctx.hasUI) syncUi(ctx);
  }

  function syncAnimationTimer(ctx: ExtensionContext | ExtensionCommandContext): void {
    const shouldAnimate = ctx.hasUI && config.enabled && !!state.identity && !state.muted;
    if (!shouldAnimate) {
      replaceTimer(state, "animationTick", undefined);
      return;
    }
    if (state.timers.animationTick) return;
    replaceTimer(state, "animationTick", setInterval(() => {
      if (!lastCtx) return;
      if (editorInstalled) requestEditorRender?.();
      else syncUi(lastCtx);
    }, 180));
  }

  function shouldShowTeaser(): boolean {
    return config.ui.showTeaser && !state.identity && !!state.teaserActiveUntil && now() < state.teaserActiveUntil;
  }

  function syncUi(ctx: ExtensionContext | ExtensionCommandContext): void {
    markContext(ctx);
    if (!ctx.hasUI) return;
    state.editorActive = false;

    const shouldUseEditor = config.enabled && supportsInteractiveTui(ctx);
    if (shouldUseEditor && !editorInstalled) {
      ctx.ui.setEditorComponent(createGrumpEditorFactory(() => ({ identity: state.identity, state, config }), (fn) => { requestEditorRender = fn; }));
      editorInstalled = true;
    } else if (!shouldUseEditor && editorInstalled) {
      ctx.ui.setEditorComponent(undefined);
      requestEditorRender = null;
      editorInstalled = false;
    }

    syncAnimationTimer(ctx);

    let widget: string[] | undefined;
    if (!shouldUseEditor) {
      if (config.enabled && shouldShowTeaser()) {
        widget = [`Try ${highlightGrumpTriggers("/grump")} to manifest your grump.`];
      } else if (config.enabled && state.identity) {
        widget = renderFallbackLines(state.identity, state, config, state.lastKnownCols ?? process.stdout.columns ?? config.ui.minColsFullSprite);
      }
    }

    ctx.ui.setWidget("pi-grump", widget);
    ctx.ui.setStatus("pi-grump", undefined);
  }

  function makeNominationKey(nomination: TriggerEvent): string {
    const evidence = nomination.evidence.slice(0, 2).join(" | ");
    return `${nomination.kind} :: ${nomination.summary} :: ${evidence}`.toLowerCase();
  }

  function extractNominationContext(nomination: TriggerEvent): string {
    const contextualEvidence = nomination.evidence.find((entry) => /^(?:command|path|tool|whisper)=/i.test(entry));
    if (contextualEvidence) return contextualEvidence;
    return nomination.evidence[0] ?? nomination.summary;
  }

  function prepareNominationForEmission(nomination: TriggerEvent): { suppress: boolean; nomination: TriggerEvent } {
    const at = now();
    const suppressionWindowMs = Math.max(30_000, config.commentary.cooldownMs * 2);
    const memoryWindowMs = Math.max(120_000, config.commentary.cooldownMs * 8);
    state.recentNominations = state.recentNominations.filter((entry) => at - entry.at < memoryWindowMs);

    const key = makeNominationKey(nomination);
    const context = extractNominationContext(nomination);
    const matching = state.recentNominations.filter((entry) => entry.key === key);
    const latest = matching[matching.length - 1];
    state.recentNominations.push({ key, at, context });

    if (latest && at - latest.at < suppressionWindowMs) {
      return { suppress: true, nomination };
    }

    if (matching.length === 0) {
      return { suppress: false, nomination };
    }

    const recentContexts = [...new Set(matching.map((entry) => entry.context).filter(Boolean))].slice(-3);
    return {
      suppress: false,
      nomination: {
        ...nomination,
        evidence: [
          ...nomination.evidence,
          `repeat_count_in_window=${matching.length + 1}`,
          ...recentContexts.map((entry, index) => `repeat_context_${index + 1}=${entry}`),
        ],
      },
    };
  }

  async function emitReactionFromNomination(ctx: ExtensionContext | ExtensionCommandContext, nomination: TriggerEvent): Promise<void> {
    if (!state.identity) return;
    const prepared = prepareNominationForEmission(nomination);
    if (prepared.suppress) return;
    state.lastReactionAttemptAt = now();
    const requestId = ++state.latestReactionRequestId;
    const text = await generateReaction(ctx as ExtensionContext, state.identity, prepared.nomination, state, config);
    if (requestId !== state.latestReactionRequestId) return;
    pushReactionHistory(state, text, 3);
    setReactionVisible(state, ctx, text, config, requestEditorRender, syncUi);
  }

  function rebuildForSession(ctx: ExtensionContext): void {
    markContext(ctx);
    clearTimers(state);
    clearTransientState(state);
    state.pendingTurnTools = [];
    state.pendingToolInputs = {};
    state.teaserShownThisSession = false;
    state.teaserActiveUntil = null;
    refreshConfig(ctx);
    if (!state.identity && config.ui.showTeaser) {
      state.teaserShownThisSession = true;
      state.teaserActiveUntil = now() + config.ui.teaserTimeoutMs;
      replaceTimer(state, "teaserClear", setTimeout(() => {
        state.teaserActiveUntil = null;
        if (lastCtx) syncUi(lastCtx);
        requestEditorRender?.();
      }, config.ui.teaserTimeoutMs));
    }
    syncUi(ctx);
  }

  async function showIdentitySummary(ctx: ExtensionCommandContext, identity = state.identity): Promise<void> {
    if (!identity) {
      ctx.ui.notify("no grump yet · run /grump first", "warning");
      return;
    }
    const backendSummary = state.reactionBackendSummary ?? await describeReactionBackend(ctx as any, config);
    if (ctx.hasUI) {
      const shown = await openGrumpCard(ctx as any, state, backendSummary);
      if (shown) return;
    }
    ctx.ui.notify(getCardSummaryLines(identity, state.reactionHistory.at(-1) ?? null, backendSummary).join("\n"), "info");
  }

  async function manifestIdentity(ctx: ExtensionCommandContext, identity: NonNullable<RuntimeState["identity"]>, showPresentation: boolean): Promise<void> {
    await saveConfigPatch(ctx.cwd, { identity });
    refreshConfig(ctx);
    if (showPresentation) await showManifestPresentation(ctx as any, state);
    setReactionVisible(state, ctx, `Manifested ${identity.rarity} grump ${identity.name}.`, config, requestEditorRender, syncUi);
    await showIdentitySummary(ctx, identity);
  }

  pi.on("session_start", async (_event, ctx) => rebuildForSession(ctx));
  pi.on("session_switch", async (_event, ctx) => rebuildForSession(ctx));
  pi.on("session_fork", async (_event, ctx) => rebuildForSession(ctx));
  pi.on("session_tree", async (_event, ctx) => rebuildForSession(ctx));
  pi.on("session_compact", async (_event, ctx) => rebuildForSession(ctx));
  pi.on("session_shutdown", async (_event, ctx) => {
    markContext(ctx);
    clearTimers(state);
    clearTransientState(state);
    state.pendingTurnTools = [];
    state.pendingToolInputs = {};
    if (ctx.hasUI) {
      ctx.ui.setWidget("pi-grump", undefined);
      ctx.ui.setStatus("pi-grump", undefined);
      ctx.ui.setEditorComponent(undefined);
    }
    requestEditorRender = null;
    editorInstalled = false;
  });

  pi.on("before_agent_start", async (event, _ctx) => ({
    systemPrompt: `${event.systemPrompt}\n\nPi-Grump is a separate sidecar commentator. The assistant must not adopt Pi-Grump's persona as its own response voice.`,
  }));

  pi.on("turn_start", async (_event, ctx) => {
    state.pendingTurnTools = [];
    state.pendingToolInputs = {};
    refreshConfig(ctx);
  });

  pi.on("tool_call", async (event: any, _ctx) => {
    state.pendingToolInputs[String(event.toolCallId)] = event.input ?? event.args ?? {};
    return undefined;
  });

  pi.on("tool_execution_end", async (event: any, ctx) => {
    refreshConfig(ctx);
    state.pendingTurnTools.push({
      toolName: String(event.toolName),
      args: state.pendingToolInputs[String(event.toolCallId)] ?? event.args ?? event.input ?? {},
      result: event.result,
      isError: Boolean(event.isError),
    });
    delete state.pendingToolInputs[String(event.toolCallId)];

    if (!state.enabled || state.muted || !config.commentary.enabled || !state.identity) return;
    if (state.lastReactionAttemptAt && now() - state.lastReactionAttemptAt < config.commentary.cooldownMs) return;
    if (Math.random() >= AMBIENT_TOOL_CHANCE) return;

    await emitReactionFromNomination(ctx, {
      kind: "ambient_observation",
      score: config.commentary.minScoreToSpeak,
      summary: "Random ambient peek after tool execution",
      evidence: [`tool=${String(event.toolName)}`, "random chance"],
      source: "tool_execution_end",
      createdAt: now(),
      recentScope: inferRecentScope(getRecentContextEntries(ctx, state, config.commentary.recentMessages)),
    });
  });

  pi.on("message_end", async (event: any, ctx) => {
    refreshConfig(ctx);
    if (!state.enabled || state.muted || !config.commentary.enabled || !state.identity) return;
    const role = event?.message?.role;
    if (role !== "assistant" && role !== "user") return;
    if (state.lastReactionAttemptAt && now() - state.lastReactionAttemptAt < config.commentary.cooldownMs) return;

    const createdAt = now();
    let nomination: TriggerEvent | null = null;
    if (messageMentionsGrumpName(event?.message, state.identity)) {
      nomination = {
        kind: "name_mentioned",
        score: 5,
        summary: "Grump name mentioned in conversation",
        evidence: [`role=${role}`, `name=${state.identity.name}`],
        source: "message_end",
        createdAt,
        recentScope: inferRecentScope(getRecentContextEntries(ctx, state, config.commentary.recentMessages)),
      };
    } else if (role === "assistant") {
      nomination = nominateAssistantMessage(ctx, event?.message, state, config, createdAt);
    }

    if (!nomination) return;
    await emitReactionFromNomination(ctx, nomination);
  });

  pi.on("turn_end", async (_event, ctx) => {
    refreshConfig(ctx);
    if (!state.enabled || state.muted || !config.commentary.enabled || !state.identity) {
      syncUi(ctx);
      return;
    }
    const nomination = maybeNominateTurn(ctx, state, config, now());
    if (!nomination) {
      syncUi(ctx);
      return;
    }
    await emitReactionFromNomination(ctx, nomination);
  });

  pi.registerCommand("grump", {
    description: "Show or interact with your grump",
    getArgumentCompletions(prefix) {
      const rawPrefix = prefix ?? "";
      const normalized = rawPrefix.trim().toLowerCase();
      if (normalized.startsWith("set ")) {
        const selectionPrefix = normalized.slice(4).trim();
        const values = getSelectionCompletionValues()
          .filter((value, index, list) => list.indexOf(value) === index)
          .filter((value) => value.startsWith(selectionPrefix))
          .map((value) => ({ value: `set ${value}`, label: value }));
        return values.length > 0 ? values : null;
      }
      if (normalized.startsWith("model configured ")) {
        const configuredPrefix = normalized.slice("model configured ".length);
        const parts = configuredPrefix.split(/\s+/).filter(Boolean);
        if (parts.length <= 1) {
          const providerPrefix = parts[0] ?? "";
          const providers = ["anthropic", "openai", "openai-codex", "google", "google-gemini-cli", "google-vertex", "azure-openai-responses"]
            .filter((value) => value.startsWith(providerPrefix))
            .map((value) => ({ value: `model configured ${value}`, label: value }));
          return providers.length > 0 ? providers : null;
        }
      }
      if (normalized.startsWith("model ")) {
        const modelPrefix = normalized.slice(6);
        const values = ["auto", "active", "local-only", "configured", "help"]
          .filter((value) => value.startsWith(modelPrefix))
          .map((value) => ({ value: `model ${value}`, label: value }));
        return values.length > 0 ? values : null;
      }
      const values = publicSubcommands
        .filter((value) => value.startsWith(normalized))
        .map((value) => ({ value, label: value }));
      return values.length > 0 ? values : null;
    },
    handler: async (args, ctx) => {
      markContext(ctx);
      refreshConfig(ctx);
      const rawArgs = (args || "").trim();
      const [subcommand = "", ...restParts] = rawArgs.split(/\s+/).filter(Boolean);
      const sub = subcommand.toLowerCase();
      const subArgs = restParts.join(" ");

      if (sub === "off") {
        state.muted = true;
        await saveConfigPatch(ctx.cwd, { muted: true });
        refreshConfig(ctx);
        ctx.ui.notify("grump muted", "info");
        return;
      }
      if (sub === "on") {
        state.muted = false;
        await saveConfigPatch(ctx.cwd, { muted: false, enabled: true });
        refreshConfig(ctx);
        ctx.ui.notify("grump unmuted", "info");
        return;
      }
      if (sub === "list" || sub === "help") {
        ctx.ui.notify(getPublicHelpText(), "info");
        return;
      }
      if (sub === "model") {
        const modelArgs = subArgs.trim();
        if (!modelArgs || modelArgs === "status" || modelArgs === "show" || modelArgs === "help") {
          await showModelSummary(ctx);
          return;
        }
        if (modelArgs === "auto") {
          await setReactionModelConfig(ctx, {
            mode: "auto",
            provider: undefined,
            model: undefined,
            allowActiveModelFallback: true,
            allowLocalFallback: true,
          }, "pi-grump reaction model set to auto");
          return;
        }
        if (modelArgs === "active") {
          await setReactionModelConfig(ctx, {
            mode: "active",
            provider: undefined,
            model: undefined,
            allowActiveModelFallback: true,
            allowLocalFallback: true,
          }, "pi-grump reaction model set to active");
          return;
        }
        if (modelArgs === "local-only") {
          await setReactionModelConfig(ctx, {
            mode: "local-only",
            provider: undefined,
            model: undefined,
            allowActiveModelFallback: false,
            allowLocalFallback: true,
          }, "pi-grump reaction model set to local-only");
          return;
        }
        if (modelArgs.startsWith("configured ")) {
          const configuredRest = modelArgs.slice("configured ".length).trim();
          const [provider = "", ...modelRest] = configuredRest.split(/\s+/).filter(Boolean);
          const model = modelRest.join(" ");
          if (!provider || !model) {
            ctx.ui.notify(`usage: /grump model configured <provider> <model>\n\n${getModelCommandHelp()}`, "warning");
            return;
          }
          await setReactionModelConfig(ctx, {
            mode: "configured",
            provider,
            model,
            allowActiveModelFallback: true,
            allowLocalFallback: true,
          }, `pi-grump reaction model set to configured ${provider}/${model}`);
          return;
        }
        ctx.ui.notify(`unknown /grump model command: ${modelArgs}\n\n${getModelCommandHelp()}`, "warning");
        return;
      }
      if (!config.enabled && sub !== "on") {
        ctx.ui.notify("grump disabled", "warning");
        return;
      }
      if (sub === "reset") {
        await manifestIdentity(ctx, makeIdentity(), true);
        return;
      }
      if (sub === "set") {
        if (!subArgs) {
          ctx.ui.notify(getSelectionHelpText(), "warning");
          return;
        }
        const selectedIdentity = makeIdentityFromSelection(subArgs);
        if (!selectedIdentity) {
          ctx.ui.notify(`unknown grump debug selection: ${subArgs}\n\n${getSelectionHelpText()}`, "warning");
          return;
        }
        await manifestIdentity(ctx, selectedIdentity, !state.identity);
        return;
      }
      if (sub === "whisper") {
        if (!state.identity) {
          ctx.ui.notify("no grump yet · run /grump first", "warning");
          return;
        }
        const whisperText = subArgs.trim() || "You there?";
        const nomination: TriggerEvent = {
          kind: "whisper",
          score: 99,
          summary: "Manual whisper to grump",
          evidence: [`whisper=${whisperText}`],
          source: "command",
          createdAt: now(),
          recentScope: whisperText.length < 40 ? "small" : whisperText.length < 140 ? "medium" : "large",
        };
        const text = await generateReaction(ctx as any, state.identity, nomination, state, config);
        pushReactionHistory(state, text, 3);
        setReactionVisible(state, ctx, text, config, requestEditorRender, syncUi);
        if (!ctx.hasUI) ctx.ui.notify(text, "info");
        return;
      }

      if (!rawArgs && !state.identity) {
        await manifestIdentity(ctx, makeIdentity(), true);
        return;
      }
      if (sub === "status") {
        await showIdentitySummary(ctx);
        return;
      }
      if (sub) {
        ctx.ui.notify(`unknown grump command: ${args}\n\n${getPublicHelpText()}`, "warning");
        return;
      }
      await showIdentitySummary(ctx);
    },
  });
}
