import { describe, expect, test } from "bun:test";
import { loadConfigFromEnv } from "../src/config";
import { ConfigError } from "../src/errors";

describe("loadConfigFromEnv", () => {
  test("throws when PROXY_API_KEY is missing", () => {
    const env = {};

    expect(() => loadConfigFromEnv(env)).toThrow(ConfigError);
    expect(() => loadConfigFromEnv(env)).toThrow(
      "Missing required env var: PROXY_API_KEY",
    );
  });

  test("uses defaults for optional config values", () => {
    const config = loadConfigFromEnv({
      PROXY_API_KEY: "test-key",
    });

    expect(config.serverHost).toBe("0.0.0.0");
    expect(config.serverPort).toBe(18000);
    expect(config.kiroRegion).toBe("us-east-1");
    expect(config.tokenRefreshThresholdSeconds).toBe(600);
  });

  test("throws for non-numeric SERVER_PORT", () => {
    expect(() =>
      loadConfigFromEnv({
        PROXY_API_KEY: "test-key",
        SERVER_PORT: "abc",
      }),
    ).toThrow(ConfigError);
  });

  test("throws for out-of-range SERVER_PORT", () => {
    expect(() =>
      loadConfigFromEnv({
        PROXY_API_KEY: "test-key",
        SERVER_PORT: "70000",
      }),
    ).toThrow(ConfigError);
  });

  test("throws for negative TOKEN_REFRESH_THRESHOLD_SECONDS", () => {
    expect(() =>
      loadConfigFromEnv({
        PROXY_API_KEY: "test-key",
        TOKEN_REFRESH_THRESHOLD_SECONDS: "-1",
      }),
    ).toThrow(ConfigError);
  });
});
