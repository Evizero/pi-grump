const assert = require('node:assert/strict');
const path = require('node:path');

const mod = require(path.join(__dirname, '..', 'dist', 'index.js'));
const store = require(path.join(__dirname, '..', 'dist', 'config', 'store.js'));
assert.equal(typeof mod.default, 'function', 'extension should export a default function');
assert.match(store.loadPrompt('system.md'), /Pi-Grump/, 'system prompt should be loadable after build');

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

for (const requiredEvent of ['session_start', 'session_switch', 'turn_start', 'tool_execution_end', 'turn_end', 'before_agent_start']) {
  assert(events.includes(requiredEvent), `expected event registration for ${requiredEvent}`);
}
for (const requiredCommand of ['grump']) {
  assert(commands.includes(requiredCommand), `expected command registration for ${requiredCommand}`);
}

console.log('smoke ok');
