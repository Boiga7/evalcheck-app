import { SignJWT, importPKCS8 } from "jose";

const TEN_MINUTES = 60 * 10;

function normalizePem(pem: string): string {
  return pem
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export async function mintAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const normalized = normalizePem(privateKeyPem);
  let key;
  try {
    key = await importPKCS8(normalized, "RS256");
  } catch (err) {
    throw new Error(
      `PEM parse failed. raw_len=${privateKeyPem.length} ` +
        `norm_len=${normalized.length} ` +
        `lf=${(normalized.match(/\n/g) ?? []).length} ` +
        `cr=${(normalized.match(/\r/g) ?? []).length} ` +
        `start="${normalized.slice(0, 30)}" ` +
        `end="${normalized.slice(-30)}" :: ${String(err)}`,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
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
