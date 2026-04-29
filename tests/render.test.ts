import { describe, expect, test } from "vitest";
import type { DiffEntry } from "../src/diff.js";
import { renderComment } from "../src/render.js";

const entry = (e: Partial<DiffEntry> & Pick<DiffEntry, "test_id" | "metric" | "current_score" | "status">): DiffEntry => ({
  base_score: 0,
  delta: 0,
  ...e,
});

describe("renderComment", () => {
  test("renders header with eval count and short commit sha", () => {
    const md = renderComment([
      entry({ test_id: "t::a", metric: "exact_match", base_score: 1.0, current_score: 1.0, delta: 0, status: "unchanged" }),
    ], { commit: "a1b2c3d4e5f6" });

    expect(md).toContain("## evalcheck");
    expect(md).toContain("1 eval");
    expect(md).toContain("a1b2c3d");
  });

  test("pluralises evals correctly for >1", () => {
    const md = renderComment([
      entry({ test_id: "a", metric: "x", base_score: 1, current_score: 1, delta: 0, status: "unchanged" }),
      entry({ test_id: "b", metric: "x", base_score: 1, current_score: 1, delta: 0, status: "unchanged" }),
    ], { commit: "abc" });

    expect(md).toContain("2 evals");
  });

  test("includes a row per diff entry with base score, current score, delta", () => {
    const md = renderComment([
      entry({
        test_id: "test_summarization",
        metric: "faithfulness",
        base_score: 0.84,
        current_score: 0.71,
        delta: -0.13,
        status: "regressed",
      }),
    ], { commit: "abc" });

    expect(md).toContain("test_summarization::faithfulness");
    expect(md).toContain("0.84");
    expect(md).toContain("0.71");
    expect(md).toContain("-0.13");
  });

  test("formats positive deltas with leading plus sign", () => {
    const md = renderComment([
      entry({ test_id: "a", metric: "x", base_score: 0.5, current_score: 0.6, delta: 0.1, status: "improved" }),
    ], { commit: "abc" });

    expect(md).toContain("+0.10");
  });

  test("shows em dash for unchanged delta", () => {
    const md = renderComment([
      entry({ test_id: "a", metric: "x", base_score: 0.87, current_score: 0.87, delta: 0, status: "unchanged" }),
    ], { commit: "abc" });

    expect(md).toMatch(/\| —\s*\|/);
  });

  test("shows em dash for base score on new entries", () => {
    const md = renderComment([
      entry({ test_id: "a", metric: "x", base_score: null, current_score: 0.9, delta: null, status: "new" }),
    ], { commit: "abc" });

    expect(md).toMatch(/\| —\s*\| 0\.90 \|/);
  });

  test("includes summary line with regression/improvement counts", () => {
    const md = renderComment([
      entry({ test_id: "a", metric: "x", base_score: 0.9, current_score: 0.7, delta: -0.2, status: "regressed" }),
      entry({ test_id: "b", metric: "x", base_score: 0.5, current_score: 0.8, delta: 0.3, status: "improved" }),
      entry({ test_id: "c", metric: "x", base_score: 0.5, current_score: 0.5, delta: 0, status: "unchanged" }),
      entry({ test_id: "d", metric: "x", base_score: null, current_score: 1.0, delta: null, status: "new" }),
    ], { commit: "abc" });

    expect(md).toContain("1 regression");
    expect(md).toContain("1 improvement");
    expect(md).toContain("1 unchanged");
    expect(md).toContain("1 new");
  });

  test("empty diff produces a 'no evals' message", () => {
    const md = renderComment([], { commit: "abc" });
    expect(md).toContain("no evals");
    expect(md).not.toContain("|"); // no table
  });
});
