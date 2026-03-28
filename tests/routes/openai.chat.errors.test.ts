import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfigFromEnv } from "../../src/config";
import { createFetchHandler } from "../../src/server";

const headers = {
  authorization: "Bearer k",
  "content-type": "application/json",
};

test("chat completions (stream): returns 503 JSON when no Kiro creds configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-openai-no-creds-"));
  try {
    const config = loadConfigFromEnv({ PROXY_API_KEY: "k", HOME: dir });
  const handler = createFetchHandler(config);

  const res = await handler(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "x",
        stream: true,
        messages: [{ role: "user", content: "ping" }],
      }),
    }),
  );

  expect(res.status).toBe(503);
  expect(res.headers.get("content-type")).toContain("application/json");
  const json = await res.json();
  expect(json).toHaveProperty("error.message");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("chat completions (stream): returns 503 JSON when creds file is invalid JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-openai-creds-"));
  try {
    const path = join(dir, "creds.json");
    await writeFile(path, "not-json", "utf8");

    const config = loadConfigFromEnv({ PROXY_API_KEY: "k", KIRO_CREDS_FILE: path });
    const handler = createFetchHandler(config);

    const res = await handler(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "x",
          stream: true,
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toContain("Invalid creds file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("chat completions (stream): returns 503 JSON when creds file missing required fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-openai-creds-"));
  try {
    const path = join(dir, "creds.json");
    await writeFile(path, JSON.stringify({ accessToken: "tok" }), "utf8");

    const config = loadConfigFromEnv({ PROXY_API_KEY: "k", KIRO_CREDS_FILE: path });
    const handler = createFetchHandler(config);

    const res = await handler(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "x",
          stream: true,
          messages: [{ role: "user", content: "ping" }],
        }),
      }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toContain("Invalid creds file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

