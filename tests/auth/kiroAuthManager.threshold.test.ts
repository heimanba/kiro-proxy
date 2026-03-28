import { describe, expect, test } from "bun:test";

import { KiroAuthManager } from "../../src/auth/kiroAuthManager";
import type { Creds } from "../../src/auth/types";

describe("kiroAuthManager threshold", () => {
  test("does not refresh when expiresAt is outside threshold", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "still-good-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-03-26T00:03:00.000Z"),
    };

    let refreshCalls = 0;
    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      refreshDesktop: async () => {
        refreshCalls += 1;
        return initialCreds;
      },
    });

    const token = await manager.getAccessToken();

    expect(token).toBe("still-good-token");
    expect(refreshCalls).toBe(0);
  });

  test("refreshes when expiresAt is within threshold", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "old-token",
      refreshToken: "refresh-token",
      expiresAt: new Date("2026-03-26T00:00:30.000Z"),
    };

    let refreshCalls = 0;
    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      refreshDesktop: async () => {
        refreshCalls += 1;
        return {
          accessToken: "new-token",
          refreshToken: "new-refresh-token",
          expiresAt: new Date("2026-03-26T00:30:00.000Z"),
        };
      },
    });

    const token = await manager.getAccessToken();

    expect(token).toBe("new-token");
    expect(refreshCalls).toBe(1);
  });
});
