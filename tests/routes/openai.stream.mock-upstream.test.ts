import { expect, test } from "bun:test";

import { type KiroFetchFn, KiroClient } from "../../src/kiro/client";
import { createOpenAiRoutes } from "../../src/routes/openai";
import { encodeAwsEventStreamMessage } from "../../src/stream/awsEventStream";

function streamFromBytes(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

test("openai chat completions stream: maps upstream eventstream to SSE with [DONE]", async () => {
  const msg1 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const msg2 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "end", finishReason: "stop" })),
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

  const routes = createOpenAiRoutes({
    proxyApiKey: "dev",
    kiro,
    includeProfileArn: false,
    profileArn: undefined,
  });

  const req = new Request("http://local/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer dev", "content-type": "application/json" },
    body: JSON.stringify({ model: "x", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });

  const res = await routes.chatCompletions(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  expect(text).toContain('"role":"assistant"');
  expect(text).toContain('"content":"hi"');
  expect(text).toContain("data: [DONE]");
});
