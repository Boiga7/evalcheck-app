// The end-to-end flow: webhook fires, we read the artifact, diff it
// against the base branch's baseline, post a comment, set a check.
// One function so it's obvious what happens in what order.

import { getInstallationToken } from "./auth.js";
import {
  downloadArtifactJson,
  findArtifact,
  getRepoFile,
  listPullsForCommit,
  setCheckRun,
  upsertComment,
} from "./api.js";
import { diff, type DiffEntry } from "./diff.js";
import { renderComment } from "./render.js";
import type { SnapshotFile } from "./snapshot.js";
import type { WorkflowRunEvent } from "./webhook.js";

// What the pytest plugin uploads in CI. The artifact name is opinionated;
// users have to use this exact name in their `actions/upload-artifact` step.
const ARTIFACT_NAME = "evalcheck-results";

// Path the plugin writes inside the user's repo workspace. We try this
// path first when extracting from the artifact zip, then fall back to
// other shapes the API helper tolerates.
const RESULTS_FILENAME = ".evalcheck/results.json";

// Where users commit their blessed baseline. Read from the PR's BASE ref,
// not the head — we want to know "did this PR move the score relative to
// what's on main", not "what does the score look like in this PR's tree".
const BASELINE_PATH = ".evalcheck/snapshots/baseline.json";

export type Env = {
  appId: string;
  privateKey: string;
};

export async function handleWorkflowRun(event: WorkflowRunEvent, env: Env): Promise<void> {
  const { workflow_run, repository, installation } = event;
  const owner = repository.owner.login;
  const repo = repository.name;

  const token = await getInstallationToken(env.appId, env.privateKey, installation.id);

  // workflow_run.pull_requests is unreliable for same-repo branch PRs; see
  // listPullsForCommit comment in api.ts. Fall back to the SHA lookup if
  // the payload didn't give us PRs directly.
  let pullRequests = workflow_run.pull_requests;
  if (pullRequests.length === 0) {
    pullRequests = await listPullsForCommit(token, owner, repo, workflow_run.head_sha);
  }
  // Still nothing? The push wasn't on a branch with an open PR (probably
  // a direct push to main). Nothing to comment on, exit cleanly.
  if (pullRequests.length === 0) return;

  const artifact = await findArtifact(token, owner, repo, workflow_run.id, ARTIFACT_NAME);
  if (!artifact) {
    // CI ran but didn't produce results.json. Most likely the user hasn't
    // added the upload-artifact step to their workflow yet. Surface this
    // as a neutral check so they can see what's missing.
    await setCheckRun(
      token,
      owner,
      repo,
      workflow_run.head_sha,
      "neutral",
      `No \`evalcheck-results\` artifact uploaded. Add an \`actions/upload-artifact@v4\` step that uploads \`.evalcheck/results.json\` under the name \`${ARTIFACT_NAME}\`.`,
    );
    return;
  }

  const resultsRaw = await downloadArtifactJson(
    token,
    owner,
    repo,
    artifact.id,
    RESULTS_FILENAME,
  );
  if (!resultsRaw) {
    // The artifact exists but doesn't contain a recognisable results.json.
    // Could be the wrong path inside the zip, could be a corrupt upload.
    await setCheckRun(
      token,
      owner,
      repo,
      workflow_run.head_sha,
      "neutral",
      "Artifact uploaded but no `results.json` found inside.",
    );
    return;
  }

  const current = parseSnapshotFile(resultsRaw);

  // One PR almost always; multiple is rare but possible if a SHA is the
  // head of two open PRs. Comment on each.
  for (const pr of pullRequests) {
    // Read baseline from the PR's BASE branch, not the head. This is
    // what makes the diff meaningful — "is this PR moving the score
    // away from what's on main".
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

// Translates the diff into a GitHub Check status. Failure = at least one
// regression — that's the gate users want enforcing on merge. Success means
// at least one entry and zero regressions. Neutral covers the "nothing to
// say" case (no entries at all) so the check doesn't lie about a green run
// when the suite is empty.
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
