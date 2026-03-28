import { describe, expect, test } from "bun:test";

import { KiroAuthManager } from "../../src/auth/kiroAuthManager";
import type { Creds, CredsUpdate } from "../../src/auth/types";

describe("kiroAuthManager priority and degrade", () => {
  test("prioritizes in-memory refresh token during refresh", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "old-token",
      refreshToken: "memory-refresh-token",
      expiresAt: new Date("2026-03-26T00:00:10.000Z"),
    };

    let receivedRefreshToken = "";
    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      refreshDesktop: async (refreshToken: string) => {
        receivedRefreshToken = refreshToken;
        return {
          accessToken: "desktop-token",
          refreshToken: "desktop-refresh-token",
          expiresAt: new Date("2026-03-26T00:30:00.000Z"),
        };
      },
    });

    const token = await manager.getAccessToken();

    expect(receivedRefreshToken).toBe("memory-refresh-token");
    expect(token).toBe("desktop-token");
  });

  test("degrades to current token when refresh fails but token is still valid", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "still-valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-03-26T00:00:05.000Z"),
    };

    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      refreshDesktop: async () => {
        throw new Error("desktop refresh failed");
      },
    });

    const token = await manager.getAccessToken();
    expect(token).toBe("still-valid-token");
  });

  test("falls back to sso oidc when desktop refresh fails", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "old-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-03-26T00:00:10.000Z"),
    };

    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      refreshDesktop: async () => {
        throw new Error("desktop refresh failed");
      },
      refreshSsoOidc: async () => {
        return {
          accessToken: "sso-token",
          refreshToken: "sso-refresh-token",
          expiresAt: new Date("2026-03-26T00:30:00.000Z"),
        };
      },
    });

    const token = await manager.getAccessToken();
    expect(token).toBe("sso-token");
  });

  test("throws desktop error when sso fallback is not injected", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-03-25T23:59:59.000Z"),
    };

    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      refreshDesktop: async () => {
        throw new Error("desktop refresh failed");
      },
    });

    await expect(manager.getAccessToken()).rejects.toThrow("desktop refresh failed");
  });

  test("persists refreshed creds when credsFilePath is configured", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "old-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-03-26T00:00:10.000Z"),
    };

    let persistedPath = "";
    let persistedUpdate: CredsUpdate | undefined;

    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      credsFilePath: "/tmp/kiro-creds.json",
      persistCreds: async (path: string, update: CredsUpdate) => {
        persistedPath = path;
        persistedUpdate = update;
      },
      refreshDesktop: async () => {
        return {
          accessToken: "new-token",
          refreshToken: "new-refresh-token",
          expiresAt: new Date("2026-03-26T00:30:00.000Z"),
        };
      },
    });

    const token = await manager.getAccessToken();

    expect(token).toBe("new-token");
    expect(persistedPath).toBe("/tmp/kiro-creds.json");
    expect(persistedUpdate).toEqual({
      accessToken: "new-token",
      refreshToken: "new-refresh-token",
      expiresAt: new Date("2026-03-26T00:30:00.000Z"),
    });
  });
});
