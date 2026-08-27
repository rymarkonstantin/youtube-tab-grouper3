export interface TimerState {
  startedAt: number;
  phaseStartedAt: number;
  phase: string;
  stoppedAt?: number;
}

export interface TimerSnapshot {
  totalMs: number;
  operationMs: number;
}

export function startTimers(now: number, phase: string): TimerState {
  return { startedAt: now, phaseStartedAt: now, phase };
}

export function updateTimerPhase(state: TimerState, phase: string, now: number): TimerState {
  return state.phase === phase ? state : { ...state, phase, phaseStartedAt: now };
}

export function stopTimers(state: TimerState, now: number): TimerState {
  return state.stoppedAt === undefined ? { ...state, stoppedAt: now } : state;
}

export function snapshotTimers(state: TimerState, now: number): TimerSnapshot {
  const end = state.stoppedAt ?? now;
  return {
    totalMs: Math.max(0, end - state.startedAt),
    operationMs: Math.max(0, end - state.phaseStartedAt),
  };
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
