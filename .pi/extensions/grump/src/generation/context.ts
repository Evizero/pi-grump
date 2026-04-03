import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { GrumpConfig, GrumpIdentity, RuntimeState, ToolRecord, TriggerEvent } from "../domain/types.js";
import {
  anonymizeSensitiveText,
  countLogicalLines,
  escapeRegExp,
  extractReadableText,
  getKnownSecretMatches,
  getMessageText,
  isAlreadyAnonymizedText,
  looksLikeRealSecretValue,
  looksLikeSecretVariableName,
  normalizeAssignedValue,
  stringifyData,
  truncate,
} from "../utils/text.js";

const STRUCTURAL_PATTERNS = /(?:factory|manager|builder|adapter|provider|wrapper|service|orchestrator|coordinator)/i;
const RISKY_BASH = [
  /\brm\s+-(?:rf|fr|r)\b/i,
  /\bcurl\b.*\|\s*sh\b/i,
  /\bwget\b.*\|\s*sh\b/i,
  /\bchmod\s+777\b/i,
  /\bsudo\b/i,
];
const REGEX_OR_EXAMPLE_HINTS = /\b(?:regex|regexp|pattern|match(?:er|ing)?|replace|escape|example|sample|dummy|fake|placeholder|fixture|mock|test(?:ing)?|detector|classifier|redact(?:ed|ion)?|anonymi[sz](?:ed|ation)|tokenizer)\b/i;

type SensitiveFinding = {
  score: number;
  reason: string;
  snippet: string;
  sourceLabel: string;
};

export const AMBIENT_ASSISTANT_MESSAGE_CHANCE = 0.06;
export const AMBIENT_TOOL_CHANCE = 0.04;
export const LONG_ASSISTANT_MESSAGE_MIN_LINES = 18;
export const LONG_ASSISTANT_MESSAGE_STRONG_LINES = 30;

function formatTimelineMessage(message: any): string | null {
  const text = truncate(anonymizeSensitiveText(getMessageText(message)), 1000);
  if (!text) return null;
  switch (message?.role) {
    case "user":
      return `user: ${text}`;
    case "assistant":
      return `assistant: ${text}`;
    case "toolResult":
      return `tool_result: ${text}`;
    case "bashExecution":
      return `bash: ${text}`;
    default:
      return null;
  }
}

function formatToolRecord(tool: ToolRecord): string {
  const args = truncate(stringifyData(tool.args), 360);
  const result = truncate(stringifyData(tool.result), 360);
  return `tool ${tool.toolName}${tool.isError ? " error" : ""}: args=${args || "{}"}; result=${result || ""}`;
}

export function getRecentContextEntries(ctx: ExtensionContext, state: RuntimeState, count: number): string[] {
  const branch = ctx.sessionManager.getBranch() as any[];
  const timeline: string[] = [];
  for (const entry of branch) {
    if (entry?.type !== "message") continue;
    const formatted = formatTimelineMessage(entry.message);
    if (formatted) timeline.push(formatted);
  }
  timeline.push(...state.pendingTurnTools.map((tool) => formatToolRecord(tool)));
  return timeline.slice(-count);
}

export function getLatestMessageByRole(ctx: ExtensionContext, role: "user" | "assistant"): string {
  const branch = ctx.sessionManager.getBranch() as any[];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry: any = branch[i];
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== role) continue;
    const text = truncate(anonymizeSensitiveText(getMessageText(message)), 1600);
    if (text) return text;
  }
  return "";
}

export function buildCodeGlances(state: RuntimeState): string[] {
  const glances: string[] = [];
  for (const tool of state.pendingTurnTools) {
    if (tool.toolName === "read") {
      const path = typeof tool.args?.path === "string" ? tool.args.path : "read result";
      const text = truncate(anonymizeSensitiveText(extractReadableText(tool.result)), 520);
      if (text) glances.push(`read ${path}: ${text}`);
    } else if (tool.toolName === "write") {
      const path = typeof tool.args?.path === "string" ? tool.args.path : "write target";
      const text = truncate(anonymizeSensitiveText(extractReadableText(tool.args?.content)), 520);
      if (text) glances.push(`write ${path}: ${text}`);
    } else if (tool.toolName === "edit") {
      const path = typeof tool.args?.path === "string" ? tool.args.path : "edited file";
      const edits = Array.isArray(tool.args?.edits) ? tool.args.edits : [];
      for (const edit of edits.slice(0, 2)) {
        const text = truncate(anonymizeSensitiveText(typeof edit?.newText === "string" ? edit.newText : ""), 420);
        if (text) glances.push(`edit ${path}: ${text}`);
      }
    }
    if (glances.length >= 8) break;
  }
  return glances;
}

