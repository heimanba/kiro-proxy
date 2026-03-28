import { writeCredsFileMerged } from "./credsFile";
import { refreshDesktop as defaultRefreshDesktop, type RefreshDesktopFn } from "./refreshDesktop";
import type { RefreshSsoOidcFn } from "./refreshSsoOidc";
import type { Creds } from "./types";

type PersistCredsFn = (path: string, update: Creds) => Promise<void>;

type KiroAuthManagerOptions = {
  initialCreds: Creds;
  refreshThresholdMs: number;
  refreshDesktop?: RefreshDesktopFn;
  refreshSsoOidc?: RefreshSsoOidcFn;
  credsFilePath?: string;
  persistCreds?: PersistCredsFn;
  now?: () => Date;
};

export class KiroAuthManager {
  private creds: Creds;
  private readonly refreshThresholdMs: number;
  private readonly refreshDesktop: RefreshDesktopFn;
  private readonly refreshSsoOidc?: RefreshSsoOidcFn;
  private readonly credsFilePath?: string;
  private readonly persistCreds: PersistCredsFn;
  private readonly now: () => Date;
  private inFlightRefresh?: Promise<Creds>;

  constructor(options: KiroAuthManagerOptions) {
    this.creds = options.initialCreds;
    this.refreshThresholdMs = options.refreshThresholdMs;
    this.refreshDesktop = options.refreshDesktop ?? defaultRefreshDesktop;
    this.refreshSsoOidc = options.refreshSsoOidc;
    this.credsFilePath = options.credsFilePath;
    this.persistCreds = options.persistCreds ?? writeCredsFileMerged;
    this.now = options.now ?? (() => new Date());
  }

  async getAccessToken(): Promise<string> {
    if (!this.shouldRefresh()) {
      return this.creds.accessToken;
    }

    if (!this.inFlightRefresh) {
      this.inFlightRefresh = this.refreshWithSingleFlight();
    }

    const refreshedCreds = await this.inFlightRefresh;
    return refreshedCreds.accessToken;
  }

  private shouldRefresh(): boolean {
    const msUntilExpiry = this.creds.expiresAt.getTime() - this.now().getTime();
    return msUntilExpiry <= this.refreshThresholdMs;
  }

  private async refreshWithSingleFlight(): Promise<Creds> {
    const beforeRefresh = this.creds;
    const refreshToken = beforeRefresh.refreshToken;

    try {
      const refreshed = await this.runRefreshMethods(refreshToken);
      this.creds = refreshed;

      if (this.credsFilePath) {
        await this.persistCreds(this.credsFilePath, refreshed);
      }

      return refreshed;
    } catch (error) {
      if (beforeRefresh.expiresAt.getTime() > this.now().getTime()) {
        return beforeRefresh;
      }

      throw error;
    } finally {
      this.inFlightRefresh = undefined;
    }
  }

  private async runRefreshMethods(refreshToken: string): Promise<Creds> {
    try {
      return await this.refreshDesktop(refreshToken);
    } catch (desktopError) {
      if (this.refreshSsoOidc) {
        return this.refreshSsoOidc(refreshToken);
      }

      throw desktopError;
    }
  }
}
