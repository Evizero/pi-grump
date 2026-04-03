import test from 'node:test';
import assert from 'node:assert/strict';
import { importDist, withTempDir } from './helpers.mjs';

const store = await importDist('config', 'store.js');
const text = await importDist('utils', 'text.js');

test('saveConfigPatch deep-merges nested reaction model settings and preserves defaults on load', async () => {
  await withTempDir(async (cwd) => {
    await store.saveConfigPatch(cwd, {
      commentary: {
        reactionModel: {
          mode: 'configured',
          provider: 'openai',
          model: 'gpt-test',
          allowActiveModelFallback: false,
          allowLocalFallback: true,
        },
      },
    });
    await store.saveConfigPatch(cwd, { muted: true });

    const loaded = store.loadConfig(cwd);

    assert.equal(loaded.muted, true);
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.commentary.recentMessages, 6);
    assert.equal(loaded.commentary.reactionModel.mode, 'configured');
    assert.equal(loaded.commentary.reactionModel.provider, 'openai');
    assert.equal(loaded.commentary.reactionModel.model, 'gpt-test');
    assert.equal(loaded.commentary.reactionModel.allowActiveModelFallback, false);
    assert.equal(loaded.commentary.reactionModel.allowLocalFallback, true);
  });
});

test('loadPrompt returns empty string for missing prompt files', () => {
  assert.equal(store.loadPrompt('missing-does-not-exist.md'), '');
});

test('anonymizeSensitiveText redacts private key blocks and secret assignments', () => {
  const input = [
    'PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    'OPENAI_API_KEY="sk-abcdefghijklmnopqrstuvwxyz123456"',
  ].join('\n');

  const output = text.anonymizeSensitiveText(input);

  assert.match(output, /PRIVATE_KEY=<PRIVATE_KEY_PEM>/);
  assert.match(output, /OPENAI_API_KEY="?<OPENAI_KEY sk-abc… len=35>"?/);
});

test('looksLikeRealSecretValue rejects placeholders and URLs but accepts random-looking secrets', () => {
  assert.equal(text.looksLikeRealSecretValue('your_token'), false);
  assert.equal(text.looksLikeRealSecretValue('https://example.com/token'), false);
  assert.equal(text.looksLikeRealSecretValue('AbCd1234efGh5678'), true);
});

test('getKnownSecretMatches finds multiple token families in one blob', () => {
  const blob = 'ghp_abcdefghijklmnopqrstuvwxyz OPENAI=sk-abcdefghijklmnopqrstuvwxyz123456';
  const matches = text.getKnownSecretMatches(blob);

  assert.ok(matches.some((entry) => entry.placeholder === 'GITHUB_TOKEN'));
  assert.ok(matches.some((entry) => entry.placeholder === 'OPENAI_KEY'));
});
