import type { AppConfig } from "../config";
import { readCredsFile } from "./credsFile";
import { refreshAwsSsoOidcFromCredsFile } from "./refreshAwsSsoOidc";
import { KiroAuthManager } from "./kiroAuthManager";

/**
 * Returns a getter shared across requests: with `KIRO_CREDS_FILE`, uses {@link KiroAuthManager}
 * (refresh threshold from `TOKEN_REFRESH_THRESHOLD_SECONDS`) and single-flight init from disk.
 * `KIRO_ACCESS_TOKEN` still wins and bypasses the manager.
 */
export function createKiroAccessTokenGetter(config: AppConfig): () => Promise<string> {
  const credsPath = config.kiroCredsFile;
  let managerInit: Promise<KiroAuthManager> | undefined;

  return async () => {
    const direct = process.env.KIRO_ACCESS_TOKEN;
    if (direct) {
      return direct;
    }
    if (!credsPath) {
      throw new Error("No Kiro credentials configured");
    }

    managerInit ??= readCredsFile(credsPath).then(
      (initial) =>
        new KiroAuthManager({
          initialCreds: initial,
          refreshThresholdMs: config.tokenRefreshThresholdSeconds * 1000,
          // Prefer AWS SSO OIDC refresh when possible (KIRO_CREDS_FILE is expected
          // to point at AWS token cache that includes clientIdHash + region).
          refreshSsoOidc: (refreshToken) => refreshAwsSsoOidcFromCredsFile({ credsFilePath: credsPath, refreshToken }),
          credsFilePath: credsPath,
        }),
    );

    const manager = await managerInit;
    return manager.getAccessToken();
  };
}
