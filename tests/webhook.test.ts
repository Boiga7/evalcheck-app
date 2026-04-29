import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { isWorkflowRunCompleted, verifySignature } from "../src/webhook.js";

const SECRET = "test-secret";

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifySignature", () => {
  test("returns true for a valid signature", () => {
    const body = '{"foo":"bar"}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  test("returns false for a forged signature", () => {
    const body = '{"foo":"bar"}';
    const tamperedBody = '{"foo":"baz"}';
    expect(verifySignature(tamperedBody, sign(body), SECRET)).toBe(false);
  });

  test("returns false when signature is missing", () => {
    expect(verifySignature("body", null, SECRET)).toBe(false);
  });

  test("returns false when signature has wrong prefix", () => {
    expect(verifySignature("body", "sha1=abc", SECRET)).toBe(false);
  });

  test("returns false when signature length differs", () => {
    expect(verifySignature("body", "sha256=tooshort", SECRET)).toBe(false);
  });
});

describe("isWorkflowRunCompleted", () => {
  test("recognises a completed workflow_run event", () => {
    const event = {
      action: "completed",
      workflow_run: { id: 1, head_sha: "abc", head_branch: "feat", conclusion: "success", pull_requests: [] },
      repository: { name: "evalcheck", owner: { login: "Boiga7" }, default_branch: "main" },
      installation: { id: 42 },
    };
    expect(isWorkflowRunCompleted(event)).toBe(true);
  });

  test("rejects in_progress workflow_run events", () => {
    expect(isWorkflowRunCompleted({ action: "in_progress" })).toBe(false);
  });

  test("rejects malformed payloads", () => {
    expect(isWorkflowRunCompleted(null)).toBe(false);
    expect(isWorkflowRunCompleted({})).toBe(false);
    expect(isWorkflowRunCompleted("string")).toBe(false);
  });
});
