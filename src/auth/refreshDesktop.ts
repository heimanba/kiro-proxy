import type { Creds } from "./types";

export type RefreshDesktopFn = (refreshToken: string) => Promise<Creds>;

export const refreshDesktop: RefreshDesktopFn = async () => {
  throw new Error("Desktop refresh is not implemented");
};
