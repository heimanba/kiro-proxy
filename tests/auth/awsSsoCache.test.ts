import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { loadClientCredsFromSsoCacheFile } from "../../src/auth/awsSsoCache";

describe("awsSsoCache", () => {
  test("loadClientCredsFromSsoCacheFile reads clientId and clientSecret from JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aws-sso-cache-test-"));
    const path = join(dir, "cache.json");

    await writeFile(
      path,
      JSON.stringify({
        clientId: "enterprise-client-id",
        clientSecret: "enterprise-client-secret",
      }),
      "utf8",
    );

    const creds = await loadClientCredsFromSsoCacheFile(path);
    expect(creds.clientId).toBe("enterprise-client-id");
    expect(creds.clientSecret).toBe("enterprise-client-secret");

    await rm(dir, { recursive: true, force: true });
  });

  test("loadClientCredsFromSsoCacheFile throws when required fields are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aws-sso-cache-test-"));
    const path = join(dir, "cache.json");

    await writeFile(
      path,
      JSON.stringify({
        clientId: "enterprise-client-id",
      }),
      "utf8",
    );

    await expect(loadClientCredsFromSsoCacheFile(path)).rejects.toThrow("clientSecret");

    await rm(dir, { recursive: true, force: true });
  });

  test("loadClientCredsFromSsoCacheFile throws diagnostic error when JSON is null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aws-sso-cache-test-"));
    const path = join(dir, "cache.json");

    await writeFile(path, "null", "utf8");

    await expect(loadClientCredsFromSsoCacheFile(path)).rejects.toThrow("expected JSON object");

    await rm(dir, { recursive: true, force: true });
  });
});
