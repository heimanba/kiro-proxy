import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadClientCredsFromSsoCacheFile } from "./awsSsoCache";
import type { Creds } from "./types";

type AwsSsoTokenCache = {
  clientIdHash: string;
  region: string;
};

function parseAwsSsoTokenCache(text: string): AwsSsoTokenCache {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid creds file: invalid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid creds file: expected JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const clientIdHash = obj.clientIdHash;
  const region = obj.region;

  if (typeof clientIdHash !== "string" || clientIdHash.length === 0) {
    throw new Error("Invalid creds file: missing or invalid clientIdHash");
  }
  if (typeof region !== "string" || region.length === 0) {
    throw new Error("Invalid creds file: missing or invalid region");
  }

  return { clientIdHash, region };
}

async function fetchOidcRefresh(params: {
  region: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<Creds> {
  const url = `https://oidc.${params.region}.amazonaws.com/token`;
  // IAM Identity Center OIDC uses a JSON POST body (not x-www-form-urlencoded).
  // Docs: CreateToken API -> POST /token with JSON fields.
  const body = JSON.stringify({
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    grantType: "refresh_token",
    refreshToken: params.refreshToken,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    // Keep message stable/predictable for route-level mapping.
    throw new Error(`Invalid creds file: upstream OIDC refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Invalid creds file: upstream OIDC refresh returned invalid JSON");
  }

  const obj = json as Record<string, unknown>;
  const accessToken = obj.accessToken;
  const refreshToken = obj.refreshToken;
  const expiresIn = obj.expiresIn;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Invalid creds file: upstream OIDC refresh missing accessToken");
  }
  const expiresInNum = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  if (!Number.isFinite(expiresInNum) || expiresInNum <= 0) {
    throw new Error("Invalid creds file: upstream OIDC refresh missing expiresIn");
  }

  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : params.refreshToken,
    expiresAt: new Date(Date.now() + expiresInNum * 1000),
  };
}

export async function refreshAwsSsoOidcFromCredsFile(params: {
  credsFilePath: string;
  refreshToken: string;
}): Promise<Creds> {
  const tokenCacheText = await readFile(params.credsFilePath, "utf8");
  const tokenCache = parseAwsSsoTokenCache(tokenCacheText);
  const clientCredsPath = join(dirname(params.credsFilePath), `${tokenCache.clientIdHash}.json`);
  const clientCreds = await loadClientCredsFromSsoCacheFile(clientCredsPath);

  return fetchOidcRefresh({
    region: tokenCache.region,
    clientId: clientCreds.clientId,
    clientSecret: clientCreds.clientSecret,
    refreshToken: params.refreshToken,
  });
}

