export type KiroAnthropicEvent =
  | { type: "content"; delta: string }
  | { type: "end"; finishReason: string; usage?: { output_tokens: number } }
  | { type: "error"; message: string };

export function kiroEventsToAnthropicSse(events: KiroAnthropicEvent[]): string {
  const parts: string[] = [];

  for (const ev of events) {
    if (ev.type === "error") {
      parts.push(`event: error\n`);
      parts.push(`data: ${JSON.stringify({ type: "error", error: { type: "api_error", message: ev.message } })}\n\n`);
      return parts.join("");
    }
  }

  const messageId = "msg_kiro_proxy";
  parts.push(`event: message_start\n`);
  parts.push(
    `data: ${JSON.stringify({
      type: "message_start",
      message: { id: messageId, type: "message", role: "assistant", model: "claude", content: [], stop_reason: null },
    })}\n\n`,
  );

  let contentEmitted = false;
  for (const ev of events) {
    if (ev.type === "content") {
      if (!contentEmitted) {
        parts.push(`event: content_block_start\n`);
        parts.push(
          `data: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}\n\n`,
        );
        contentEmitted = true;
      }
      parts.push(`event: content_block_delta\n`);
      parts.push(
        `data: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: ev.delta },
        })}\n\n`,
      );
    }
  }

  if (contentEmitted) {
    parts.push(`event: content_block_stop\n`);
    parts.push(`data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
  }

  for (const ev of events) {
    if (ev.type === "end") {
      const usage =
        ev.usage !== undefined
          ? { output_tokens: ev.usage.output_tokens }
          : { output_tokens: 0 };
      parts.push(`event: message_delta\n`);
      parts.push(
        `data: ${JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: ev.finishReason, usage },
        })}\n\n`,
      );
      parts.push(`event: message_stop\n`);
      parts.push(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      break;
    }
  }

  return parts.join("");
}
