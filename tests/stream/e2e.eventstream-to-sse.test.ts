import { expect, test } from "bun:test";

import { decodeAwsEventStreamMessages, encodeAwsEventStreamMessage } from "../../src/stream/awsEventStream";
import type { KiroOpenAiEvent } from "../../src/stream/openaiSse";
import { kiroEventsToOpenAiSse } from "../../src/stream/openaiSse";

test("e2e: eventstream -> payload json -> kiro events -> openai sse", () => {
  const msg = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const decoded = decodeAwsEventStreamMessages(msg);
  const payload = new TextDecoder().decode(decoded[0]!.payload);
  const ev = JSON.parse(payload) as KiroOpenAiEvent;
  const sse = kiroEventsToOpenAiSse([ev, { type: "end", finishReason: "stop" }]);
  expect(sse).toContain('"content":"hi"');
  expect(sse).toContain("data: [DONE]");
});