export function buildFocusGuidance(ctx: ExtensionContext, state: RuntimeState, nomination: TriggerEvent): string[] {
  const guidance: string[] = [];
  const latestAssistant = getLatestMessageByRole(ctx, "assistant");
  if (latestAssistant.length > 220) guidance.push("If the assistant just gave a substantial plan, opinion, or framing, react to the substance of that take, not just the fact that it was long.");
  const sawCode = state.pendingTurnTools.some((tool) => tool.toolName === "read" || tool.toolName === "write" || tool.toolName === "edit");
  if (sawCode) guidance.push("If code is visible in reads, writes, or edits, prefer commenting on the code shape, smell, slop, ceremony, or cleanliness over narrating the tool usage.");
  if (nomination.kind === "large_change" && nomination.evidence.some((entry) => /write_lines=\d+/.test(entry))) {
    guidance.push("Do not complain about file size alone. Judge whether the visible structure looks bloated, overstuffed, ceremonial, or poorly split.");
  }
  if (nomination.kind === "tool_failure") {
    guidance.push("Tool failures are roastable, but keep it aimed at the clanking attempt, error shape, or obvious self-own. Do not just say 'it failed.'");
  }
  if (nomination.kind === "name_mentioned") guidance.push("If directly addressed, it is okay to answer briefly, but still anchor the line to the surrounding moment if there is something worth noticing.");
  guidance.push("Use plain, approachable language. Avoid dense reviewer jargon unless one technical term really helps the joke land.");
  return guidance;
}

export function inferRecentScope(messages: string[]): TriggerEvent["recentScope"] {
  const total = messages.join("\n").length;
  if (!total) return "unclear";
  if (total < 140) return "small";
  if (total < 500) return "medium";
  return "large";
}

function collectPaths(args: any): string[] {
  const paths: string[] = [];
  if (!args || typeof args !== "object") return paths;
  for (const [key, value] of Object.entries(args)) {
    if (/path/i.test(key) && typeof value === "string") paths.push(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          for (const [nestedKey, nestedValue] of Object.entries(item)) {
            if (/path/i.test(nestedKey) && typeof nestedValue === "string") paths.push(nestedValue);
          }
        }
      }
    }
  }
  return paths;
}

function normalizePath(path: string | undefined): string {
  return (path || "").replace(/\\/g, "/").toLowerCase();
}

function pathLooksDocLike(path: string | undefined): boolean {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  return /(^|\/)(docs?|prompts?|examples?|fixtures?|tests?|__tests__)(\/|$)/.test(normalized)
    || /(?:^|\/)(readme|changelog|license)(\.[^/]+)?$/.test(normalized)
    || /\.(?:md|mdx|txt|rst)$/i.test(normalized)
    || /(?:^|\/).+\.(?:spec|test)\.[^/]+$/.test(normalized)
    || /(?:^|\/).*(?:example|sample|fixture|mock|dummy|template)\.[^/]+$/.test(normalized)
    || /(?:^|\/)\.env\.example(?:\.[^/]+)?$/.test(normalized);
}

function pathLooksSensitive(path: string | undefined): boolean {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  return /(?:^|\/)\.env(?:\.[^/]+)?$/.test(normalized)
    || /\.(?:pem|key|p12|pfx)$/i.test(normalized)
    || /(?:^|\/)(?:\.npmrc|\.netrc|\.pypirc|id_rsa|id_ed25519)$/i.test(normalized)
    || /(?:^|\/)(?:secrets?|credentials?)(?:\/|$)/i.test(normalized);
}

function pathLooksCodeOrConfig(path: string | undefined): boolean {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  return /\.(?:[cm]?js|tsx?|jsx|json|ya?ml|toml|ini|env|py|rb|go|rs|java|kt|swift|php|sh|bash|zsh|conf|config)$/i.test(normalized);
}

