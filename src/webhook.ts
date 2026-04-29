import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type WorkflowRunEvent = {
  action: "completed" | "requested" | "in_progress";
  workflow_run: {
    id: number;
    head_sha: string;
    head_branch: string;
    conclusion: string | null;
    pull_requests: Array<{ number: number; base: { ref: string }; head: { ref: string } }>;
  };
  repository: {
    name: string;
    owner: { login: string };
    default_branch: string;
  };
  installation: { id: number };
};

export function isWorkflowRunCompleted(event: unknown): event is WorkflowRunEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Partial<WorkflowRunEvent>;
  return (
    e.action === "completed" &&
    !!e.workflow_run &&
    !!e.repository &&
    !!e.installation
  );
}
