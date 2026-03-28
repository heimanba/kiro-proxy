import { expect, test } from "bun:test";

import { loadConfigFromEnv } from "../../src/config";
import { createFetchHandler } from "../../src/server";

// Ensure tests don't accidentally pick up real user creds via implicit ~/.aws/sso cache.
const config = loadConfigFromEnv({ PROXY_API_KEY: "k", HOME: "/nonexistent" });
const handler = createFetchHandler(config);
const headers = {
  authorization: "Bearer k",
  "content-type": "application/json",
};

test("chat completions: missing model returns 400", async () => {
  const res = await handler(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [] }),
    }),
  );
  expect(res.status).toBe(400);
});

test("chat completions: missing messages returns 400", async () => {
  const res = await handler(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "x" }),
    }),
  );
  expect(res.status).toBe(400);
});

test("chat completions: valid body returns 501 until Kiro wiring", async () => {
  const res = await handler(
    new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "x",
        messages: [{ role: "user", content: "hi" }],
      }),
    }),
  );
  // Proxy attempts upstream; without creds it returns 503.
  expect(res.status).toBe(503);
});
