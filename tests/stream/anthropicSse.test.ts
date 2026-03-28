import { expect, test } from "bun:test";

import { kiroEventsToAnthropicSse } from "../../src/stream/anthropicSse";

test("anthropic sse: emits message_start and message_stop", () => {
  const sse = kiroEventsToAnthropicSse([
    { type: "content", delta: "hi" },
    { type: "end", finishReason: "end_turn", usage: { output_tokens: 2 } },
  ]);
  expect(sse).toContain("event: message_start\n");
  expect(sse).toContain("event: content_block_start\n");
  expect(sse).toContain("event: content_block_delta\n");
  expect(sse).toContain("event: content_block_stop\n");
  expect(sse).toContain("event: message_delta\n");
  expect(sse).toContain("event: message_stop\n");
});

test("anthropic sse: on error emits event:error and still terminates", () => {
  const sse = kiroEventsToAnthropicSse([{ type: "error", message: "boom" }]);
  expect(sse).toContain("event: error\n");
  expect(sse).toContain('"message":"boom"');
});
