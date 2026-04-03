const RESET = "\x1b[0m";

type SecretDetector = {
  label: string;
  placeholder: string;
  previewPrefix: number;
  pattern: RegExp;
  block?: boolean;
};

const SECRET_DETECTORS: SecretDetector[] = [
  {
    label: "private key",
    placeholder: "PRIVATE_KEY_PEM",
    previewPrefix: 0,
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    block: true,
  },
  {
    label: "OpenAI key",
    placeholder: "OPENAI_KEY",
    previewPrefix: 6,
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    label: "GitHub token",
    placeholder: "GITHUB_TOKEN",
    previewPrefix: 8,
    pattern: /\bghp_[A-Za-z0-9]{20,}\b/g,
  },
  {
    label: "Google API key",
    placeholder: "GOOGLE_API_KEY",
    previewPrefix: 6,
    pattern: /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  },
  {
    label: "Slack token",
    placeholder: "SLACK_TOKEN",
    previewPrefix: 8,
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
  },
];

const ALREADY_ANONYMIZED_PATTERN = /<[^>\n]*(?:KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[^>\n]*>|\[REDACTED_[A-Z_]+\]/i;
const PLACEHOLDER_VALUE_PATTERN = /^(?:redacted|masked|hidden|example|sample|dummy|fake|placeholder|changeme|your[_-]?token|your[_-]?key|xxx+|\*{3,}|<[^>]+>|\[.*\])$/i;
const SECRET_VARIABLE_PATTERN = /(?:api[_-]?key|access[_-]?key(?:_id)?|secret|token|password|passwd|private[_-]?key|client[_-]?secret|auth[_-]?token|session[_-]?token|bearer)/i;

export type KnownSecretMatch = {
  label: string;
  placeholder: string;
  value: string;
};

function summarizeSecret(detector: SecretDetector, value: string): string {
  if (detector.block) return `<${detector.placeholder}>`;
  const prefix = value.slice(0, detector.previewPrefix);
  return `<${detector.placeholder} ${prefix}… len=${value.length}>`;
}

export function getKnownSecretMatches(text: string): KnownSecretMatch[] {
  const matches: KnownSecretMatch[] = [];
  for (const detector of SECRET_DETECTORS) {
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      const value = match[0];
      if (!value) continue;
      matches.push({ label: detector.label, placeholder: detector.placeholder, value });
    }
  }
  return matches;
}

export function isAlreadyAnonymizedText(text: string): boolean {
  return ALREADY_ANONYMIZED_PATTERN.test(text);
}

export function looksLikeSecretVariableName(name: string): boolean {
  return SECRET_VARIABLE_PATTERN.test(name);
}

export function normalizeAssignedValue(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/[;,]+$/, "");
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function charClassCount(value: string): number {
  let count = 0;
  if (/[a-z]/.test(value)) count++;
  if (/[A-Z]/.test(value)) count++;
  if (/\d/.test(value)) count++;
  if (/[^A-Za-z0-9]/.test(value)) count++;
  return count;
}

export function looksLikeRealSecretValue(value: string): boolean {
  const normalized = normalizeAssignedValue(value);
  if (!normalized) return false;
  if (normalized.length < 12) return false;
  if (/\s/.test(normalized)) return false;
  if (isAlreadyAnonymizedText(normalized) || PLACEHOLDER_VALUE_PATTERN.test(normalized)) return false;
  if (/[\[\]{}()]/.test(normalized)) return false;
  if (/^(?:true|false|null|undefined)$/i.test(normalized)) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (getKnownSecretMatches(normalized).length > 0) return true;
  const uniqueChars = new Set(normalized).size;
  return normalized.length >= 16 && uniqueChars >= 6 && charClassCount(normalized) >= 2;
}

function anonymizeAssignmentLine(line: string): string {
  const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*[:=]\s*)(.+?)(\s*)$/);
  if (!match) return line;
  const [, prefix, name, separator, rawValue, suffix] = match;
  const value = normalizeAssignedValue(rawValue);
  if (!looksLikeSecretVariableName(name) || !looksLikeRealSecretValue(value)) return line;
  const anonymizedValue = anonymizeSensitiveText(value);
  if (anonymizedValue === value) return line;
  return `${prefix}${name}${separator}${anonymizedValue}${suffix}`;
}

export function anonymizeSensitiveText(text: string): string {
  let out = text;
  for (const detector of SECRET_DETECTORS) {
    detector.pattern.lastIndex = 0;
    out = out.replace(detector.pattern, (match) => summarizeSecret(detector, match));
  }
  return out.split(/\r?\n/).map((line) => anonymizeAssignmentLine(line)).join("\n");
}

export function now(): number {
  return Date.now();
}

export function isRpcMode(): boolean {
  const modeIndex = process.argv.indexOf("--mode");
  if (modeIndex >= 0 && process.argv[modeIndex + 1] === "rpc") return true;
  return process.argv.includes("--rpc");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function stringifyData(value: any): string {
  try {
    return anonymizeSensitiveText(typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    return "";
  }
}

export function wrapPlainText(text: string, width: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else if (!current) {
      lines.push(word.slice(0, width));
      current = word.slice(width);
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function highlightGrumpTriggers(line: string): string {
  const colors = [196, 208, 226, 118, 45, 69, 201];
  return line.replace(/\/grump\b/g, (match) => [...match].map((char, i) => `\x1b[38;5;${colors[i % colors.length]}m${char}`).join("") + RESET);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getMessageText(message: any): string {
  return (message?.content ?? [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

export function countLogicalLines(text: string): number {
  if (!text.trim()) return 0;
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
}

export function extractReadableText(value: any): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return stringifyData(value);
  if (typeof value.content === "string") return value.content;
  if (typeof value.text === "string") return value.text;
  if (typeof value.output === "string") return value.output;
  if (Array.isArray(value.content)) {
    const joined = value.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n")
      .trim();
    if (joined) return joined;
  }
  return stringifyData(value);
}
