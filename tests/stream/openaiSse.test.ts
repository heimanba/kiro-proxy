import { expect, test } from "bun:test";

import { kiroEventsToOpenAiSse } from "../../src/stream/openaiSse";

test("openai sse: first chunk includes role, later chunks include content deltas, ends with DONE", () => {
  const sse = kiroEventsToOpenAiSse([
    { type: "content", delta: "hi" },
    { type: "content", delta: "!" },
    { type: "usage", usage: { input_tokens: 1, output_tokens: 2 } },
    { type: "end", finishReason: "stop" },
  ]);
  expect(sse).toContain('data: {"id":');
  expect(sse).toContain('"delta":{"role":"assistant"');
  expect(sse).toContain('"delta":{"content":"hi"}');
  expect(sse).toContain('"finish_reason":"stop"');
  expect(sse).toContain("data: [DONE]\n\n");
});

test("openai sse: tool_calls finish_reason is tool_calls and includes indexed tool_calls", () => {
  const sse = kiroEventsToOpenAiSse([
    { type: "tool_use", toolCalls: [{ name: "f", argumentsJson: '{"x":1}' }] },
    { type: "end", finishReason: "tool_calls" },
  ]);
  expect(sse).toContain('"finish_reason":"tool_calls"');
  expect(sse).toContain('"tool_calls"');
  expect(sse).toContain('"index":0');
});
