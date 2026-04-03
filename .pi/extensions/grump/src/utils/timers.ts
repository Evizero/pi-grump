import type { RuntimeState } from "../domain/types.js";

export function replaceTimer(state: RuntimeState, key: keyof RuntimeState["timers"], timer: NodeJS.Timeout | undefined): void {
  const existing = state.timers[key];
  if (existing) clearTimeout(existing);
  if (timer) state.timers[key] = timer;
  else delete state.timers[key];
}

export function clearTimers(state: RuntimeState): void {
  for (const timer of Object.values(state.timers)) {
    if (timer) clearTimeout(timer);
  }
  state.timers = {};
}
