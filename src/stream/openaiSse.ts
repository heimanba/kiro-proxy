export type KiroOpenAiEvent =
  | { type: "content"; delta: string }
  | { type: "usage"; usage: { input_tokens: number; output_tokens: number } }
  | { type: "end"; finishReason: string }
  | { type: "tool_use"; toolCalls: Array<{ name: string; argumentsJson: string }> };

const OBJECT = "chat.completion.chunk" as const;

function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export function kiroEventsToOpenAiSse(events: KiroOpenAiEvent[]): string {
  const id = "chatcmpl-kiro-proxy";
  const parts: string[] = [];
  let roleSent = false;
  let pendingUsage: { input_tokens: number; output_tokens: number } | undefined;

  for (const ev of events) {
    if (ev.type === "content") {
      if (!roleSent) {
        parts.push(
          sseData({
            id,
            object: OBJECT,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          }),
        );
        roleSent = true;
      }
      parts.push(
        sseData({
          id,
          object: OBJECT,
          choices: [{ index: 0, delta: { content: ev.delta }, finish_reason: null }],
        }),
      );
    } else if (ev.type === "usage") {
      pendingUsage = ev.usage;
    } else if (ev.type === "tool_use") {
      if (!roleSent) {
        parts.push(
          sseData({
            id,
            object: OBJECT,
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          }),
        );
        roleSent = true;
      }
      const toolCalls = ev.toolCalls.map((tc, i) => ({
        index: i,
        id: `call_${i}`,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argumentsJson },
      }));
      parts.push(
        sseData({
          id,
          object: OBJECT,
          choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
        }),
      );
    } else if (ev.type === "end") {
      const usagePayload = pendingUsage
        ? {
            prompt_tokens: pendingUsage.input_tokens,
            completion_tokens: pendingUsage.output_tokens,
            total_tokens: pendingUsage.input_tokens + pendingUsage.output_tokens,
          }
        : undefined;
      parts.push(
        sseData({
          id,
          object: OBJECT,
          choices: [{ index: 0, delta: {}, finish_reason: ev.finishReason }],
          ...(usagePayload ? { usage: usagePayload } : {}),
        }),
      );
    }
  }

  parts.push("data: [DONE]\n\n");
  return parts.join("");
}
