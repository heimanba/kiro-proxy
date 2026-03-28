export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function getBearerToken(authorization: string | null): string | null {
  if (!authorization) {
    return null;
  }

  const normalized = authorization.trim();
  const match = /^bearer[ \t]+(.+)$/i.exec(normalized);
  if (!match) {
    return null;
  }

  const captured = match[1];
  if (!captured) {
    return null;
  }

  const token = captured.trim();
  if (!token) {
    return null;
  }

  return token;
}

export function assertProxyApiKey(headers: Headers, expectedKey: string): void {
  const key = getBearerToken(headers.get("authorization")) ?? headers.get("x-api-key");

  if (!key || key !== expectedKey) {
    throw new UnauthorizedError("Invalid or missing API key");
  }
}
