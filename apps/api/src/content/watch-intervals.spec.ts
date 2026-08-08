/**
 * Watch progress — SRS FR-VID-009, FR-VID-010, BR-VID-04.
 *
 * The rule under test is that progress comes from DISTINCT intervals. Get it
 * wrong and a student can loop the first thirty seconds of a lecture, be
 * credited with completing it, and have that feed straight into the video
 * component of progress and therefore into certification.
 */

import { applyWatchUpdate, mergeIntervals, totalWatchedSeconds, type Interval } from "./watch-intervals";

describe("mergeIntervals", () => {
  it("merges overlapping intervals", () => {
    expect(mergeIntervals([[0, 100], [50, 150]])).toEqual([[0, 150]]);
  });

  it("joins adjacent intervals", () => {
    // A player reporting every 15 seconds produces exactly this pattern.
    // Leaving them separate would fragment the set without changing the total.
    expect(mergeIntervals([[0, 15], [15, 30], [30, 45]])).toEqual([[0, 45]]);
  });

  it("keeps genuine gaps apart", () => {
    // A student who watched the opening and the ending has NOT watched the
    // middle, and the set must say so.
    expect(mergeIntervals([[0, 100], [500, 600]])).toEqual([[0, 100], [500, 600]]);
  });

  it("sorts input that arrives out of order", () => {
    // Seeking backwards is normal viewing behaviour, so reports arrive
    // unordered.
    expect(mergeIntervals([[500, 600], [0, 100], [90, 200]])).toEqual([[0, 200], [500, 600]]);
  });

  it("swallows an interval fully contained in another", () => {
    expect(mergeIntervals([[0, 500], [100, 200]])).toEqual([[0, 500]]);
  });

  it("discards zero-length and inverted intervals", () => {
    // A paused player can report start == end; a buggy one can report an
    // inverted range. Neither is watching.
    expect(mergeIntervals([[10, 10], [50, 20], [0, 5]])).toEqual([[0, 5]]);
  });

  it("clamps negative starts rather than producing negative progress", () => {
    expect(mergeIntervals([[-50, 20]])).toEqual([[0, 20]]);
  });

  it("returns an empty set for empty input", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe("totalWatchedSeconds — FR-VID-010, the anti-gaming rule", () => {
  it("does NOT accumulate progress from replaying one segment", () => {
    // The rule that makes video progress meaningful. Ten loops of the first
    // 30 seconds is 30 seconds watched, not 300.
    const looped: Interval[] = Array.from({ length: 10 }, () => [0, 30] as Interval);
    expect(totalWatchedSeconds(looped)).toBe(30);
  });

  it("sums genuinely distinct viewing", () => {
    expect(totalWatchedSeconds([[0, 100], [200, 300]])).toBe(200);
  });

  it("counts overlapping viewing once", () => {
    expect(totalWatchedSeconds([[0, 100], [50, 150]])).toBe(150);
  });
});

describe("applyWatchUpdate", () => {
  const duration = 600; // a 10-minute lecture

  it("folds new intervals into what was already recorded", () => {
    const r = applyWatchUpdate({
      existing: [[0, 120]],
      reported: [[120, 240]],
      durationSeconds: duration,
      lastPositionSeconds: 240,
    });
    expect(r.intervals).toEqual([[0, 240]]);
    expect(r.watchedSeconds).toBe(240);
    expect(r.watchedPercent).toBe(40);
  });

  it("marks complete at the threshold, not before", () => {
    const just = applyWatchUpdate({
      existing: [[0, 539]], // 89.83%
      reported: [],
      durationSeconds: duration,
      lastPositionSeconds: 539,
    });
    expect(just.isComplete).toBe(false);

    const over = applyWatchUpdate({
      existing: [[0, 540]], // exactly 90%
      reported: [],
      durationSeconds: duration,
      lastPositionSeconds: 540,
    });
    expect(over.isComplete).toBe(true);
  });

  it("honours a configured completion threshold (CFG-PRG-05)", () => {
    const r = applyWatchUpdate({
      existing: [[0, 480]], // 80%
      reported: [],
      durationSeconds: duration,
      lastPositionSeconds: 480,
      completionThresholdPercent: 75,
    });
    expect(r.isComplete).toBe(true);
  });

  it("reports 0% honestly when the duration is unknown", () => {
    // A freshly catalogued lecture may have no duration yet. Guessing would
    // feed a fabricated number into progress and certification.
    const r = applyWatchUpdate({
      existing: [[0, 300]],
      reported: [],
      durationSeconds: null,
      lastPositionSeconds: 300,
    });
    expect(r.watchedPercent).toBe(0);
    expect(r.isComplete).toBe(false);
    expect(r.watchedSeconds).toBe(300); // the seconds are still recorded
  });

  it("clamps a client reporting beyond the true duration", () => {
    // The server never trusts the client. A report of 1200 seconds on a
    // 600-second video must not exceed 100%.
    const r = applyWatchUpdate({
      existing: [],
      reported: [[0, 1200]],
      durationSeconds: duration,
      lastPositionSeconds: 1200,
    });
    expect(r.watchedPercent).toBe(100);
    expect(r.lastPositionSeconds).toBe(600);
  });

  it("keeps the resume position inside the video (FR-VID-008)", () => {
    // A resume point past the end looks broken to the student.
    const r = applyWatchUpdate({
      existing: [],
      reported: [[0, 60]],
      durationSeconds: duration,
      lastPositionSeconds: -20,
    });
    expect(r.lastPositionSeconds).toBe(0);
  });

  it("a student who skips to the end is NOT complete", () => {
    // Seeking to 09:59 and stopping is one second of viewing, and the
    // interval set is what proves it.
    const r = applyWatchUpdate({
      existing: [],
      reported: [[599, 600]],
      durationSeconds: duration,
      lastPositionSeconds: 600,
    });
    expect(r.watchedPercent).toBeCloseTo(0.2, 1);
    expect(r.isComplete).toBe(false);
  });
});
