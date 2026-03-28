import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as credsFile from "../../src/auth/credsFile";
import { createKiroAccessTokenGetter } from "../../src/auth/kiroAccessToken";
import { loadConfigFromEnv } from "../../src/config";

let readSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  readSpy = spyOn(credsFile, "readCredsFile");
});

afterEach(() => {
  readSpy.mockRestore();
});

test("KIRO_ACCESS_TOKEN bypasses creds file and does not read disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-atok-"));
  try {
    const path = join(dir, "creds.json");
    await writeFile(
      path,
      JSON.stringify({
        accessToken: "from-file",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      "utf8",
    );

    const prev = process.env.KIRO_ACCESS_TOKEN;
    process.env.KIRO_ACCESS_TOKEN = "from-env";
    try {
      const config = loadConfigFromEnv({
        PROXY_API_KEY: "k",
        KIRO_CREDS_FILE: path,
      });
      const get = createKiroAccessTokenGetter(config);
      expect(await get()).toBe("from-env");
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.KIRO_ACCESS_TOKEN;
      } else {
        process.env.KIRO_ACCESS_TOKEN = prev;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creds file path uses KiroAuthManager: readCredsFile once for parallel getAccessToken", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-atok-"));
  try {
    const path = join(dir, "creds.json");
    await writeFile(
      path,
      JSON.stringify({
        accessToken: "tok",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      "utf8",
    );

    const prev = process.env.KIRO_ACCESS_TOKEN;
    delete process.env.KIRO_ACCESS_TOKEN;
    try {
      const config = loadConfigFromEnv({
        PROXY_API_KEY: "k",
        KIRO_CREDS_FILE: path,
        TOKEN_REFRESH_THRESHOLD_SECONDS: "120",
      });
      const get = createKiroAccessTokenGetter(config);
      await Promise.all([get(), get(), get()]);
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy).toHaveBeenCalledWith(path);
    } finally {
      if (prev === undefined) {
        delete process.env.KIRO_ACCESS_TOKEN;
      } else {
        process.env.KIRO_ACCESS_TOKEN = prev;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("throws when no env token and no creds file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-no-creds-"));
  const prev = process.env.KIRO_ACCESS_TOKEN;
  delete process.env.KIRO_ACCESS_TOKEN;
  try {
    const config = loadConfigFromEnv({
      PROXY_API_KEY: "k",
      HOME: dir,
    });
    const get = createKiroAccessTokenGetter(config);
    await expect(get()).rejects.toThrow("No Kiro credentials configured");
  } finally {
    if (prev === undefined) {
      delete process.env.KIRO_ACCESS_TOKEN;
    } else {
      process.env.KIRO_ACCESS_TOKEN = prev;
    }

    await rm(dir, { recursive: true, force: true });
  }
});

test("uses default ~/.aws/sso/cache/kiro-auth-token.json when KIRO_CREDS_FILE is not set (only if file exists)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-default-creds-"));
  const prevHome = process.env.HOME;
  const prevAccessToken = process.env.KIRO_ACCESS_TOKEN;

  process.env.HOME = dir;
  delete process.env.KIRO_ACCESS_TOKEN;

  try {
    const defaultPath = join(dir, ".aws", "sso", "cache", "kiro-auth-token.json");
    await mkdir(join(dir, ".aws", "sso", "cache"), { recursive: true });
    await writeFile(
      defaultPath,
      JSON.stringify({
        accessToken: "from-default",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
      "utf8",
    );

    const config = loadConfigFromEnv({
      PROXY_API_KEY: "k",
      HOME: dir,
    });
    const get = createKiroAccessTokenGetter(config);
    expect(await get()).toBe("from-default");
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledWith(defaultPath);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;

    if (prevAccessToken === undefined) delete process.env.KIRO_ACCESS_TOKEN;
    else process.env.KIRO_ACCESS_TOKEN = prevAccessToken;

    await rm(dir, { recursive: true, force: true });
  }
});
