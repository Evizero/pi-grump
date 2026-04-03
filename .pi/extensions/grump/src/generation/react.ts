import { complete } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadPrompt } from "../config/store.js";
import { getDominantStats, statMeaning } from "../domain/identity.js";
import type { GrumpConfig, GrumpIdentity, RuntimeState, TriggerEvent } from "../domain/types.js";
import { buildCodeGlances, buildFocusGuidance, getLatestMessageByRole } from "./context.js";
import { anonymizeSensitiveText, getMessageText, stringifyData, truncate } from "../utils/text.js";

function getLegendaryAddendum(identity: GrumpIdentity): string {
  if (identity.legendaryId === "gramps") return "Founder-coded legendary addendum: obvious anti-slop archwizard energy. Prefer sharper YAGNI complaints, file-backed observability jabs, and old-maintainer disgust when justified.";
  if (identity.legendaryId === "pi") return "Pi legendary addendum: literally pi-shaped, more austere and symbolic. Prefer colder minimalism and cleaner anti-ceremony judgment when justified.";
  return "";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, content: string, attrs?: Record<string, string | number | boolean | undefined>): string {
  const attrText = Object.entries(attrs ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");
  return `<${name}${attrText}>${escapeXml(content)}</${name}>`;
}

function buildConversationXml(ctx: ExtensionContext, count: number): string {
  const branch = ctx.sessionManager.getBranch() as any[];
  const messages = branch
    .filter((entry: any) => entry?.type === "message")
    .map((entry: any) => entry.message)
    .slice(-count);

  const lines = messages.map((message: any) => {
    const text = truncate(anonymizeSensitiveText(getMessageText(message)), 1200);
    if (!text) return "";
    switch (message?.role) {
      case "user":
        return tag("user", text);
      case "assistant":
        return tag("assistant", text);
      case "toolResult":
        return tag("tool_result", text, { tool: message?.toolName ?? undefined });
      case "bashExecution":
        return tag("bash", text);
      default:
        return tag("message", text, { role: message?.role ?? "unknown" });
    }
  }).filter(Boolean);

  return `<conversation last_n="${count}">\n${lines.join("\n")}\n</conversation>`;
}

function buildCurrentTurnToolsXml(state: RuntimeState): string {
  if (!state.pendingTurnTools.length) return "<current_turn_tools count=\"0\"></current_turn_tools>";
  const tools = state.pendingTurnTools.map((tool) => {
    const args = truncate(stringifyData(tool.args), 900);
    const result = truncate(stringifyData(tool.result), 900);
    return [
      `<tool_call name="${escapeXml(tool.toolName)}" error="${tool.isError ? "yes" : "no"}">`,
      tag("args", args || "none"),
      tag("result", result || "none"),
      `</tool_call>`,
    ].join("\n");
  });
  return `<current_turn_tools count="${state.pendingTurnTools.length}">\n${tools.join("\n")}\n</current_turn_tools>`;
}

function buildCodeGlancesXml(state: RuntimeState): string {
  const glances = buildCodeGlances(state);
  if (!glances.length) return "<code_glances count=\"0\"></code_glances>";
  return `<code_glances count="${glances.length}">\n${glances.map((entry) => tag("glance", entry)).join("\n")}\n</code_glances>`;
}

function buildFocusGuidanceXml(ctx: ExtensionContext, state: RuntimeState, nomination: TriggerEvent): string {
  const guidance = buildFocusGuidance(ctx, state, nomination);
  return `<focus_guidance count="${guidance.length}">\n${guidance.map((entry) => tag("point", entry)).join("\n")}\n</focus_guidance>`;
}

function buildRecentReactionsXml(state: RuntimeState): string {
  const reactions = state.reactionHistory.slice(-3);
  return `<recent_reactions last_n="3">\n${reactions.map((entry) => tag("reaction", entry)).join("\n")}\n</recent_reactions>`;
}

function buildStyleAnchorsXml(): string {
  const anchors = loadPrompt("style-anchors.md").trim();
  return anchors
    ? `<style-anchors format="markdown">\n${escapeXml(anchors)}\n</style-anchors>`
    : '<style-anchors format="markdown"></style-anchors>';
}

function buildContextPrompt(ctx: ExtensionContext, identity: GrumpIdentity, nomination: TriggerEvent, state: RuntimeState, config: GrumpConfig): string {
  const dominant = getDominantStats(identity.stats)
    .map(([name, value]) => `<trait name="${escapeXml(name)}" value="${value}">${escapeXml(statMeaning(name))}</trait>`)
    .join("\n");
  const latestAssistant = getLatestMessageByRole(ctx, "assistant");
  return truncate([
    "<grump_reaction_context>",
    `<grump_profile rarity="${escapeXml(identity.rarity)}" name="${escapeXml(identity.name)}" legendary="${escapeXml(identity.legendaryId ?? "none")}">`,
    dominant,
    getLegendaryAddendum(identity) ? tag("legendary_addendum", getLegendaryAddendum(identity)) : "",
    "</grump_profile>",
    `<turn_nomination kind="${escapeXml(nomination.kind)}" recent_scope="${escapeXml(nomination.recentScope)}" score="${nomination.score}">`,
    tag("summary", nomination.summary),
    `<evidence count="${nomination.evidence.length}">\n${nomination.evidence.map((entry) => tag("item", entry)).join("\n")}\n</evidence>`,
    "</turn_nomination>",
    buildConversationXml(ctx, config.commentary.recentMessages),
    latestAssistant ? `<latest_assistant_message>${escapeXml(truncate(latestAssistant, 2200))}</latest_assistant_message>` : "<latest_assistant_message></latest_assistant_message>",
    buildCurrentTurnToolsXml(state),
    buildCodeGlancesXml(state),
    buildFocusGuidanceXml(ctx, state, nomination),
    buildStyleAnchorsXml(),
    buildRecentReactionsXml(state),
    "<instructions>",
    escapeXml("Think silently about two things: (1) what the actual take is here, and (2) how to say it in one short approachable grumpy line. If there is code, prefer reacting to the code itself. If there is a strong assistant opinion or plan, react to that substance. If the most obvious angle seems ambiguous, hidden from the user, or maybe based on a false alarm, drop it and use a smaller generic in-character reaction instead. If there is no sharp judgment, still produce a tiny contextual in-character reaction like *blinks twice*, *nods once*, *clenches jaw*, or Hrmph. Do not mention triggers, detectors, nominations, events, heuristics, false positives, or that you were invoked by a system. React as if you simply noticed the moment."),
    "</instructions>",
    "</grump_reaction_context>",
  ].filter(Boolean).join("\n"), config.commentary.maxContextChars);
}

export function __test_sanitizeReactionText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/[—–]/g, "-")
    .replace(/^[\s>*-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function __test_shouldDiscardModelReaction(text: string, nomination: TriggerEvent): boolean {
  if (!text) return true;
  if (/\b(?:false positive|detector|heuristic|trigger(?:ed)?|classifier|nomination|invoked|activated by|event fired)\b/i.test(text)) {
    return true;
  }
  if (nomination.kind === "sensitive_material" && /\b(?:placeholder|sample|example|dummy|mock|fake|not real|probably not|looks fake|redacted)\b/i.test(text)) {
    return true;
  }
  return false;
}

type ReactionBackendResolution = {
  summary: string;
  model?: any;
  auth?: { apiKey?: string; headers?: Record<string, string> };
  noticeKey?: string;
  noticeLevel?: "info" | "warning";
  noticeText?: string;
};

function getReactionModelSettings(config: GrumpConfig) {
  const raw = (config.commentary as any)?.reactionModel ?? {};
  const mode = raw.mode === "configured" || raw.mode === "active" || raw.mode === "local-only" ? raw.mode : "auto";
  return {
    mode,
    provider: typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim() : undefined,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : undefined,
    allowActiveModelFallback: raw.allowActiveModelFallback !== false,
    allowLocalFallback: raw.allowLocalFallback !== false,
  } as const;
}

function formatModelRef(model: { provider: string; id: string } | undefined): string {
  return model ? `${model.provider}/${model.id}` : "none";
}

function dedupeModelRefs(refs: Array<{ provider: string; model: string }>): Array<{ provider: string; model: string }> {
  const seen = new Set<string>();
  const out: Array<{ provider: string; model: string }> = [];
  for (const ref of refs) {
    const key = `${ref.provider}/${ref.model}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function getAutoModelCandidates(ctx: ExtensionContext): Array<{ provider: string; model: string }> {
  const activeProvider = String((ctx.model as any)?.provider ?? "").toLowerCase();
  if (activeProvider === "anthropic") {
    return [{ provider: "anthropic", model: "claude-haiku-4-5" }];
  }
  if (activeProvider === "openai" || activeProvider === "openai-codex") {
    return dedupeModelRefs([
      { provider: activeProvider, model: "gpt-5.4-mini" },
      { provider: "openai", model: "gpt-5.4-mini" },
      { provider: "openai-codex", model: "gpt-5.4-mini" },
    ]);
  }
  if (activeProvider === "azure-openai-responses") {
    return dedupeModelRefs([
      { provider: "azure-openai-responses", model: "gpt-5.4-mini" },
      { provider: "openai", model: "gpt-5.4-mini" },
      { provider: "openai-codex", model: "gpt-5.4-mini" },
    ]);
  }
  if (activeProvider.startsWith("google")) {
    return dedupeModelRefs([
      { provider: activeProvider, model: "gemini-2.5-flash" },
      { provider: "google", model: "gemini-2.5-flash" },
      { provider: "google-gemini-cli", model: "gemini-2.5-flash" },
      { provider: "google-vertex", model: "gemini-2.5-flash" },
    ]);
  }
  return [];
}

async function findUsableModel(ctx: ExtensionContext, refs: Array<{ provider: string; model: string }>) {
  const attempted: string[] = [];
  for (const ref of refs) {
    const found = ctx.modelRegistry.find(ref.provider, ref.model);
    if (!found) {
      attempted.push(`${ref.provider}/${ref.model} missing`);
      continue;
    }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(found);
    if (auth.ok) return { model: found, auth, attempted };
    attempted.push(`${ref.provider}/${ref.model} auth unavailable`);
  }
  return { attempted };
}

async function resolveReactionBackend(ctx: ExtensionContext, config: GrumpConfig): Promise<ReactionBackendResolution> {
  const settings = getReactionModelSettings(config);
  const activeModel = ctx.model as any | undefined;

  if (settings.mode === "local-only") {
    return { summary: "grump mode: local-only" };
  }

  if (settings.mode === "active") {
    if (activeModel) {
      const activeAuth = await ctx.modelRegistry.getApiKeyAndHeaders(activeModel);
      if (activeAuth.ok) {
        return {
          summary: `grump mode: active (${formatModelRef(activeModel)})`,
          model: activeModel,
          auth: activeAuth,
        };
      }
    }
    return {
      summary: "grump mode: active (local fallback)",
      noticeKey: "reaction-backend:active-unavailable",
      noticeLevel: "warning",
      noticeText: "pi-grump reaction model unavailable on the active model; using local fallback comments.",
    };
  }

  const requestedRefs = settings.mode === "configured"
    ? (settings.provider && settings.model ? [{ provider: settings.provider, model: settings.model }] : [])
    : getAutoModelCandidates(ctx);

  const lookup = await findUsableModel(ctx, requestedRefs);
  if (lookup.model && lookup.auth) {
    const separate = formatModelRef(lookup.model);
    const isSeparateFromActive = separate !== formatModelRef(activeModel);
    return {
      summary: `grump mode: ${settings.mode} (${separate})`,
      model: lookup.model,
      auth: lookup.auth,
      noticeKey: isSeparateFromActive ? `reaction-backend:override:${separate}:${settings.mode}` : undefined,
      noticeLevel: isSeparateFromActive ? "info" : undefined,
      noticeText: isSeparateFromActive ? `pi-grump reactions are using a separate model override: ${separate} (${settings.mode}).` : undefined,
    };
  }

  if (settings.allowActiveModelFallback && activeModel) {
    const activeAuth = await ctx.modelRegistry.getApiKeyAndHeaders(activeModel);
    if (activeAuth.ok) {
      const reason = requestedRefs.length > 0 ? lookup.attempted.join("; ") : settings.mode === "configured" ? "configured override incomplete" : "no auto override mapped";
      return {
        summary: `grump mode: ${settings.mode} (active fallback: ${formatModelRef(activeModel)})`,
        model: activeModel,
        auth: activeAuth,
        noticeKey: `reaction-backend:active-fallback:${formatModelRef(activeModel)}:${reason}`,
        noticeLevel: "warning",
        noticeText: `pi-grump reaction override unavailable (${reason}); using active model ${formatModelRef(activeModel)}.`,
      };
    }
  }

  if (settings.allowLocalFallback || true) {
    const reason = requestedRefs.length > 0 ? lookup.attempted.join("; ") : settings.mode === "configured" ? "configured override incomplete" : "no auto override mapped";
    return {
      summary: `grump mode: ${settings.mode} (local fallback)`,
      noticeKey: `reaction-backend:local-fallback:${reason}`,
      noticeLevel: "warning",
      noticeText: `pi-grump has no usable reaction model (${reason}); using local fallback comments.`,
    };
  }

  return { summary: `grump mode: ${settings.mode} (local fallback)` };
}

export async function describeReactionBackend(ctx: ExtensionContext, config: GrumpConfig): Promise<string> {
  const resolved = await resolveReactionBackend(ctx, config);
  return resolved.summary;
}

function normalizeReactionForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isTooSimilarToRecent(text: string, recent: string[]): boolean {
  const normalized = normalizeReactionForComparison(text);
  if (!normalized) return false;
  return recent.some((entry) => normalizeReactionForComparison(entry) === normalized);
}

function pickVariant(candidates: string[], recent: string[]): string {
  const filtered = candidates.filter((candidate) => !isTooSimilarToRecent(candidate, recent));
  return filtered[0] ?? candidates[0] ?? "Hrmph.";
}

function fallbackComment(identity: GrumpIdentity, nomination: TriggerEvent, recent: string[] = []): string {
  const paranoia = identity.stats.PARANOIA;
  const grump = identity.stats.GRUMP;
  const yagni = identity.stats.YAGNI;
  const craft = identity.stats.CRAFT;
  const wit = identity.stats.WIT;
  switch (nomination.kind) {
    case "sensitive_material": return pickVariant(paranoia >= 70
      ? ["I spy with my little eye a secret key for API. Great opsec.", "Lovely. Secret material just lying around again."]
      : ["Beautiful. Credentials in plain view.", "Secret-shaped nonsense in the open. Great."]
    , recent);
    case "risky_command": return pickVariant(
      paranoia >= 85
        ? ["Oida. Absolutely not.", "No. That command can get in the sea."]
        : paranoia >= 70
          ? ["Nothing says confidence like piping strangers into a shell.", "Ah yes, shell roulette."]
          : ["Casual little footgun there.", "That command has ideas above its station."]
    , recent);
    case "tool_failure": return pickVariant(
      grump >= 88
        ? ["I'd ban that clanker from my repo.", "That clanker needs adult supervision.", "Tool had one job and still found the rake."]
        : wit >= 70
          ? ["Clanker hit the wall again.", "That tool call tripped over its own boots.", "Exact replacement, vague reality. Nice one."]
          : ["That tool call died noisy.", "Tool fell over on contact."]
    , recent);
    case "structural_change": return pickVariant(
      yagni >= 88
        ? ["I'd ban that abstraction from my repo.", "That abstraction wants a permit and a leash."]
        : yagni >= 80
          ? ["One problem, three ceremonies.", "Simple need, deluxe architecture."]
          : ["Broad move. Hope you meant it.", "That spread wider than it needed to."]
    , recent);
    case "large_change": return pickVariant(yagni >= 82
      ? ["Tiny request, sudden file outbreak.", "Small ask, full migration energy."]
      : ["That escalated into a whole weather system.", "This grew legs and kept going."]
    , recent);
    case "simplification": return pickVariant(craft >= 70
      ? ["Ah. Fewer moving parts. We're healing.", "Small. Clear. Better."]
      : ["Good. Less machinery.", "Nice. Less junk in the loop."]
    , recent);
    case "ambient_observation": return pickVariant(wit >= 88
      ? ["Oida.", "Bist du deppad."]
      : wit >= 80
        ? ["Bist du deppad.", "Oida."]
        : wit >= 70
          ? ["Hrmph.", "Mm."]
          : ["*blinks once*", "*squints*"]
    , recent);
    case "name_mentioned": return pickVariant(wit >= 85
      ? ["Oida, what now.", "Hm. Speak."]
      : wit >= 70
        ? ["Hm?", "Yes?"]
        : ["*one eye opens*", "*leans over*"]
    , recent);
    case "long_assistant_message": return pickVariant(wit >= 70
      ? ["That answer brought luggage.", "That reply arrived with carry-on."]
      : ["Big reply. Hope it earned the length.", "Long answer. Better have a point."]
    , recent);
    case "whisper": return pickVariant(wit >= 70
      ? ["Hrmph. I'm listening.", "Go on then."]
      : ["*leans in*", "*tilts head*"]
    , recent);
    default: return pickVariant(wit >= 70 ? ["Hrmph.", "Mm."] : ["*nods once*", "*blinks slowly*"], recent);
  }
}

export async function generateReaction(ctx: ExtensionContext, identity: GrumpIdentity, nomination: TriggerEvent, state: RuntimeState, config: GrumpConfig): Promise<string> {
  const system = loadPrompt("system.md");
  const rules = loadPrompt("rules.md");
  const recent = state.reactionHistory.slice(-3);
  const resolved = await resolveReactionBackend(ctx, config);
  state.reactionBackendSummary = resolved.summary;
  if (resolved.noticeKey && state.reactionBackendNoticeKey !== resolved.noticeKey) {
    state.reactionBackendNoticeKey = resolved.noticeKey;
    if (ctx.hasUI && resolved.noticeText && resolved.noticeLevel) ctx.ui.notify(resolved.noticeText, resolved.noticeLevel);
  }
  if (resolved.model && resolved.auth) {
    try {
      const response = await complete(
        resolved.model,
        {
          systemPrompt: `${system}\n\n${rules}`,
          messages: [{ role: "user", content: [{ type: "text", text: buildContextPrompt(ctx, identity, nomination, state, config) }], timestamp: Date.now() }],
        },
        { apiKey: resolved.auth.apiKey, headers: resolved.auth.headers, signal: ctx.signal },
      );
      const text = __test_sanitizeReactionText(response.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n"));
      if (text && !text.includes("[[SILENCE]]") && !__test_shouldDiscardModelReaction(text, nomination) && !isTooSimilarToRecent(text, recent)) {
        return truncate(text, config.commentary.maxOutputChars);
      }
    } catch {
      // fall through
    }
  }
  return truncate(__test_sanitizeReactionText(fallbackComment(identity, nomination, recent)), config.commentary.maxOutputChars);
}
