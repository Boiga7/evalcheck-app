// Vercel function entry point. Receives webhook deliveries from GitHub,
// verifies them, and hands off to the orchestrator. Everything testable
// lives in src/; this file is just the HTTP plumbing.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleWorkflowRun } from "../src/orchestrator.js";
import { isWorkflowRunCompleted, verifySignature } from "../src/webhook.js";

// Disable Vercel's automatic JSON body parsing — we need the raw bytes
// to compute the HMAC signature. Once it's parsed, the original byte
// representation is gone and any signature check is meaningless.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GitHub only sends POSTs. Anything else is either a probe or a
  // misconfigured webhook URL — surface 405 so it's obvious from the
  // GitHub App's webhook deliveries page.
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  // Without all three secrets we can't verify the signature OR mint a
  // token. Fail loud rather than silently returning 200, so a misconfigured
  // deploy shows up in the GitHub App's recent-deliveries list.
  if (!secret || !appId || !privateKey) {
    return res.status(500).json({ error: "missing required env vars" });
  }

  const rawBody = await readRawBody(req);
  const signature = (req.headers["x-hub-signature-256"] as string | undefined) ?? null;

  if (!verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  // The App is subscribed to workflow_run events specifically, but GitHub
  // also delivers `installation.created` and `ping` events whether you
  // ask for them or not. Acknowledge those quickly without doing work.
  const event = req.headers["x-github-event"] as string | undefined;
  if (event !== "workflow_run") {
    return res.status(200).json({ ignored: true, reason: `event=${event ?? "<missing>"}` });
  }

  const payload = JSON.parse(rawBody);
  // Only act on completed runs — `requested` and `in_progress` fire too
  // and we have nothing useful to do with them.
  if (!isWorkflowRunCompleted(payload)) {
    return res.status(200).json({ ignored: true, reason: "not a completed run" });
  }

  try {
    await handleWorkflowRun(payload, { appId, privateKey });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // GitHub will retry 5xx responses several times. That's mostly fine
    // here — if the GitHub API is briefly down, we want a retry. If our
    // code has a deterministic bug, the retries are noisy but harmless.
    console.error("orchestrator failed", err);
    return res.status(500).json({ error: String(err) });
  }
}
