import type { Snapshot, SnapshotFile } from "./snapshot.js";

export type DiffStatus = "regressed" | "improved" | "unchanged" | "new";

export type DiffEntry = {
  test_id: string;
  metric: string;
  base_score: number | null;
  current_score: number;
  delta: number | null;
  status: DiffStatus;
};

export type DiffOptions = {
  tolerance?: number;
};

const DEFAULT_TOLERANCE = 0.01;

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
