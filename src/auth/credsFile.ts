import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Creds, CredsFileRaw, CredsUpdate } from "./types";

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid creds file: missing or invalid ${field}`);
  }

  return value;
}

function parseCredsObject(value: unknown): CredsFileRaw {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid creds file: expected JSON object");
  }

  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    accessToken: assertString(candidate.accessToken, "accessToken"),
    refreshToken: assertString(candidate.refreshToken, "refreshToken"),
    expiresAt: assertString(candidate.expiresAt, "expiresAt"),
  };
}

export async function readCredsFile(path: string): Promise<Creds> {
  const text = await readFile(path, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Invalid creds file: invalid JSON");
  }

  const parsed = parseCredsObject(raw);
  const expiresAt = new Date(parsed.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Invalid creds file: expiresAt is not a valid date");
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt,
  };
}

export async function writeCredsFileMerged(path: string, update: CredsUpdate): Promise<void> {
  if (Number.isNaN(update.expiresAt.getTime())) {
    throw new Error("Invalid creds update: expiresAt is not a valid date");
  }

  const text = await readFile(path, "utf8");
  const parsed = parseCredsObject(JSON.parse(text));
  const merged: Record<string, unknown> = {
    ...parsed,
    accessToken: update.accessToken,
    refreshToken: update.refreshToken,
    expiresAt: update.expiresAt.toISOString(),
  };

  const tempPath = join(dirname(path), `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const output = `${JSON.stringify(merged, null, 2)}\n`;

  await writeFile(tempPath, output, "utf8");

  try {
    const tempHandle = await open(tempPath, "r");
    try {
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }

    await rename(tempPath, path);

    const dirHandle = await open(dirname(path), "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
