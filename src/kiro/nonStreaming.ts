import type { KiroAnthropicEvent } from "../stream/anthropicSse";
import type { KiroOpenAiEvent } from "../stream/openaiSse";
import { decodeAwsEventStreamMessages } from "../stream/awsEventStream";

function parseKiroEvents<T extends { type: string }>(bytes: Uint8Array): T[] {
  const messages = decodeAwsEventStreamMessages(bytes);
  const events: T[] = [];
  for (const m of messages) {
    const text = new TextDecoder().decode(m.payload);
    if (!text.trim()) continue;
    try {
      const ev = JSON.parse(text) as T;
      if (ev && typeof ev === "object" && "type" in ev) events.push(ev);
    } catch {
      // ignore non-json payloads
    }
  }
  return events;
}

type ExtractedJson = Record<string, unknown>;

function findMatchingBrace(text: string, startPos: number): number {
  if (startPos >= text.length || text[startPos] !== "{") return -1;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startPos; i < text.length; i++) {
    const ch = text[i]!;
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") braceCount++;
      else if (ch === "}") {
        braceCount--;
        if (braceCount === 0) return i;
      }
    }
  }
  return -1;
}

function extractKiroJsonEventsFromBytes(bytes: Uint8Array): ExtractedJson[] {
  const messages = decodeAwsEventStreamMessages(bytes);
  const allText = messages.map((m) => new TextDecoder().decode(m.payload)).join("");

  const patterns = [
    '{"content":',
    '{"name":',
    '{"input":',
    '{"stop":',
    '{"usage":',
    '{"contextUsagePercentage":',
    '{"type":', // legacy internal typed events
  ];

  const out: ExtractedJson[] = [];
  let buf = allText;

  while (true) {
    let earliest = -1;
    for (const needle of patterns) {
      const pos = buf.indexOf(needle);
      if (pos !== -1 && (earliest === -1 || pos < earliest)) earliest = pos;
    }
    if (earliest === -1) break;
    const end = findMatchingBrace(buf, earliest);
    if (end === -1) break;
    const jsonStr = buf.slice(earliest, end + 1);
    buf = buf.slice(end + 1);
    try {
      out.push(JSON.parse(jsonStr) as ExtractedJson);
    } catch {
      // ignore
    }
  }

  return out;
}

function kiroJsonToOpenAiEvents(objs: ExtractedJson[]): KiroOpenAiEvent[] {
  const events: KiroOpenAiEvent[] = [];
  for (const obj of objs) {
    if (typeof obj["type"] === "string") {
      events.push(obj as unknown as KiroOpenAiEvent);
      continue;
    }
    const content = obj["content"];
    const followup = obj["followupPrompt"];
    if (typeof content === "string" && !followup) {
      events.push({ type: "content", delta: content });
      continue;
    }
    if (typeof obj["contextUsagePercentage"] === "number") {
      events.push({ type: "end", finishReason: "stop" });
    }
  }
  return events;
}

function kiroJsonToAnthropicEvents(objs: ExtractedJson[]): KiroAnthropicEvent[] {
  const events: KiroAnthropicEvent[] = [];
  for (const obj of objs) {
    if (typeof obj["type"] === "string") {
      events.push(obj as unknown as KiroAnthropicEvent);
      continue;
    }
    const content = obj["content"];
    const followup = obj["followupPrompt"];
    if (typeof content === "string" && !followup) {
      events.push({ type: "content", delta: content });
      continue;
    }
    if (typeof obj["contextUsagePercentage"] === "number") {
      events.push({ type: "end", finishReason: "end_turn", usage: { output_tokens: 0 } });
    }
  }
  return events;
}

export function kiroBytesToOpenAiChatCompletion(bytes: Uint8Array): Record<string, unknown> {
  const typedEvents = parseKiroEvents<KiroOpenAiEvent>(bytes);
  const events = typedEvents.length > 0 ? typedEvents : kiroJsonToOpenAiEvents(extractKiroJsonEventsFromBytes(bytes));
  const id = "chatcmpl-kiro-proxy";
  let content = "";
  let finishReason: string | null = null;
  let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
  const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

  for (const ev of events) {
    if (ev.type === "content") {
      content += ev.delta ?? "";
    } else if (ev.type === "usage") {
      const pt = ev.usage.input_tokens;
      const ct = ev.usage.output_tokens;
      usage = { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct };
    } else if (ev.type === "tool_use") {
      for (const [i, tc] of ev.toolCalls.entries()) {
        toolCalls.push({
          id: `call_${toolCalls.length + i}`,
          type: "function",
          function: { name: tc.name, arguments: tc.argumentsJson },
        });
      }
    } else if (ev.type === "end") {
      finishReason = ev.finishReason ?? "stop";
    }
  }

  const message: Record<string, unknown> = {
    role: "assistant",
    content,
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id,
    object: "chat.completion",
    created: 0,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

export function kiroBytesToAnthropicMessage(bytes: Uint8Array, model: string): Record<string, unknown> {
  const typedEvents = parseKiroEvents<KiroAnthropicEvent>(bytes);
  const events = typedEvents.length > 0 ? typedEvents : kiroJsonToAnthropicEvents(extractKiroJsonEventsFromBytes(bytes));
  const id = "msg_kiro_proxy";
  let text = "";
  let stopReason: string | null = null;
  let outputTokens = 0;

  for (const ev of events) {
    if (ev.type === "error") {
      return {
        type: "error",
        error: { type: "api_error", message: ev.message },
      };
    }
    if (ev.type === "content") {
      text += ev.delta ?? "";
    } else if (ev.type === "end") {
      stopReason = ev.finishReason ?? "end_turn";
      outputTokens = ev.usage?.output_tokens ?? 0;
    }
  }

  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: stopReason ?? "end_turn",
    usage: { output_tokens: outputTokens },
  };
}

