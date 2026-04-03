import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { GrumpConfig } from "../domain/types.js";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
export const PROMPTS_DIR = join(THIS_DIR, "..", "..", "prompts");
export const GLOBAL_CONFIG_PATH = join(getAgentDir(), "extensions", "grump.json");

export function projectConfigPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), ".pi", "extensions", "grump.json");
}

async function ensureDirFor(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (!override) return JSON.parse(JSON.stringify(base));
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [key, value] of Object.entries(override as any)) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof out[key] === "object" && out[key]) {
      out[key] = deepMerge(out[key], value as any);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function writeJson(path: string, patch: Partial<GrumpConfig>): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await ensureDirFor(path);
    const current = readJson<any>(path) ?? {};
    const next = `${JSON.stringify(deepMerge(current, patch), null, 2)}\n`;
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, next, "utf8");
    await rename(tempPath, path);
    await rm(tempPath, { force: true }).catch(() => undefined);
  });
}

export function loadConfig(cwd?: string): GrumpConfig {
  const global = readJson<Partial<GrumpConfig>>(GLOBAL_CONFIG_PATH);
  const project = readJson<Partial<GrumpConfig>>(projectConfigPath(cwd));
  return deepMerge(deepMerge(DEFAULT_CONFIG, global), project);
}

export function resolveConfigWritePath(cwd?: string): string {
  const projectPath = cwd ? projectConfigPath(cwd) : undefined;
  if (projectPath && existsSync(projectPath)) return projectPath;
  return GLOBAL_CONFIG_PATH;
}

export async function saveConfigPatch(cwd: string | undefined, patch: Partial<GrumpConfig>): Promise<void> {
  await writeJson(resolveConfigWritePath(cwd), patch);
}

export function loadPrompt(name: string): string {
  const path = join(PROMPTS_DIR, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
