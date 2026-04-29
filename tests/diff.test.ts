import { describe, expect, test } from "vitest";
import { diff } from "../src/diff.js";
import type { SnapshotFile } from "../src/snapshot.js";

const ts = "2026-04-29T10:00:00Z";

function file(...runs: Array<{ test_id: string; metric: string; score: number }>): SnapshotFile {
  return {
    schema_version: 1,
    runs: runs.map((r) => ({ ...r, threshold: null, timestamp: ts })),
  };
}

describe("diff", () => {
  test("flags a regression when score drops beyond tolerance", () => {
    const baseline = file({ test_id: "t::a", metric: "faithfulness", score: 0.85 });
    const current = file({ test_id: "t::a", metric: "faithfulness", score: 0.71 });

    const result = diff(baseline, current);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      test_id: "t::a",
      metric: "faithfulness",
      base_score: 0.85,
      current_score: 0.71,
      status: "regressed",
    });
    expect(result[0]!.delta).toBeCloseTo(-0.14, 5);
  });

  test("flags an improvement when score rises beyond tolerance", () => {
    const baseline = file({ test_id: "t::a", metric: "relevance", score: 0.7 });
    const current = file({ test_id: "t::a", metric: "relevance", score: 0.92 });

    const [entry] = diff(baseline, current);

    expect(entry).toMatchObject({
      status: "improved",
      base_score: 0.7,
      current_score: 0.92,
    });
    expect(entry!.delta).toBeCloseTo(0.22, 5);
  });

  test("marks within-tolerance changes as unchanged", () => {
    const baseline = file({ test_id: "t::a", metric: "exact_match", score: 0.87 });
    const current = file({ test_id: "t::a", metric: "exact_match", score: 0.87 });

    const [entry] = diff(baseline, current);
    expect(entry!.status).toBe("unchanged");
  });

  test("uses configurable tolerance", () => {
    const baseline = file({ test_id: "t::a", metric: "x", score: 0.5 });
    const current = file({ test_id: "t::a", metric: "x", score: 0.55 });

    expect(diff(baseline, current, { tolerance: 0.1 })[0]!.status).toBe("unchanged");
    expect(diff(baseline, current, { tolerance: 0.01 })[0]!.status).toBe("improved");
  });

  test("marks tests new when absent from baseline", () => {
    const baseline = file();
    const current = file({ test_id: "t::a", metric: "exact_match", score: 1.0 });

    const [entry] = diff(baseline, current);

    expect(entry).toMatchObject({
      test_id: "t::a",
      base_score: null,
      delta: null,
      status: "new",
    });
  });

  test("skips tests that are in baseline but missing from current", () => {
    const baseline = file(
      { test_id: "t::a", metric: "x", score: 0.5 },
      { test_id: "t::b", metric: "x", score: 0.7 },
    );
    const current = file({ test_id: "t::a", metric: "x", score: 0.5 });

    const result = diff(baseline, current);

    expect(result).toHaveLength(1);
    expect(result[0]!.test_id).toBe("t::a");
  });

  test("treats same test_id with different metric as separate entries", () => {
    const baseline = file({ test_id: "t::a", metric: "faithfulness", score: 0.8 });
    const current = file(
      { test_id: "t::a", metric: "faithfulness", score: 0.8 },
      { test_id: "t::a", metric: "relevance", score: 0.9 },
    );

    const result = diff(baseline, current);

    expect(result).toHaveLength(2);
    const relevance = result.find((r) => r.metric === "relevance")!;
    expect(relevance.status).toBe("new");
  });

  test("returns empty array when both files are empty", () => {
    expect(diff(file(), file())).toEqual([]);
  });
});
