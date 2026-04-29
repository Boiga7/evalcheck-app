import type { DiffEntry } from "./diff.js";

export type RenderMeta = {
  commit: string;
};

export function renderComment(entries: DiffEntry[], meta: RenderMeta): string {
  if (entries.length === 0) {
    return `## evalcheck\n\nno evals run on commit ${shortSha(meta.commit)}.`;
  }

  const counts = countByStatus(entries);
  const summary = renderSummary(counts);
  const noun = entries.length === 1 ? "eval" : "evals";

  const header = `## evalcheck — ${entries.length} ${noun} run on commit ${shortSha(meta.commit)}`;
  const table = renderTable(entries);

  return `${header}\n\n${table}\n\n${summary}`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function countByStatus(entries: DiffEntry[]) {
  return entries.reduce(
    (acc, e) => {
      acc[e.status]++;
      return acc;
    },
    { regressed: 0, improved: 0, unchanged: 0, new: 0 },
  );
}

function renderSummary(counts: ReturnType<typeof countByStatus>): string {
  const parts: string[] = [];
  if (counts.regressed) parts.push(`${counts.regressed} regression${counts.regressed === 1 ? "" : "s"}`);
  if (counts.improved) parts.push(`${counts.improved} improvement${counts.improved === 1 ? "" : "s"}`);
  if (counts.unchanged) parts.push(`${counts.unchanged} unchanged`);
  if (counts.new) parts.push(`${counts.new} new`);
  return parts.join(", ") + ".";
}

function renderTable(entries: DiffEntry[]): string {
  const header = "| Eval | base | this PR | Δ |";
  const sep = "|---|---|---|---|";
  const rows = entries.map((e) => {
    const id = `${e.test_id}::${e.metric}`;
    const base = e.base_score === null ? "—" : e.base_score.toFixed(2);
    const current = e.current_score.toFixed(2);
    const delta = renderDelta(e);
    return `| ${id} | ${base} | ${current} | ${delta} |`;
  });
  return [header, sep, ...rows].join("\n");
}

function renderDelta(e: DiffEntry): string {
  if (e.delta === null) return "—";
  if (Math.abs(e.delta) < 0.005) return "—";
  const sign = e.delta > 0 ? "+" : "";
  return `${sign}${e.delta.toFixed(2)}`;
}
