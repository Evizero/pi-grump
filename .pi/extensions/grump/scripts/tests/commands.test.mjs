import test from 'node:test';
import assert from 'node:assert/strict';
import { importDist, makeExtensionCtx, makeFakePi, readProjectConfig, withTempDir } from './helpers.mjs';

const extensionMod = await importDist('index.js');

function setupExtension(cwd) {
  const fakePi = makeFakePi();
  extensionMod.default(fakePi.api);
  const command = fakePi.commands.get('grump');
  assert.ok(command, 'expected /grump command to be registered');
  const extensionCtx = makeExtensionCtx(cwd, {
    hasUI: false,
    model: undefined,
    modelRegistry: {
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

test('grump set persists identity and status can be shown from config', async () => {
  await withTempDir(async (cwd) => {
    const { command, ctx, notifications } = setupExtension(cwd);

    await command.handler('set gramps', ctx);
    const saved = await readProjectConfig(cwd);

    assert.equal(saved.identity?.name, 'Gramps');
    assert.equal(saved.identity?.rarity, 'Legendary');
    assert.ok(notifications.some((entry) => /Gramps · Legendary/.test(entry.message)));

    notifications.length = 0;
    await command.handler('status', ctx);
    assert.ok(notifications.some((entry) => /Gramps · Legendary/.test(entry.message)));
  });
});

test('first /grump manifests Gramps, while reset still rolls randomly', async () => {
  await withTempDir(async (cwd) => {
    const { command, ctx } = setupExtension(cwd);
    const originalRandom = Math.random;
    Math.random = () => 0.95;
    try {
      await command.handler('', ctx);
      let saved = await readProjectConfig(cwd);
      assert.equal(saved.identity?.name, 'Gramps');
      assert.equal(saved.identity?.rarity, 'Legendary');

      await command.handler('reset', ctx);
      saved = await readProjectConfig(cwd);
      assert.notEqual(saved.identity?.name, 'Gramps');
      assert.notEqual(saved.identity?.rarity, 'Legendary');
    } finally {
      Math.random = originalRandom;
    }
  });
});

test('grump off and on persist muted/enabled flags', async () => {
  await withTempDir(async (cwd) => {
    const { command, ctx } = setupExtension(cwd);

    await command.handler('off', ctx);
    let saved = await readProjectConfig(cwd);
    assert.equal(saved.muted, true);

    await command.handler('on', ctx);
    saved = await readProjectConfig(cwd);
    assert.equal(saved.muted, false);
    assert.equal(saved.enabled, true);
  });
});

test('grump model configured persists provider and model choice', async () => {
  await withTempDir(async (cwd) => {
    const { command, ctx } = setupExtension(cwd);

    await command.handler('model configured openai gpt-test', ctx);
    const saved = await readProjectConfig(cwd);

    assert.equal(saved.commentary?.reactionModel?.mode, 'configured');
    assert.equal(saved.commentary?.reactionModel?.provider, 'openai');
    assert.equal(saved.commentary?.reactionModel?.model, 'gpt-test');
  });
});

test('grump whisper works once an identity exists and local-only mode is set', async () => {
  await withTempDir(async (cwd) => {
    const { command, ctx, notifications } = setupExtension(cwd);

    await command.handler('set gramps', ctx);
    await command.handler('model local-only', ctx);
    notifications.length = 0;

    await command.handler('whisper hello there', ctx);

    assert.ok(notifications.some((entry) => /Hrmph\. I'm listening\.|Go on then\./.test(entry.message)));
  });
});

test('grump command completions cover set selections and configured providers', async () => {
  await withTempDir(async (cwd) => {
    const { command } = setupExtension(cwd);

    const setCompletions = command.getArgumentCompletions('set gr');
    const configuredCompletions = command.getArgumentCompletions('model configured go');

    assert.ok(setCompletions?.some((entry) => entry.value === 'set gramps'));
    assert.ok(configuredCompletions?.some((entry) => entry.value === 'model configured google'));
    assert.ok(configuredCompletions?.some((entry) => entry.value === 'model configured google-vertex'));
  });
});

test('grump model configured without a model shows usage help', async () => {
  await withTempDir(async (cwd) => {
    const { command, ctx, notifications } = setupExtension(cwd);

    await command.handler('model configured openai', ctx);

    assert.ok(notifications.some((entry) => /usage: \/grump model configured <provider> <model>/i.test(entry.message)));
  });
});
