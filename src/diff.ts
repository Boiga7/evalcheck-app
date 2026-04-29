// Compares a baseline snapshot to the current run's snapshot and produces
// one entry per test+metric in the current run. Tests that were in the
// baseline but disappeared from the current run are dropped silently —
// users renaming or removing tests shouldn't get nagged forever.

import type { Snapshot, SnapshotFile } from "./snapshot.js";

export type DiffStatus = "regressed" | "improved" | "unchanged" | "new";

export type DiffEntry = {
  test_id: string;
  metric: string;
  base_score: number | null; // null when the test is new
  current_score: number;
  delta: number | null; // null when the test is new
  status: DiffStatus;
};

export type DiffOptions = {
  // Anything within +/- tolerance of the baseline is "unchanged". The
  // default mirrors the plugin's regression_tolerance default so that
  // a test that the plugin lets through doesn't show up here as moved.
  tolerance?: number;
};

const DEFAULT_TOLERANCE = 0.01;

// Tests aren't unique by id alone — a single test can run multiple metrics
// (faithfulness AND relevance, say). The composite key keeps them apart.
function key(s: Pick<Snapshot, "test_id" | "metric">): string {
  return `${s.test_id}::${s.metric}`;
}

export function diff(
  baseline: SnapshotFile,
  current: SnapshotFile,
  options: DiffOptions = {},
): DiffEntry[] {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const baselineByKey = new Map(baseline.runs.map((r) => [key(r), r]));

  return current.runs.map((run) => {
    const base = baselineByKey.get(key(run));
    if (!base) {
      return {
        test_id: run.test_id,
        metric: run.metric,
        base_score: null,
        current_score: run.score,
        delta: null,
        status: "new" as const,
      };
    }
    const delta = run.score - base.score;
    const status: DiffStatus =
      delta > tolerance
        ? "improved"
        : delta < -tolerance
          ? "regressed"
          : "unchanged";
    return {
      test_id: run.test_id,
      metric: run.metric,
      base_score: base.score,
      current_score: run.score,
      delta,
      status,
    };
  });
}
