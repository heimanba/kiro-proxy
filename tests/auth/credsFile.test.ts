import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { readCredsFile, writeCredsFileMerged } from "../../src/auth/credsFile";

describe("credsFile", () => {
  test("readCredsFile throws on invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creds-file-test-"));
    const path = join(dir, "creds.json");
    await writeFile(path, "{not-json", "utf8");

    await expect(readCredsFile(path)).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  test("readCredsFile throws when required fields are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creds-file-test-"));
    const path = join(dir, "creds.json");
    await writeFile(
      path,
      JSON.stringify({
        accessToken: "at-1",
        expiresAt: "2026-03-26T00:00:00.000Z",
      }),
      "utf8",
    );

    await expect(readCredsFile(path)).rejects.toThrow("refreshToken");

    await rm(dir, { recursive: true, force: true });
  });

  test("readCredsFile throws when required fields are empty strings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creds-file-test-"));
    const path = join(dir, "creds.json");
    await writeFile(
      path,
      JSON.stringify({
        accessToken: "",
        refreshToken: "rt-1",
        expiresAt: "2026-03-26T00:00:00.000Z",
      }),
      "utf8",
    );

    await expect(readCredsFile(path)).rejects.toThrow("accessToken");

    await rm(dir, { recursive: true, force: true });
  });

  test("readCredsFile validates required fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creds-file-test-"));
    const path = join(dir, "creds.json");

    await writeFile(
      path,
      JSON.stringify({
        accessToken: "at-1",
        refreshToken: "rt-1",
        expiresAt: "2026-03-26T00:00:00.000Z",
      }),
      "utf8",
    );

    const creds = await readCredsFile(path);
    expect(creds.accessToken).toBe("at-1");
    expect(creds.refreshToken).toBe("rt-1");
    expect(creds.expiresAt.toISOString()).toBe("2026-03-26T00:00:00.000Z");

    await rm(dir, { recursive: true, force: true });
  });

  test("writeCredsFileMerged keeps unknown fields and writes expiresAt as ISO", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creds-file-test-"));
    const path = join(dir, "creds.json");

    await writeFile(
      path,
      JSON.stringify({
        accessToken: "old-at",
        refreshToken: "old-rt",
        expiresAt: "2026-03-20T00:00:00.000Z",
        provider: "kiro",
        nested: { keep: true },
      }),
      "utf8",
    );

    const nextExpiry = new Date("2026-03-30T12:34:56.000Z");
    await writeCredsFileMerged(path, {
      accessToken: "new-at",
      refreshToken: "new-rt",
      expiresAt: nextExpiry,
    });

    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed.provider).toBe("kiro");
    expect(parsed.nested).toEqual({ keep: true });
    expect(parsed.accessToken).toBe("new-at");
    expect(parsed.refreshToken).toBe("new-rt");
    expect(parsed.expiresAt).toBe(nextExpiry.toISOString());

    await rm(dir, { recursive: true, force: true });
  });

  test("readCredsFile throws when expiresAt is invalid date", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creds-file-test-"));
    const path = join(dir, "creds.json");

    await writeFile(
      path,
      JSON.stringify({
        accessToken: "at-1",
        refreshToken: "rt-1",
        expiresAt: "not-a-date",
      }),
      "utf8",
    );

    await expect(readCredsFile(path)).rejects.toThrow("expiresAt");

    await rm(dir, { recursive: true, force: true });
  });

  test("writeCredsFileMerged throws when update.expiresAt is Invalid Date", async () => {
    const dir = await mkdtemp(join(tmpdir(), "creds-file-test-"));
    const path = join(dir, "creds.json");

    await writeFile(
      path,
      JSON.stringify({
        accessToken: "old-at",
        refreshToken: "old-rt",
        expiresAt: "2026-03-20T00:00:00.000Z",
      }),
      "utf8",
    );

    await expect(
      writeCredsFileMerged(path, {
        accessToken: "new-at",
        refreshToken: "new-rt",
        expiresAt: new Date("invalid-date"),
      }),
    ).rejects.toThrow("expiresAt");

    await rm(dir, { recursive: true, force: true });
  });

  test("readCredsFile surfaces IO errors when file does not exist", async () => {
    const missingPath = join(tmpdir(), `missing-creds-${Date.now()}.json`);
    await expect(readCredsFile(missingPath)).rejects.toThrow();
  });
});
