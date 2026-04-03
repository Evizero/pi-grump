import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { importDist, makeBaseConfig } from './helpers.mjs';

const identity = await importDist('domain', 'identity.js');
const runtime = await importDist('state', 'runtime.js');
const widget = await importDist('ui', 'widget.js');
const timers = await importDist('utils', 'timers.js');

const grump = identity.makeIdentityFromSelection('gramps');

test('buildPresentation switches between compact and wide layouts', () => {
  const config = makeBaseConfig({ ui: { minColsFullSprite: 100 } });
  const state = runtime.createInitialRuntimeState();
  state.identity = grump;

  const compact = widget.buildPresentation(grump, state, config, 40);
  const wide = widget.buildPresentation(grump, state, config, 160);

  assert.equal(compact?.compact, true);
  assert.ok(compact?.laneLines[0]?.includes('Gramps'));
  assert.equal(wide?.compact, false);
  assert.ok(Array.isArray(wide?.laneLines) && wide.laneLines.length > 1);
});

test('buildPresentation shows a speech bubble when a reaction is visible', () => {
  const config = makeBaseConfig({ ui: { reactionShowMs: 1_000, reactionFadeMs: 200 } });
  const state = runtime.createInitialRuntimeState();
  state.identity = grump;
  state.reactionText = 'That clanker needs adult supervision.';
  state.reactionStartedAt = Date.now();

  const presentation = widget.buildPresentation(grump, state, config, 160);
  assert.equal(presentation?.compact, false);
  assert.ok((presentation?.bubbleLines.length || 0) > 0);
});

test('setReactionVisible clears reaction text after the configured timeout', async () => {
  const config = makeBaseConfig({ ui: { reactionShowMs: 40, reactionFadeMs: 10 } });
  const state = runtime.createInitialRuntimeState();
  const syncCalls = [];
  let renderCalls = 0;
  const ctx = { hasUI: false };

  runtime.setReactionVisible(
    state,
    ctx,
    'hello grump',
    config,
    () => {
      renderCalls += 1;
    },
    () => {
      syncCalls.push(Date.now());
    },
  );

  assert.equal(state.reactionText, 'hello grump');
  assert.ok(state.reactionStartedAt);

  await sleep(60);

  assert.equal(state.reactionText, null);
  assert.equal(state.reactionStartedAt, null);
  assert.ok(syncCalls.length >= 2);
  assert.ok(renderCalls >= 2);
  timers.clearTimers(state);
});
