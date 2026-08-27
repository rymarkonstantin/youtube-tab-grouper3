import {
  formatElapsed,
  snapshotTimers,
  startTimers,
  stopTimers,
  updateTimerPhase,
  type TimerState,
} from "./timers";

let state: TimerState | undefined;
let interval: number | undefined;

function render(now: number): void {
  const timers = document.querySelector<HTMLElement>("#timers");
  if (!timers || !state) return;
  const snapshot = snapshotTimers(state, now);
  timers.hidden = false;
  const total = document.querySelector<HTMLElement>("#total-elapsed");
  const operation = document.querySelector<HTMLElement>("#operation-elapsed");
  if (total) total.textContent = formatElapsed(snapshot.totalMs);
  if (operation) operation.textContent = formatElapsed(snapshot.operationMs);
}

export function beginTimer(): void {
  const now = Date.now();
  state = startTimers(now, "checking");
  if (interval !== undefined) window.clearInterval(interval);
  interval = window.setInterval(() => render(Date.now()), 1_000);
  render(now);
}

export function setTimerPhase(phase: string): void {
  if (!state) return;
  state = updateTimerPhase(state, phase, Date.now());
  render(Date.now());
}

export function endTimer(): void {
  if (!state) return;
  state = stopTimers(state, Date.now());
  render(Date.now());
  if (interval !== undefined) window.clearInterval(interval);
  interval = undefined;
}

export function disposeTimer(): void {
  endTimer();
  state = undefined;
  const timers = document.querySelector<HTMLElement>("#timers");
  if (timers) timers.hidden = true;
}
