export type CredsFileRaw = Record<string, unknown> & {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type Creds = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

export type CredsUpdate = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};
