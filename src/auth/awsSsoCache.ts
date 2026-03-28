import { readFile } from "node:fs/promises";

type AwsSsoClientCreds = {
  clientId: string;
  clientSecret: string;
};

function parseAwsSsoCacheObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid AWS SSO cache file: invalid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid AWS SSO cache file: expected JSON object");
  }

  return parsed as Record<string, unknown>;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid AWS SSO cache file: missing or invalid ${field}`);
  }

  return value;
}

export async function loadClientCredsFromSsoCacheFile(path: string): Promise<AwsSsoClientCreds> {
  const text = await readFile(path, "utf8");
  const parsed = parseAwsSsoCacheObject(text);

  return {
    clientId: assertString(parsed.clientId, "clientId"),
    clientSecret: assertString(parsed.clientSecret, "clientSecret"),
  };
}
