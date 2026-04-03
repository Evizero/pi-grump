import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', '..', 'dist');

export async function importDist(...parts) {
  const href = pathToFileURL(path.join(DIST_DIR, ...parts)).href;
  return import(href);
}

export function makeBaseConfig(overrides = {}) {
  return {
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
        mode: 'auto',
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
    ...overrides,
    commentary: {
      enabled: true,
      cooldownMs: 10_000,
      maxContextChars: 12_000,
      maxOutputChars: 140,
      minScoreToSpeak: 4,
      recentMessages: 6,
      reactionModel: {
        mode: 'auto',
        allowActiveModelFallback: true,
        allowLocalFallback: true,
      },
      ...(overrides.commentary || {}),
      reactionModel: {
        mode: 'auto',
        allowActiveModelFallback: true,
        allowLocalFallback: true,
        ...((overrides.commentary || {}).reactionModel || {}),
      },
    },
    ui: {
      showTeaser: true,
      reactionShowMs: 10_000,
      reactionFadeMs: 3_000,
      teaserTimeoutMs: 15_000,
      minColsFullSprite: 100,
      ...(overrides.ui || {}),
    },
  };
}

export function makeBranchCtx(branch = []) {
  return {
    sessionManager: {
      getBranch() {
        return branch;
      },
    },
  };
}

export function makeModelRegistry({ find = () => undefined, getApiKeyAndHeaders = async () => ({ ok: false }) } = {}) {
  return { find, getApiKeyAndHeaders };
}

export function makeExtensionCtx(cwd, options = {}) {
  const notifications = [];
  const widgets = [];
  const statuses = [];
  const editors = [];
  const customCalls = [];
  const ctx = {
    cwd,
    hasUI: options.hasUI ?? false,
    signal: options.signal,
    model: options.model,
    modelRegistry: options.modelRegistry || makeModelRegistry(),
    sessionManager: options.sessionManager || { getBranch: () => [] },
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      setWidget(name, value) {
        widgets.push({ name, value });
      },
      setStatus(name, value) {
        statuses.push({ name, value });
      },
      setEditorComponent(value) {
        editors.push(value);
      },
      async custom(factory, options) {
        customCalls.push({ factory, options });
        return true;
      },
    },
  };
  return { ctx, notifications, widgets, statuses, editors, customCalls };
}

export async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-grump-tests-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readProjectConfig(dir) {
  const configPath = path.join(dir, '.pi', 'extensions', 'grump.json');
  return JSON.parse(await readFile(configPath, 'utf8'));
}

export async function writeProjectConfig(dir, config) {
  const configPath = path.join(dir, '.pi', 'extensions', 'grump.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function makeFakePi() {
  const events = new Map();
  const commands = new Map();
  return {
    events,
    commands,
    api: {
      on(name, handler) {
        events.set(name, handler);
      },
      registerCommand(name, def) {
        commands.set(name, def);
      },
    },
  };
}
