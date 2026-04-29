import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleWorkflowRun } from "../src/orchestrator.js";
import { isWorkflowRunCompleted, verifySignature } from "../src/webhook.js";

export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!secret || !appId || !privateKey) {
    return res.status(500).json({ error: "missing required env vars" });
  }

  const rawBody = await readRawBody(req);
  const signature = (req.headers["x-hub-signature-256"] as string | undefined) ?? null;

  if (!verifySignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = req.headers["x-github-event"] as string | undefined;
  if (event !== "workflow_run") {
    return res.status(200).json({ ignored: true, reason: `event=${event ?? "<missing>"}` });
  }

  const payload = JSON.parse(rawBody);
  if (!isWorkflowRunCompleted(payload)) {
    return res.status(200).json({ ignored: true, reason: "not a completed run" });
  }

  try {
    await handleWorkflowRun(payload, { appId, privateKey });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("orchestrator failed", err);
    return res.status(500).json({ error: String(err) });
  }
}
