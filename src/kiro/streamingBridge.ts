import { decodeAwsEventStreamMessages } from "../stream/awsEventStream";
import type { KiroAnthropicEvent } from "../stream/anthropicSse";
import { kiroEventsToAnthropicSse } from "../stream/anthropicSse";
import type { KiroOpenAiEvent } from "../stream/openaiSse";
import { kiroEventsToOpenAiSse } from "../stream/openaiSse";

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

function extractKiroJsonEventsFromText(text: string): ExtractedJson[] {
  // Kiro's upstream stream contains embedded JSON objects like {"content": "..."}.
  // This extractor is resilient to extra framing/noise bytes around those objects.
  const patterns: Array<{ needle: string; kind: string }> = [
    { needle: '{"content":', kind: "content" },
    { needle: '{"name":', kind: "tool_start" },
    { needle: '{"input":', kind: "tool_input" },
    { needle: '{"stop":', kind: "tool_stop" },
    { needle: '{"usage":', kind: "usage" },
    { needle: '{"contextUsagePercentage":', kind: "context_usage" },
    // Legacy internal format emitted by our tests and mock upstreams.
    { needle: '{"type":', kind: "typed" },
  ];

  const out: ExtractedJson[] = [];
  let buf = text;

  while (true) {
    let earliestPos = -1;
    for (const p of patterns) {
      const pos = buf.indexOf(p.needle);
      if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) earliestPos = pos;
    }
    if (earliestPos === -1) break;
    const end = findMatchingBrace(buf, earliestPos);
    if (end === -1) break; // need more data

    const jsonStr = buf.slice(earliestPos, end + 1);
    buf = buf.slice(end + 1);
    try {
      const obj = JSON.parse(jsonStr) as ExtractedJson;
      out.push(obj);
    } catch {
      // ignore malformed json segments
    }
  }

  return out;
}

function kiroJsonToOpenAiEvents(objs: ExtractedJson[]): KiroOpenAiEvent[] {
  const events: KiroOpenAiEvent[] = [];
  for (const obj of objs) {
    const typed = obj["type"];
    if (typeof typed === "string") {
      // Our legacy internal typed event format.
      try {
        events.push(obj as unknown as KiroOpenAiEvent);
      } catch {
        // ignore
      }
      continue;
    }

    const content = obj["content"];
    const followup = obj["followupPrompt"];
    if (typeof content === "string" && !followup) {
      events.push({ type: "content", delta: content });
      continue;
    }

    const contextUsage = obj["contextUsagePercentage"];
    if (typeof contextUsage === "number") {
      events.push({ type: "end", finishReason: "stop" });
      continue;
    }
  }
  return events;
}

function kiroJsonToAnthropicEvents(objs: ExtractedJson[]): KiroAnthropicEvent[] {
  const events: KiroAnthropicEvent[] = [];
  for (const obj of objs) {
    const typed = obj["type"];
    if (typeof typed === "string") {
      // Our legacy internal typed event format.
      try {
        events.push(obj as unknown as KiroAnthropicEvent);
      } catch {
        // ignore
      }
      continue;
    }

    const content = obj["content"];
    const followup = obj["followupPrompt"];
    if (typeof content === "string" && !followup) {
      events.push({ type: "content", delta: content });
      continue;
    }

    const contextUsage = obj["contextUsagePercentage"];
    if (typeof contextUsage === "number") {
      events.push({ type: "end", finishReason: "end_turn", usage: { output_tokens: 0 } });
      continue;
    }
  }
  return events;
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function readAllStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
    }
  }
  return concatUint8(chunks);
}

export function bytesToOpenAiSse(bytes: Uint8Array): string {
  const messages = decodeAwsEventStreamMessages(bytes);
  const allText = messages.map((m) => new TextDecoder().decode(m.payload)).join("");
  const objs = extractKiroJsonEventsFromText(allText);
  const events = kiroJsonToOpenAiEvents(objs);
  return kiroEventsToOpenAiSse(events);
}

export function bytesToAnthropicSse(bytes: Uint8Array): string {
  const messages = decodeAwsEventStreamMessages(bytes);
  const allText = messages.map((m) => new TextDecoder().decode(m.payload)).join("");
  const objs = extractKiroJsonEventsFromText(allText);
  const events = kiroJsonToAnthropicEvents(objs);
  return kiroEventsToAnthropicSse(events);
}
