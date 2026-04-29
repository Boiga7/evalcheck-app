// GitHub App authentication. Two short-lived steps:
//   1. Mint a JWT signed with the App's private key. Valid 10 minutes.
//   2. Exchange that JWT for a per-installation access token. Valid 1 hour.
// We don't cache anything across requests — Vercel functions are stateless
// and the per-call overhead is small. Cache later if billing complains.

import { SignJWT } from "jose";
import { createPrivateKey } from "node:crypto";

const TEN_MINUTES = 60 * 10;

// Two ways the env var arrives garbled in practice:
//   - Windows wrote the .pem with CRLF line endings and Vercel preserved them.
//     PEM parsers are picky; some accept CRLF, jose did not.
//   - The deploy script that set the var converted real newlines to literal
//     "\n" text. We undo both before parsing.
function normalizePem(pem: string): string {
  return pem
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export async function mintAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  // GitHub's "Generate a private key" button hands you a PKCS#1 PEM
  // (`-----BEGIN RSA PRIVATE KEY-----`). jose's `importPKCS8` only accepts
  // PKCS#8 and throws a confusing error otherwise. Node's `createPrivateKey`
  // accepts both formats transparently and returns a KeyObject jose's
  // SignJWT.sign happily takes.
  const key = createPrivateKey({ key: normalizePem(privateKeyPem), format: "pem" });

  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    // GitHub allows up to 60s of clock skew. Backdating iat by a minute
    // is the recommended way to avoid "iat is in the future" rejections
    // when the runner clock is slightly ahead of GitHub's.
    .setIssuedAt(now - 60)
    .setExpirationTime(now + TEN_MINUTES)
    .setIssuer(appId)
    .sign(key);
}

export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<string> {
  const jwt = await mintAppJwt(appId, privateKeyPem);
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`installation token request failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { token: string };
  return data.token;
}
