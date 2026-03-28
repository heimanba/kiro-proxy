import { describe, expect, test } from "bun:test";

import { KiroAuthManager } from "../../src/auth/kiroAuthManager";
import type { Creds } from "../../src/auth/types";

describe("kiroAuthManager concurrent refresh", () => {
  test("concurrent getAccessToken calls trigger only one refresh", async () => {
    const baseNow = new Date("2026-03-26T00:00:00.000Z");
    const initialCreds: Creds = {
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      expiresAt: new Date("2026-03-26T00:00:20.000Z"),
    };

    let refreshCalls = 0;
    let resolveRefresh: ((value: Creds) => void) | undefined;

    const refreshPromise = new Promise<Creds>((resolve) => {
      resolveRefresh = resolve;
    });

    const manager = new KiroAuthManager({
      initialCreds,
      refreshThresholdMs: 60_000,
      now: () => baseNow,
      refreshDesktop: async () => {
        refreshCalls += 1;
        return refreshPromise;
      },
    });

    const calls = Array.from({ length: 8 }, () => manager.getAccessToken());

    resolveRefresh?.({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: new Date("2026-03-26T00:30:00.000Z"),
    });

    const tokens = await Promise.all(calls);

    expect(refreshCalls).toBe(1);
    for (const token of tokens) {
      expect(token).toBe("new-access-token");
    }
  });
});
