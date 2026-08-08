/**
 * Watch progress — SRS FR-VID-009, FR-VID-010.
 *
 * FR-VID-010 is the rule that makes this non-trivial: progress is computed
 * from DISTINCT viewed intervals, so replaying one segment repeatedly does not
 * accumulate spurious progress.
 *
 * Without it, a student can loop the first thirty seconds of a lecture and be
 * credited with completing it — which would make the video component of
 * progress (Figure 5-3), and therefore certification, meaningless.
 *
 * A pure function, because the server must never trust a client-supplied
 * percentage: it merges what the client reports and recomputes the figure
 * itself.
 */

/** A closed-open interval [start, end) in whole seconds. */
export type Interval = [number, number];

/**
 * Merges overlapping and adjacent intervals into a minimal disjoint set.
 *
 * Adjacent intervals are joined ([0,10] and [10,20] become [0,20]) because a
 * player reporting position every fifteen seconds produces exactly that
 * pattern, and leaving them separate would fragment the set without changing
 * the total.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const clean = intervals
    .map(([s, e]) => [Math.max(0, Math.floor(s)), Math.max(0, Math.floor(e))] as Interval)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  if (clean.length === 0) return [];

  const merged: Interval[] = [clean[0] as Interval];
  for (let i = 1; i < clean.length; i++) {
    const current = clean[i] as Interval;
    const last = merged[merged.length - 1] as Interval;
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export function totalWatchedSeconds(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, [s, e]) => sum + (e - s), 0);
}

export interface WatchUpdate {
  intervals: Interval[];
  watchedSeconds: number;
  watchedPercent: number;
  isComplete: boolean;
  lastPositionSeconds: number;
}

/**
 * Folds newly reported intervals into what was already recorded.
 *
 * `durationSeconds` may be unknown for a freshly catalogued lecture, in which
 * case the percentage is honestly 0 rather than a guess — a fabricated
 * percentage would feed straight into progress and certification.
 */
export function applyWatchUpdate(input: {
  existing: Interval[];
  reported: Interval[];
  durationSeconds: number | null;
  lastPositionSeconds: number;
  /** CFG-PRG-05, default 90 %. */
  completionThresholdPercent?: number;
}): WatchUpdate {
  const merged = mergeIntervals([...input.existing, ...input.reported]);
  const watchedSeconds = merged.reduce((sum, [s, e]) => sum + (e - s), 0);

  const duration = input.durationSeconds;
  // Clamped: a client reporting intervals beyond the true duration must not
  // push a student past the completion threshold.
  const percent =
    duration && duration > 0
      ? Math.min(100, Math.round((watchedSeconds / duration) * 1000) / 10)
      : 0;

  const threshold = input.completionThresholdPercent ?? 90;

  return {
    intervals: merged,
    watchedSeconds,
    watchedPercent: percent,
    isComplete: duration != null && duration > 0 && percent >= threshold,
    // Clamped to the duration so a bad report cannot leave the resume point
    // past the end of the video, where it would look broken (FR-VID-008).
    lastPositionSeconds:
      duration && duration > 0
        ? Math.max(0, Math.min(input.lastPositionSeconds, duration))
        : Math.max(0, input.lastPositionSeconds),
  };
}
