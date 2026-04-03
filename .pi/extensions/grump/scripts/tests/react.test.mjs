import test from 'node:test';
import assert from 'node:assert/strict';
import { importDist, makeBaseConfig, makeModelRegistry, makeBranchCtx } from './helpers.mjs';

const react = await importDist('generation', 'react.js');
const identity = await importDist('domain', 'identity.js');
const runtime = await importDist('state', 'runtime.js');

function makeReactionCtx({ model, modelRegistry, branch = [] } = {}) {
  return {
    hasUI: false,
    signal: undefined,
    model,
    modelRegistry: modelRegistry || makeModelRegistry(),
    sessionManager: makeBranchCtx(branch).sessionManager,
  };
}

test('describeReactionBackend reports local-only mode directly', async () => {
  const ctx = makeReactionCtx();
  const config = makeBaseConfig({ commentary: { reactionModel: { mode: 'local-only', allowActiveModelFallback: false } } });

  const summary = await react.describeReactionBackend(ctx, config);
  assert.equal(summary, 'grump mode: local-only');
});

test('describeReactionBackend uses auto provider mapping when auth is available', async () => {
  const activeModel = { provider: 'openai', id: 'gpt-5.4' };
  const registry = makeModelRegistry({
    find(provider, model) {
      if (provider === 'openai' && model === 'gpt-5.4-mini') return { provider, id: model };
      return undefined;
    },
    async getApiKeyAndHeaders(model) {
      if (model?.provider === 'openai' && model?.id === 'gpt-5.4-mini') return { ok: true, apiKey: 'test-key' };
      return { ok: false };
    },
  });
  const ctx = makeReactionCtx({ model: activeModel, modelRegistry: registry });
  const config = makeBaseConfig();

  const summary = await react.describeReactionBackend(ctx, config);
  assert.equal(summary, 'grump mode: auto (openai/gpt-5.4-mini)');
});

test('describeReactionBackend falls back to active model when configured override is unavailable', async () => {
  const activeModel = { provider: 'anthropic', id: 'claude-sonnet-4-5' };
  const registry = makeModelRegistry({
    find() {
      return undefined;
    },
    async getApiKeyAndHeaders(model) {
      if (model === activeModel) return { ok: true, apiKey: 'active-key' };
      return { ok: false };
    },
  });
  const ctx = makeReactionCtx({ model: activeModel, modelRegistry: registry });
  const config = makeBaseConfig({
    commentary: {
      reactionModel: {
        mode: 'configured',
        provider: 'openai',
        model: 'gpt-test',
        allowActiveModelFallback: true,
        allowLocalFallback: true,
      },
    },
  });

  const summary = await react.describeReactionBackend(ctx, config);
  assert.equal(summary, 'grump mode: configured (active fallback: anthropic/claude-sonnet-4-5)');
});

test('model reaction discard helper rejects meta-trigger talk and fake-secret hedging', () => {
  const toolFailureNomination = {
    kind: 'tool_failure',
    score: 5,
    summary: 'tool failed',
    evidence: [],
    source: 'test',
    createdAt: Date.now(),
    recentScope: 'small',
  };
  const sensitiveNomination = { ...toolFailureNomination, kind: 'sensitive_material' };

  assert.equal(react.__test_shouldDiscardModelReaction('Looks like the heuristic triggered on this event.', toolFailureNomination), true);
  assert.equal(react.__test_shouldDiscardModelReaction('Probably not real, maybe a fake placeholder secret.', sensitiveNomination), true);
  assert.equal(react.__test_shouldDiscardModelReaction('Lovely. Credentials in plain view.', sensitiveNomination), false);
});

test('generateReaction local fallback avoids repeating the most recent local whisper line', async () => {
  const ctx = makeReactionCtx();
  const config = makeBaseConfig({ commentary: { reactionModel: { mode: 'local-only', allowActiveModelFallback: false, allowLocalFallback: true } } });
  const state = runtime.createInitialRuntimeState();
  state.reactionHistory.push("Hrmph. I'm listening.");
  const gramps = identity.makeIdentityFromSelection('gramps');
  const nomination = {
    kind: 'whisper',
    score: 99,
    summary: 'Manual whisper to grump',
    evidence: ['whisper=hello'],
    source: 'command',
    createdAt: Date.now(),
    recentScope: 'small',
  };

  const text = await react.generateReaction(ctx, gramps, nomination, state, config);
  assert.equal(text, 'Go on then.');
});
