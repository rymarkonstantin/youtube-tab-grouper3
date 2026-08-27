import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  snapshotTimers,
  startTimers,
  stopTimers,
  updateTimerPhase,
} from "../../src/sidepanel/timers";

describe("side-panel timers", () => {
  it("tracks total elapsed time and resets operation time on phase changes", () => {
    let timers = startTimers(1_000, "checking");
    timers = updateTimerPhase(timers, "metadata", 4_500);
    expect(snapshotTimers(timers, 6_000)).toEqual({ totalMs: 5_000, operationMs: 1_500 });
  });

  it("freezes both timers when stopped", () => {
    const timers = stopTimers(
      updateTimerPhase(startTimers(0, "checking"), "classifying", 2_000),
      5_000,
    );
    expect(snapshotTimers(timers, 9_000)).toEqual({ totalMs: 5_000, operationMs: 3_000 });
  });

  it("formats short and long durations", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(69_000)).toBe("01:09");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });
});