function textLooksLikeRegexOrExample(text: string): boolean {
  if (REGEX_OR_EXAMPLE_HINTS.test(text)) return true;
  if (/new\s+RegExp\s*\(/i.test(text)) return true;
  if (/\/\\?b.*(?:sk-|ghp_|AIza|xox[baprs]-)/.test(text)) return true;
  if (/\[[A-Za-z0-9_-]+\]\{\d+,?\d*\}/.test(text)) return true;
  if (/```/.test(text)) return true;
  return false;
}

function getContextAdjustment(tool: ToolRecord, path: string | undefined, text: string): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (pathLooksSensitive(path)) {
    score += 3;
    reasons.push("sensitive file context");
  } else if (pathLooksCodeOrConfig(path)) {
    score += 1;
    reasons.push("code/config file context");
  }
  if (pathLooksDocLike(path)) {
    score -= 7;
    reasons.push("docs/test/example context");
  }
  if (tool.toolName === "read" || tool.toolName === "write" || tool.toolName === "edit") {
    score += 1;
  }
  if (tool.toolName === "bash") {
    const command = typeof tool.args?.command === "string" ? tool.args.command : "";
    if (/\b(?:printenv|env|cat|sed|awk|grep)\b/i.test(command) || /\.env\b/i.test(command)) {
      score += 2;
      reasons.push("shell env/credential access");
    }
  }
  if (textLooksLikeRegexOrExample(text)) {
    score -= 6;
    reasons.push("regex/example language");
  }
  if (isAlreadyAnonymizedText(text)) {
    score -= 6;
    reasons.push("already anonymized/redacted");
  }
  return { score, reasons };
}

function lineContainsKnownSecret(line: string): boolean {
  return getKnownSecretMatches(line).length > 0;
}

function getSensitiveAssignmentLines(text: string): Array<{ name: string; line: string; value: string }> {
  const lines = text.split(/\r?\n/);
  const hits: Array<{ name: string; line: string; value: string }> = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*[:=]\s*)(.+?)\s*$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = normalizeAssignedValue(rawValue);
    if (!value) continue;
    if (!looksLikeSecretVariableName(name) && !looksLikeRealSecretValue(value)) continue;
    if (!looksLikeRealSecretValue(value) && !lineContainsKnownSecret(value)) continue;
    hits.push({ name, line, value });
  }
  return hits;
}

function buildSensitiveFinding(tool: ToolRecord, text: string, path: string | undefined, sourceLabel: string): SensitiveFinding | null {
  if (!text) return null;
  const knownMatches = getKnownSecretMatches(text);
  const assignmentHits = getSensitiveAssignmentLines(text);
  if (knownMatches.length === 0 && assignmentHits.length === 0) return null;

  const adjustment = getContextAdjustment(tool, path, text);
  const reasons: string[] = [...adjustment.reasons];
  let score = adjustment.score;

  if (knownMatches.length > 0) {
    score += 6;
    reasons.push(`${knownMatches[0].label} shape`);
  }
  if (assignmentHits.length > 0) {
    score += 4;
    reasons.push(`assigned ${assignmentHits[0].name}`);
  }

  if (score < 5) return null;

  const rawSnippet = assignmentHits[0]?.line || knownMatches[0]?.value || text;
  const snippet = truncate(anonymizeSensitiveText(rawSnippet).replace(/\s+/g, " ").trim(), 140);
  return {
    score,
    reason: reasons.join(", "),
    snippet,
    sourceLabel,
  };
}

function inspectSensitiveMaterial(state: RuntimeState): SensitiveFinding | null {
  const findings: SensitiveFinding[] = [];
  for (const tool of state.pendingTurnTools) {
    if (tool.toolName === "read") {
      const path = typeof tool.args?.path === "string" ? tool.args.path : undefined;
      const text = extractReadableText(tool.result);
      const finding = buildSensitiveFinding(tool, text, path, path ? `read ${path}` : "read result");
      if (finding) findings.push(finding);
      continue;
    }
    if (tool.toolName === "write") {
      const path = typeof tool.args?.path === "string" ? tool.args.path : undefined;
      const text = extractReadableText(tool.args?.content);
      const finding = buildSensitiveFinding(tool, text, path, path ? `write ${path}` : "write target");
      if (finding) findings.push(finding);
      continue;
    }
    if (tool.toolName === "edit") {
      const path = typeof tool.args?.path === "string" ? tool.args.path : undefined;
      const edits = Array.isArray(tool.args?.edits) ? tool.args.edits : [];
      for (const edit of edits.slice(0, 3)) {
        const text = typeof edit?.newText === "string" ? edit.newText : "";
        const finding = buildSensitiveFinding(tool, text, path, path ? `edit ${path}` : "edited file");
        if (finding) findings.push(finding);
      }
      continue;
    }
    if (tool.toolName === "bash") {
      const command = typeof tool.args?.command === "string" ? tool.args.command : undefined;
      const text = [command || "", extractReadableText(tool.result)].filter(Boolean).join("\n");
      const finding = buildSensitiveFinding(tool, text, command, command ? `bash ${truncate(command, 60)}` : "bash output");
      if (finding) findings.push(finding);
    }
  }
  findings.sort((a, b) => b.score - a.score);
  return findings[0] ?? null;
}

function findHugeSingleWrite(state: RuntimeState): { path: string; lineCount: number } | null {
  let best: { path: string; lineCount: number } | null = null;
  for (const tool of state.pendingTurnTools) {
    if (tool.toolName !== "write") continue;
    const path = typeof tool.args?.path === "string" ? tool.args.path : "write target";
    const content = typeof tool.args?.content === "string" ? tool.args.content : extractReadableText(tool.args?.content);
    const lineCount = countLogicalLines(content);
    if (lineCount < 1000) continue;
    if (!best || lineCount > best.lineCount) best = { path, lineCount };
  }
  return best;
}

function classifyToolFailureReason(toolName: string, raw: string): string {
  if (toolName === "edit") {
    if (/Each oldText must be unique|Found \d+ occurrences of edits\[\d+\]/i.test(raw)) return "edit replacement was ambiguous";
    if (/oldText must match|must match exactly|unique, non-overlapping region/i.test(raw)) return "edit replacement did not match the file cleanly";
  }
  if (toolName === "write" && /EACCES|EPERM|permission denied/i.test(raw)) return "write was blocked by permissions";
  if (toolName === "bash" && /exit code\s+\d+/i.test(raw)) return "bash command exited non-zero";
  return `${toolName} returned an error`;
}

function getToolFailureContext(tool: ToolRecord): string {
  if (tool.toolName === "bash") {
    const command = typeof tool.args?.command === "string" ? tool.args.command.trim() : "";
    return command ? `command=${truncate(command, 80)}` : "tool=bash";
  }
  const path = typeof tool.args?.path === "string" ? tool.args.path.trim() : "";
  if (path) return `path=${truncate(path, 80)}`;
  return `tool=${tool.toolName}`;
}

function findToolFailure(state: RuntimeState): { toolName: string; reason: string; snippet: string; context: string } | null {
  for (let i = state.pendingTurnTools.length - 1; i >= 0; i--) {
    const tool = state.pendingTurnTools[i];
    if (!tool.isError) continue;
    const raw = [extractReadableText(tool.result), stringifyData(tool.result)].filter(Boolean).join("\n");
    const snippet = truncate(anonymizeSensitiveText(raw).replace(/\s+/g, " ").trim(), 180) || "tool returned an error";
    return {
      toolName: tool.toolName,
      reason: classifyToolFailureReason(tool.toolName, raw),
      snippet,
      context: getToolFailureContext(tool),
    };
  }
  return null;
}

export function maybeNominateTurn(ctx: ExtensionContext, state: RuntimeState, config: GrumpConfig, createdAt: number): TriggerEvent | null {
  const evidence: TriggerEvent[] = [];
  const recentMessages = getRecentContextEntries(ctx, state, config.commentary.recentMessages);
  const recentScope = inferRecentScope(recentMessages);
  const toolCount = state.pendingTurnTools.length;
  const uniquePaths = new Set(state.pendingTurnTools.flatMap((tool) => collectPaths(tool.args))).size;
  const aggregateText = state.pendingTurnTools.map((tool) => `${tool.toolName}\n${stringifyData(tool.args)}\n${stringifyData(tool.result)}`).join("\n---\n");

  const hugeSingleWrite = findHugeSingleWrite(state);

  if (toolCount >= 4 || uniquePaths >= 4 || hugeSingleWrite) {
    const largeChangeEvidence = [] as string[];
    let largeChangeScore = 3 + (toolCount >= 6 ? 1 : 0);
    let largeChangeSummary = "Broad turn activity";
    if (toolCount >= 4 || uniquePaths >= 4) {
      largeChangeEvidence.push(`tool_count=${toolCount}`, `unique_paths=${uniquePaths}`);
    }
    if (hugeSingleWrite) {
      largeChangeSummary = `Single file written with ${hugeSingleWrite.lineCount} logical lines`;
      largeChangeEvidence.push("tool=write", `path=${hugeSingleWrite.path}`, `write_lines=${hugeSingleWrite.lineCount}`);
      largeChangeScore = Math.max(largeChangeScore, hugeSingleWrite.lineCount >= 2000 ? 6 : 5);
    }
    evidence.push({ kind: "large_change", score: largeChangeScore, summary: largeChangeSummary, evidence: largeChangeEvidence, source: "turn_end", createdAt, recentScope });
  }
  if (STRUCTURAL_PATTERNS.test(aggregateText)) {
    evidence.push({ kind: "structural_change", score: 3, summary: "Structural naming patterns found", evidence: ["factory/manager/builder/adapter/provider pattern"], source: "turn_end", createdAt, recentScope });
  }

  const sensitiveFinding = inspectSensitiveMaterial(state);
  if (sensitiveFinding) {
    evidence.push({
      kind: "sensitive_material",
      score: Math.max(5, sensitiveFinding.score),
      summary: "Probable live credential or secret material detected",
      evidence: [sensitiveFinding.sourceLabel, sensitiveFinding.reason, sensitiveFinding.snippet],
      source: "turn_end",
      createdAt,
      recentScope,
    });
  }

  const toolFailure = findToolFailure(state);
  if (toolFailure) {
    evidence.push({
      kind: "tool_failure",
      score: 5,
      summary: `${toolFailure.toolName} failed this turn`,
      evidence: [toolFailure.context, toolFailure.reason, toolFailure.snippet],
      source: "turn_end",
      createdAt,
      recentScope,
    });
  }

  const riskyCommands = state.pendingTurnTools
    .filter((tool) => tool.toolName === "bash")
    .map((tool) => typeof tool.args?.command === "string" ? tool.args.command : "")
    .filter((command) => RISKY_BASH.some((pattern) => pattern.test(command)));
  if (riskyCommands.length > 0) {
    evidence.push({ kind: "risky_command", score: 5, summary: "Risky shell command detected", evidence: riskyCommands.map((command) => truncate(command, 80)), source: "turn_end", createdAt, recentScope });
  }

  let simplificationScore = 0;
  for (const tool of state.pendingTurnTools) {
    if (tool.toolName !== "edit") continue;
    const edits = Array.isArray(tool.args?.edits) ? tool.args.edits : [];
    for (const edit of edits) {
      const oldLen = typeof edit?.oldText === "string" ? edit.oldText.length : 0;
      const newLen = typeof edit?.newText === "string" ? edit.newText.length : 0;
      if (oldLen > 20 && newLen < oldLen * 0.65) simplificationScore++;
    }
  }
  if (simplificationScore > 0) {
    evidence.push({ kind: "simplification", score: 3 + Math.min(2, simplificationScore), summary: "Simplification signal detected", evidence: [`shrinking_edits=${simplificationScore}`], source: "turn_end", createdAt, recentScope });
  }

  if (!evidence.length) return null;
  evidence.sort((a, b) => b.score - a.score);
  const top = evidence[0];
  if (state.lastReactionAttemptAt && createdAt - state.lastReactionAttemptAt < config.commentary.cooldownMs) return null;
  if (top.score < config.commentary.minScoreToSpeak) return null;
  return top;
}

export function messageMentionsGrumpName(message: any, identity: GrumpIdentity | null): boolean {
  if (!identity) return false;
  const text = getMessageText(message);
  if (!text) return false;
  if (identity.name === "π") return text.includes("π");
  return new RegExp(`\\b${escapeRegExp(identity.name)}\\b`, "i").test(text);
}

export function nominateAssistantMessage(ctx: ExtensionContext, eventMessage: any, state: RuntimeState, config: GrumpConfig, createdAt: number): TriggerEvent | null {
  const assistantText = getMessageText(eventMessage);
  const logicalLineCount = countLogicalLines(assistantText);
  const recentScope = inferRecentScope(getRecentContextEntries(ctx, state, config.commentary.recentMessages));
  if (logicalLineCount >= LONG_ASSISTANT_MESSAGE_MIN_LINES) {
    return {
      kind: "long_assistant_message",
      score: logicalLineCount >= LONG_ASSISTANT_MESSAGE_STRONG_LINES ? 5 : config.commentary.minScoreToSpeak,
      summary: "Assistant message ran long",
      evidence: [`assistant_lines=${logicalLineCount}`],
      source: "message_end",
      createdAt,
      recentScope,
    };
  }
  if (Math.random() < AMBIENT_ASSISTANT_MESSAGE_CHANCE) {
    return {
      kind: "ambient_observation",
      score: config.commentary.minScoreToSpeak,
      summary: "Random ambient peek after assistant message",
      evidence: ["assistant message end", "random chance"],
      source: "message_end",
      createdAt,
      recentScope,
    };
  }
  return null;
}
