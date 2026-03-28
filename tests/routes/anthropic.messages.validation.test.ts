import { expect, test } from "bun:test";

import { loadConfigFromEnv } from "../../src/config";
import { createFetchHandler } from "../../src/server";

// Ensure tests don't accidentally pick up real user creds via implicit ~/.aws/sso cache.
const config = loadConfigFromEnv({ PROXY_API_KEY: "k", HOME: "/nonexistent" });
const handler = createFetchHandler(config);
const headers = {
  "x-api-key": "k",
  "content-type": "application/json",
};

test("messages: missing model returns 400", async () => {
  const res = await handler(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ max_tokens: 16, messages: [] }),
    }),
  );
  expect(res.status).toBe(400);
});

test("messages: missing max_tokens returns 400", async () => {
  const res = await handler(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "x", messages: [] }),
    }),
  );
  expect(res.status).toBe(400);
});

test("messages: missing messages returns 400", async () => {
  const res = await handler(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "x", max_tokens: 16 }),
    }),
  );
  expect(res.status).toBe(400);
});

test("messages: valid body returns 503 without creds", async () => {
  const res = await handler(
    new Request("http://localhost/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "x",
        max_tokens: 16,
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    }),
  );
  expect(res.status).toBe(503);
});
