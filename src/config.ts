import { ConfigError } from "./errors";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  proxyApiKey: string;
  serverHost: string;
  serverPort: number;
  kiroRegion: string;
  tokenRefreshThresholdSeconds: number;
  /** When set, access token is read from this file for upstream Kiro calls (unless `KIRO_ACCESS_TOKEN` is set). */
  kiroCredsFile?: string;
}

function resolveHomeDir(env: Record<string, string | undefined>): string {
  // Prefer HOME from the provided env for testability and predictability.
  // Fall back to os.homedir() when HOME is not set.
  return env.HOME ?? homedir();
}

function expandHomePath(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homeDir, path.slice(2));
  }
  return path;
}

function defaultKiroCredsPath(homeDir: string): string {
  return join(homeDir, ".aws", "sso", "cache", "kiro-auth-token.json");
}

function parseIntegerEnv(
  envName: string,
  rawValue: string | undefined,
  defaultValue: number,
  options?: { min?: number; max?: number },
): number {
  const valueText = rawValue ?? String(defaultValue);
  const value = Number(valueText);

  if (!Number.isInteger(value)) {
    throw new ConfigError(`Invalid env var ${envName}: "${valueText}"`);
  }

  if (options?.min !== undefined && value < options.min) {
    throw new ConfigError(`Invalid env var ${envName}: "${valueText}"`);
  }

  if (options?.max !== undefined && value > options.max) {
    throw new ConfigError(`Invalid env var ${envName}: "${valueText}"`);
  }

  return value;
}

export function loadConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const proxyApiKey = env.PROXY_API_KEY;
  if (!proxyApiKey) {
    throw new ConfigError("Missing required env var: PROXY_API_KEY");
  }

  const homeDir = resolveHomeDir(env);
  const explicitCredsFile = env.KIRO_CREDS_FILE ? expandHomePath(env.KIRO_CREDS_FILE, homeDir) : undefined;
  const implicitCredsFile = (() => {
    if (explicitCredsFile) return undefined;
    const candidate = defaultKiroCredsPath(homeDir);
    return existsSync(candidate) ? candidate : undefined;
  })();

  return {
    proxyApiKey,
    serverHost: env.SERVER_HOST ?? "0.0.0.0",
    serverPort: parseIntegerEnv("SERVER_PORT", env.SERVER_PORT, 18000, {
      min: 0,
      max: 65535,
    }),
    kiroRegion: env.KIRO_REGION ?? "us-east-1",
    tokenRefreshThresholdSeconds: parseIntegerEnv(
      "TOKEN_REFRESH_THRESHOLD_SECONDS",
      env.TOKEN_REFRESH_THRESHOLD_SECONDS,
      600,
      {
        min: 0,
      },
    ),
    kiroCredsFile: explicitCredsFile ?? implicitCredsFile,
  };
}
