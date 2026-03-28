import type { Creds } from "./types";

export type RefreshSsoOidcFn = (refreshToken: string) => Promise<Creds>;

export const refreshSsoOidc: RefreshSsoOidcFn = async () => {
  throw new Error("SSO OIDC refresh is not implemented");
};
