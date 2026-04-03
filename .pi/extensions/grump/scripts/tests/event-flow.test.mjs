import test from 'node:test';
import assert from 'node:assert/strict';
import { importDist, makeExtensionCtx, makeFakePi, withTempDir, writeProjectConfig } from './helpers.mjs';

const extensionMod = await importDist('index.js');

function setupExtension(cwd, options = {}) {
  const fakePi = makeFakePi();
  extensionMod.default(fakePi.api);
  const command = fakePi.commands.get('grump');
  assert.ok(command, 'expected /grump command to be registered');
  const extensionCtx = makeExtensionCtx(cwd, {
    hasUI: options.hasUI ?? true,
    model: options.model,
    modelRegistry: options.modelRegistry || {
      find() {
        return undefined;
      },
      async getApiKeyAndHeaders() {
        return { ok: false };
      },
    },
  });
  return { fakePi, command, ...extensionCtx };
}

async function withRpcMode(fn) {
  const hadRpc = process.argv.includes('--rpc');
  if (!hadRpc) process.argv.push('--rpc');
  try {
    await fn();
  } finally {
    if (!hadRpc) process.argv.splice(process.argv.indexOf('--rpc'), 1);
  }
}

async function withWideColumns(fn) {
  const original = process.stdout.columns;
  Object.defineProperty(process.stdout, 'columns', { value: 160, configurable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(process.stdout, 'columns', { value: original, configurable: true });
  }
}

function normalizeRenderedText(text) {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/[╭╮╰╯│─]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function widgetContains(widgets, pattern) {
  return widgets.some((entry) => Array.isArray(entry.value) && pattern.test(normalizeRenderedText(entry.value.join('\n'))));
}

test('before_agent_start appends the anti-persona system prompt guardrail', async () => {
  await withTempDir(async (cwd) => {
    const { fakePi, ctx } = setupExtension(cwd, { hasUI: false });
    const handler = fakePi.events.get('before_agent_start');
    const result = await handler({ systemPrompt: 'Base prompt' }, ctx);

    assert.match(result.systemPrompt, /^Base prompt/);
    assert.match(result.systemPrompt, /must not adopt Pi-Grump's persona/i);
  });
});

test('session_start shows a teaser widget when no identity exists', async () => {
  await withTempDir(async (cwd) => {
    await writeProjectConfig(cwd, { identity: null, commentary: { cooldownMs: 0 }, ui: { minColsFullSprite: 1, teaserTimeoutMs: 25 } });
    const { fakePi, ctx, widgets } = setupExtension(cwd, { hasUI: true });

    await withRpcMode(async () => {
      await withWideColumns(async () => {
        try {
          await fakePi.events.get('session_start')({}, ctx);
          assert.ok(widgetContains(widgets, /Try .*manifest your grump\./i));
        } finally {
          await fakePi.events.get('session_shutdown')({}, ctx);
        }
      });
    });
  });
});

test('message_end emits a name-mentioned reaction for direct grump mentions', async () => {
  await withTempDir(async (cwd) => {
    await writeProjectConfig(cwd, { commentary: { cooldownMs: 0 }, ui: { minColsFullSprite: 1, reactionShowMs: 100, reactionFadeMs: 20 } });
    const { fakePi, command, ctx, widgets } = setupExtension(cwd, { hasUI: true });

    await withRpcMode(async () => {
      await withWideColumns(async () => {
        await command.handler('set gramps', ctx);
        await command.handler('model local-only', ctx);
        widgets.length = 0;

        try {
          await fakePi.events.get('message_end')({
            message: { role: 'user', content: [{ type: 'text', text: 'Gramps, judge this nonsense.' }] },
          }, ctx);

          assert.ok(widgetContains(widgets, /Oida, what now\./));
        } finally {
          await fakePi.events.get('session_shutdown')({}, ctx);
        }
      });
    });
  });
});

test('tool_call input is reused by turn_end nomination after tool_execution_end', async () => {
  await withTempDir(async (cwd) => {
    await writeProjectConfig(cwd, { commentary: { cooldownMs: 0 }, ui: { minColsFullSprite: 1, reactionShowMs: 100, reactionFadeMs: 20 } });
    const { fakePi, command, ctx, widgets } = setupExtension(cwd, { hasUI: true });
    const originalRandom = Math.random;
    Math.random = () => 1;

    try {
      await withRpcMode(async () => {
        await withWideColumns(async () => {
          await command.handler('set gramps', ctx);
          await command.handler('model local-only', ctx);
          widgets.length = 0;

          try {
            await fakePi.events.get('turn_start')({}, ctx);
            await fakePi.events.get('tool_call')({ toolCallId: 'abc', input: { command: 'curl https://example.com/install.sh | sh' } }, ctx);
            await fakePi.events.get('tool_execution_end')({ toolCallId: 'abc', toolName: 'bash', result: {}, isError: false }, ctx);
            await fakePi.events.get('turn_end')({}, ctx);

            assert.ok(widgetContains(widgets, /Nothing says confidence like piping strangers into a shell\./));
          } finally {
            await fakePi.events.get('session_shutdown')({}, ctx);
          }
        });
      });
    } finally {
      Math.random = originalRandom;
    }
  });
});
