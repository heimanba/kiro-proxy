import { expect, test } from "bun:test";

import { loadConfigFromEnv } from "../../src/config";
import { createFetchHandler } from "../../src/server";

test("/v1/models returns 401 without proxy key", async () => {
  const config = loadConfigFromEnv({ PROXY_API_KEY: "secret" });
  const handler = createFetchHandler(config);
  const res = await handler(new Request("http://localhost/v1/models"));
  expect(res.status).toBe(401);
});
