import { expect, test } from "bun:test";

import { encodeAwsEventStreamMessage } from "../../src/stream/awsEventStream";
import { bytesToAnthropicSse, bytesToOpenAiSse } from "../../src/kiro/streamingBridge";
import { kiroBytesToAnthropicMessage } from "../../src/kiro/nonStreaming";

test("parses real-style kiro upstream content JSON into anthropic SSE", () => {
  const msg = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new TextEncoder().encode(JSON.stringify({ content: "你好" })),
  });
  const sse = bytesToAnthropicSse(msg);
  expect(sse).toContain('"text_delta"');
  expect(sse).toContain("你好");
});

test("parses real-style kiro upstream content JSON into openai SSE", () => {
  const msg = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new TextEncoder().encode(JSON.stringify({ content: "hi" })),
  });
  const sse = bytesToOpenAiSse(msg);
  expect(sse).toContain('"content":"hi"');
  expect(sse).toContain("data: [DONE]");
});

test("non-streaming anthropic message collects content from real-style JSON", () => {
  const msg = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new TextEncoder().encode(JSON.stringify({ content: "你好" })),
  });
  const out = kiroBytesToAnthropicMessage(msg, "claude-sonnet-4-5") as any;
  expect(out.type).toBe("message");
  expect(out.content[0].text).toBe("你好");
  expect(out.stop_reason).toBe("end_turn");
});

