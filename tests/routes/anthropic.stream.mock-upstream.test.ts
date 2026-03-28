import { expect, test } from "bun:test";

import { type KiroFetchFn, KiroClient } from "../../src/kiro/client";
import { createAnthropicRoutes } from "../../src/routes/anthropic";
import { encodeAwsEventStreamMessage } from "../../src/stream/awsEventStream";

function streamFromBytes(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

test("anthropic messages stream: emits message_start ... message_stop", async () => {
  const msg1 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const msg2 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(
      JSON.stringify({ type: "end", finishReason: "end_turn", usage: { output_tokens: 2 } }),
    ),
  });
  const upstreamBytes = new Uint8Array([...msg1, ...msg2]);

  const fetchFn: KiroFetchFn = async () =>
    new Response(streamFromBytes(upstreamBytes), {
      status: 200,
      headers: { "content-type": "application/vnd.amazon.eventstream" },
    });

  const kiro = new KiroClient({
    region: "us-east-1",
    getAccessToken: async () => "token",
    fetchFn,
  });

  const routes = createAnthropicRoutes({
    proxyApiKey: "dev",
    kiro,
    includeProfileArn: false,
    profileArn: undefined,
  });

  const req = new Request("http://local/v1/messages", {
    method: "POST",
    headers: { "x-api-key": "dev", "content-type": "application/json" },
    body: JSON.stringify({
      model: "x",
      stream: true,
      max_tokens: 16,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }),
  });

  const res = await routes.messages(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  expect(text).toContain("event: message_start");
  expect(text).toContain("event: content_block_delta");
  expect(text).toContain("event: message_stop");
});
