// Webhook entry-point helpers: HMAC signature verification and a
// type guard for the events we care about. Anything more sophisticated
// (event router, replay protection, retry handling) lives further up
// the call chain — keep this file focused.

import { createHmac, timingSafeEqual } from "node:crypto";

// Verify a GitHub webhook signature against the raw request body. Uses
// constant-time comparison because the obvious `expected === signature`
// leaks string-prefix timing to an attacker who can replay requests.
//
// The signature header is `sha256=<hex>` per GitHub's spec; bail early
// on missing/wrong-prefixed values so a forgotten secret isn't a path
// to "anything goes".
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch instead of returning false,
  // so guard the length first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Subset of the workflow_run webhook payload we actually look at. Full
// payload has ~50 more fields none of which we need. Keeping the type
// narrow makes it obvious what the orchestrator depends on.
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
    private: boolean;
  };
  installation: { id: number };
};

// Subset of the marketplace_purchase webhook payload. GitHub fires this
// when someone purchases / changes / cancels a Marketplace plan for the
// App. We don't store anything from it locally — instead we query
// `/marketplace_listing/installations/{installation_id}` per workflow_run
// to read the live plan. Keeping this stateless avoids needing a DB.
export type MarketplacePurchaseEvent = {
  action: "purchased" | "changed" | "pending_change" | "pending_change_cancelled" | "cancelled";
  effective_date: string;
  marketplace_purchase: {
    account: { id: number; login: string; type: "User" | "Organization" };
    billing_cycle: "monthly" | "yearly";
    unit_count: number;
    on_free_trial: boolean;
    plan: { id: number; name: string; monthly_price_in_cents: number };
  };
};

// We only want completed runs — `requested` and `in_progress` fire too
// but there's no artifact to read until completion. Returning early on
// those keeps the noise out of Vercel function invocation counts.
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
