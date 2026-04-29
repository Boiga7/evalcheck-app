import JSZip from "jszip";

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

export async function getRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRepoFile failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { content: string; encoding: string };
  if (data.encoding !== "base64") {
    throw new Error(`unexpected encoding: ${data.encoding}`);
  }
  return Buffer.from(data.content, "base64").toString("utf-8");
}

type Artifact = { id: number; name: string; expired: boolean };

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
  const file = zip.file(filename);
  if (!file) return null;
  return await file.async("string");
}

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
