import { getInstallationToken } from "./auth.js";
import {
  downloadArtifactJson,
  findArtifact,
  getRepoFile,
  setCheckRun,
  upsertComment,
} from "./api.js";
import { diff, type DiffEntry } from "./diff.js";
import { renderComment } from "./render.js";
import type { SnapshotFile } from "./snapshot.js";
import type { WorkflowRunEvent } from "./webhook.js";

const ARTIFACT_NAME = "evalcheck-results";
const RESULTS_FILENAME = ".evalcheck/results.json";
const BASELINE_PATH = ".evalcheck/snapshots/baseline.json";

export type Env = {
  appId: string;
  privateKey: string;
};

export async function handleWorkflowRun(event: WorkflowRunEvent, env: Env): Promise<void> {
  const { workflow_run, repository, installation } = event;
  const owner = repository.owner.login;
  const repo = repository.name;

  if (workflow_run.pull_requests.length === 0) return;

  const token = await getInstallationToken(env.appId, env.privateKey, installation.id);

  const artifact = await findArtifact(token, owner, repo, workflow_run.id, ARTIFACT_NAME);
  if (!artifact) return;

  const resultsRaw = await downloadArtifactJson(
    token,
    owner,
    repo,
    artifact.id,
    RESULTS_FILENAME,
  );
  if (!resultsRaw) return;

  const current = parseSnapshotFile(resultsRaw);

  for (const pr of workflow_run.pull_requests) {
    const baselineRaw = await getRepoFile(token, owner, repo, BASELINE_PATH, pr.base.ref);
    const baseline: SnapshotFile = baselineRaw
      ? parseSnapshotFile(baselineRaw)
      : { schema_version: 1, runs: [] };

    const entries = diff(baseline, current);
    const comment = renderComment(entries, { commit: workflow_run.head_sha });

    await upsertComment(token, owner, repo, pr.number, comment);
    await setCheckRun(
      token,
      owner,
      repo,
      workflow_run.head_sha,
      decideConclusion(entries),
      summaryLine(entries),
    );
  }
}

function parseSnapshotFile(raw: string): SnapshotFile {
  const parsed = JSON.parse(raw) as SnapshotFile;
  if (parsed.schema_version !== 1) {
    throw new Error(`unsupported schema_version: ${parsed.schema_version}`);
  }
  return parsed;
}

function decideConclusion(entries: DiffEntry[]): "success" | "failure" | "neutral" {
  if (entries.length === 0) return "neutral";
  if (entries.some((e) => e.status === "regressed")) return "failure";
  return "success";
}

function summaryLine(entries: DiffEntry[]): string {
  const counts = entries.reduce(
    (acc, e) => {
      acc[e.status]++;
      return acc;
    },
    { regressed: 0, improved: 0, unchanged: 0, new: 0 },
  );
  return `regressed: ${counts.regressed}, improved: ${counts.improved}, unchanged: ${counts.unchanged}, new: ${counts.new}`;
}
