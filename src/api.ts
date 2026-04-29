// Thin fetch wrappers around the GitHub REST endpoints we actually use.
// Deliberately not pulling in @octokit/rest — we only need ~5 calls and
// the dep adds 100kb-ish to a Vercel cold start for no real win.

import JSZip from "jszip";

// Hidden HTML comment we tag every comment with. Used to find and update
// our previous comment instead of spamming a new one on every push.
// Treat this string as load-bearing: changing it orphans existing comments
// (they won't match any more, so a brand new comment will be posted on
// the next run, alongside the orphan).
const COMMENT_MARKER = "<!-- evalcheck:comment -->";

type Headers = {
  Authorization: string;
  Accept: string;
  "X-GitHub-Api-Version": string;
};

function headers(token: string): Headers {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Reads a file from a specific git ref. Used to pull baseline.json from
// the PR's base branch so we always diff against what's on main, not
// whatever happens to be in the PR's working tree.
export async function getRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: headers(token) });
  // 404 is the normal case for "no baseline yet" — first PR on a new repo.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRepoFile failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { content: string; encoding: string };
  if (data.encoding !== "base64") {
    throw new Error(`unexpected encoding: ${data.encoding}`);
  }
  return Buffer.from(data.content, "base64").toString("utf-8");
}

// PR ref shape we pass around internally. Smaller than what GitHub returns,
// just the bits the orchestrator needs.
export type PullRequestRef = {
  number: number;
  base: { ref: string };
  head: { ref: string };
};

// Fallback PR lookup. workflow_run.pull_requests in the webhook payload is
// only populated reliably when the workflow itself runs on `pull_request`
// AND the PR targets the default branch. For most other shapes (push
// triggers, fork PRs, non-default-branch bases) it comes back empty even
// when there's clearly an open PR for the head SHA. This endpoint is the
// preview-headered "List PRs associated with a commit" endpoint that
// works in those cases.
export async function listPullsForCommit(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<PullRequestRef[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/pulls`;
  const res = await fetch(url, {
    headers: {
      ...headers(token),
      Accept: "application/vnd.github.groot-preview+json",
    },
  });
  if (!res.ok) throw new Error(`listPullsForCommit failed (${res.status}): ${await res.text()}`);
  const pulls = (await res.json()) as Array<{
    number: number;
    base: { ref: string };
    head: { ref: string };
    state: string;
  }>;
  return pulls
    .filter((p) => p.state === "open")
    .map((p) => ({ number: p.number, base: { ref: p.base.ref }, head: { ref: p.head.ref } }));
}

type Artifact = { id: number; name: string; expired: boolean };

// Finds the named artifact on a given workflow run, skipping expired ones.
// GitHub keeps the artifact metadata around after the bytes are GC'd, so
// `expired: true` items have to be filtered explicitly.
export async function findArtifact(
  token: string,
  owner: string,
  repo: string,
  runId: number,
  name: string,
): Promise<Artifact | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`findArtifact failed (${res.status})`);
  const data = (await res.json()) as { artifacts: Artifact[] };
  return data.artifacts.find((a) => a.name === name && !a.expired) ?? null;
}

// Downloads the artifact zip and pulls one file out of it. The path inside
// the zip depends on how the user wrote their `actions/upload-artifact`
// step (single file vs glob), so we try the exact path first, then the
// basename, then any trailing match. Belt-and-braces, but every CI is
// shaped slightly differently and the cost of being wrong is silent.
export async function downloadArtifactJson(
  token: string,
  owner: string,
  repo: string,
  artifactId: number,
  filename: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`;
  const res = await fetch(url, { headers: headers(token), redirect: "follow" });
  if (!res.ok) throw new Error(`downloadArtifact failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);

  // Try exact path, then basename, then any path that ends in our filename.
  // First match wins. Most users get the basename hit; the others are for
  // the rare glob-pattern artifact.
  let file = zip.file(filename);
  if (!file) {
    const basename = filename.split("/").pop() ?? filename;
    file = zip.file(basename);
  }
  if (!file) {
    const fallback = Object.keys(zip.files).find(
      (p) => p.endsWith(filename) || p.endsWith(filename.split("/").pop() ?? filename),
    );
    if (fallback) file = zip.file(fallback);
  }
  if (!file) return null;
  return await file.async("string");
}

// Posts a new comment OR edits the previous one in place. Without this,
// every push to a noisy PR would create a fresh comment; instead we keep
// one comment per PR that updates as new commits land. Implementation
// detail: GitHub's PR comments live on the issues endpoint (PRs are
// issues with extra fields), which trips up first-time API users.
export async function upsertComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const fullBody = `${COMMENT_MARKER}\n${body}`;
  const listUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const listRes = await fetch(listUrl, { headers: headers(token) });
  if (!listRes.ok) throw new Error(`list comments failed (${listRes.status})`);
  const comments = (await listRes.json()) as Array<{ id: number; body: string }>;
  const existing = comments.find((c) => c.body.includes(COMMENT_MARKER));

  if (existing) {
    const patchRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`,
      {
        method: "PATCH",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({ body: fullBody }),
      },
    );
    if (!patchRes.ok) throw new Error(`patch comment failed (${patchRes.status})`);
    return;
  }

  const postRes = await fetch(listUrl, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ body: fullBody }),
  });
  if (!postRes.ok) throw new Error(`post comment failed (${postRes.status})`);
}

export type CheckConclusion = "success" | "failure" | "neutral";

// Reads the live Marketplace plan attached to an installation. Returns
// null if the App isn't a paid Marketplace listing yet (the listing is
// in draft) or if the install was made before the listing went live.
//
// Why we re-fetch this instead of caching from marketplace_purchase
// webhooks: the App is stateless on Vercel — no DB, no KV. Querying
// per-run adds one HTTP call (~100ms) and avoids needing storage for
// what is, after all, GitHub's data anyway.
export type InstallationPlan = {
  name: string;
  monthly_price_in_cents: number;
  is_free: boolean;
};

export async function getInstallationPlan(
  token: string,
  installationId: number,
): Promise<InstallationPlan | null> {
  const url = `https://api.github.com/marketplace_listing/installation/${installationId}/plan`;
  const res = await fetch(url, { headers: headers(token) });
  // 404 means the App isn't a Marketplace listing yet OR the install
  // predates the listing. Both are "treat as free tier".
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getInstallationPlan failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { name: string; monthly_price_in_cents: number };
  return {
    name: data.name,
    monthly_price_in_cents: data.monthly_price_in_cents,
    is_free: data.monthly_price_in_cents === 0,
  };
}

// Posts a check run keyed to the head SHA. Multiple POSTs to this
// endpoint create *separate* check runs with the same name — that's
// unwanted, but it only matters if we end up calling it twice in the
// same orchestrator pass, which we don't.
export async function setCheckRun(
  token: string,
  owner: string,
  repo: string,
  headSha: string,
  conclusion: CheckConclusion,
  summary: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/check-runs`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "evalcheck",
      head_sha: headSha,
      status: "completed",
      conclusion,
      output: { title: `evalcheck — ${conclusion}`, summary },
    }),
  });
  if (!res.ok) throw new Error(`setCheckRun failed (${res.status}): ${await res.text()}`);
}
