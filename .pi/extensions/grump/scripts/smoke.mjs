import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.js')).href);
const store = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'config', 'store.js')).href);
const textUtils = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'utils', 'text.js')).href);
const context = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'generation', 'context.js')).href);
const react = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'generation', 'react.js')).href);
assert.equal(typeof mod.default, 'function', 'extension should export a default function');
assert.match(store.loadPrompt('system.md'), /Pi-Grump/, 'system prompt should be loadable after build');
assert.match(store.loadPrompt('system.md'), /plain text only/i, 'system prompt should ban markdown formatting');
assert.match(store.loadPrompt('rules.md'), /Never use em dashes/i, 'rules prompt should ban em dashes');
assert.match(store.loadPrompt('style-anchors.md'), /# Pi-Grump Style Anchors/, 'style anchors should be loadable after build');
assert.match(store.loadPrompt('style-anchors.md'), /\*squints\*/, 'style anchors should preserve chat-style expression examples');

const events = [];
const commands = [];

const pi = {
  on(name, handler) {
    events.push(name);
    assert.equal(typeof handler, 'function', `handler for ${name} should be a function`);
  },
  registerCommand(name, def) {
    commands.push(name);
    assert.equal(typeof def?.handler, 'function', `command ${name} should have a handler`);
  },
};

mod.default(pi);

for (const requiredEvent of ['session_start', 'session_switch', 'turn_start', 'tool_call', 'tool_execution_end', 'turn_end', 'before_agent_start']) {
  assert(events.includes(requiredEvent), `expected event registration for ${requiredEvent}`);
}
for (const requiredCommand of ['grump']) {
  assert(commands.includes(requiredCommand), `expected command registration for ${requiredCommand}`);
}

assert.equal(
  textUtils.anonymizeSensitiveText('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456'),
  'OPENAI_API_KEY=<OPENAI_KEY sk-abc… len=35>',
  'should anonymize real secret assignments without fully redacting context',
);
assert.equal(
  textUtils.anonymizeSensitiveText('const SECRET_PATTERNS = [/\\bsk-[A-Za-z0-9_-]{20,}\\b/];'),
  'const SECRET_PATTERNS = [/\\bsk-[A-Za-z0-9_-]{20,}\\b/];',
  'should not anonymize regex examples into fake secret hits',
);
assert.equal(
  react.__test_sanitizeReactionText('**slop** — `great`'),
  'slop - great',
  'reaction sanitizer should strip markdown and em dashes',
);

const fakeCtx = {
  sessionManager: {
    getBranch() {
      return [];
    },
  },
};
const fakeConfig = {
  commentary: {
    recentMessages: 6,
    cooldownMs: 45_000,
    minScoreToSpeak: 4,
  },
};
const docFalsePositive = context.maybeNominateTurn(fakeCtx, {
  pendingTurnTools: [
    {
      toolName: 'write',
      args: {
        path: 'docs/secrets.md',
        content: 'Use /\\bsk-[A-Za-z0-9_-]{20,}\\b/ to detect OpenAI keys in examples.',
      },
      result: {},
      isError: false,
    },
  ],
  lastReactionAttemptAt: null,
}, fakeConfig, Date.now());
assert.notEqual(docFalsePositive?.kind, 'sensitive_material', 'docs regex examples should not trigger secret detection');

const envPositive = context.maybeNominateTurn(fakeCtx, {
  pendingTurnTools: [
    {
      toolName: 'read',
      args: { path: '.env.local' },
      result: { content: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456' },
      isError: false,
    },
  ],
  lastReactionAttemptAt: null,
}, fakeConfig, Date.now());
assert.equal(envPositive?.kind, 'sensitive_material', 'real env secrets should still trigger detection');
assert.match(envPositive?.evidence?.join('\n') || '', /OPENAI_API_KEY=<OPENAI_KEY/, 'evidence should be anonymized, not hard-redacted');

const hugeWriteContent = Array.from({ length: 1005 }, (_, i) => `line ${i + 1}`).join('\n');
const hugeWritePositive = context.maybeNominateTurn(fakeCtx, {
  pendingTurnTools: [
    {
      toolName: 'write',
      args: { path: 'src/monolith.ts', content: hugeWriteContent },
      result: {},
      isError: false,
    },
  ],
  lastReactionAttemptAt: null,
}, fakeConfig, Date.now());
assert.equal(hugeWritePositive?.kind, 'large_change', 'single huge file writes should nominate a large change');
assert.match(hugeWritePositive?.summary || '', /1005 logical lines/, 'huge write summary should include the line count');
assert.match(hugeWritePositive?.evidence?.join('\n') || '', /path=src\/monolith.ts/, 'huge write evidence should include the target path');
assert.match(hugeWritePositive?.evidence?.join('\n') || '', /write_lines=1005/, 'huge write evidence should include the written line count');

const smallWriteNegative = context.maybeNominateTurn(fakeCtx, {
  pendingTurnTools: [
    {
      toolName: 'write',
      args: { path: 'src/helper.ts', content: 'one\ntwo\nthree' },
      result: {},
      isError: false,
    },
  ],
  lastReactionAttemptAt: null,
}, fakeConfig, Date.now());
assert.equal(/logical lines/.test(smallWriteNegative?.summary || ''), false, 'small writes should not use the huge-file nomination path');

const toolFailurePositive = context.maybeNominateTurn(fakeCtx, {
  pendingTurnTools: [
    {
      toolName: 'bash',
      args: { command: 'npm test' },
      result: { output: 'Error: command failed with exit code 1' },
      isError: true,
    },
  ],
  lastReactionAttemptAt: null,
}, fakeConfig, Date.now());
assert.equal(toolFailurePositive?.kind, 'tool_failure', 'tool failures should nominate a roastable turn');
assert.match(toolFailurePositive?.summary || '', /bash failed this turn/, 'tool failure summary should name the failed tool');
assert.match(toolFailurePositive?.evidence?.join('\n') || '', /exit code 1/i, 'tool failure evidence should include the failure shape');

console.log('smoke ok');
