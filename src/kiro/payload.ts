type MessageRole = "user" | "assistant";

type UnifiedMessage = {
  role: MessageRole;
  content: string;
};

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        parts.push(record.text);
      } else if (typeof record.text === "string") {
        parts.push(record.text);
      }
    }
    return parts.join("");
  }

  return "";
}

function normalizeRole(role: unknown): MessageRole | null {
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "user") {
    return "user";
  }
  return null;
}

function toUnifiedMessages(messages: unknown[]): UnifiedMessage[] {
  const normalized: UnifiedMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const role = normalizeRole(record.role);
    if (!role) {
      continue;
    }
    normalized.push({
      role,
      content: extractTextContent(record.content) || "(empty)",
    });
  }
  return normalized;
}

function ensureUserFirst(messages: UnifiedMessage[]): UnifiedMessage[] {
  if (messages.length === 0) {
    return [{ role: "user", content: "Continue" }];
  }
  if (messages[0]!.role === "user") {
    return messages;
  }
  return [{ role: "user", content: "(empty)" }, ...messages];
}

function ensureAlternating(messages: UnifiedMessage[]): UnifiedMessage[] {
  if (messages.length < 2) {
    return messages;
  }
  const out: UnifiedMessage[] = [messages[0]!];
  for (const msg of messages.slice(1)) {
    const prev = out[out.length - 1]!;
    if (prev.role === msg.role) {
      out.push({
        role: prev.role === "user" ? "assistant" : "user",
        content: "(empty)",
      });
    }
    out.push(msg);
  }
  return out;
}

function toHistoryEntry(message: UnifiedMessage, modelId: string): Record<string, unknown> {
  if (message.role === "user") {
    return {
      userInputMessage: {
        content: message.content || "(empty)",
        modelId,
        origin: "AI_EDITOR",
      },
    };
  }
  return {
    assistantResponseMessage: {
      content: message.content || "(empty)",
    },
  };
}

function extractSystemPromptFromOpenAi(input: unknown[]): { systemPrompt?: string; messages: unknown[] } {
  const systemParts: string[] = [];
  const withoutSystem: unknown[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.role === "system") {
      const text = extractTextContent(record.content);
      if (text) {
        systemParts.push(text);
      }
    } else {
      withoutSystem.push(item);
    }
  }
  const systemPrompt = systemParts.join("\n").trim();
  return {
    systemPrompt: systemPrompt || undefined,
    messages: withoutSystem,
  };
}

export function buildKiroPayloadFromOpenAi(input: {
  model: string;
  messages: unknown[];
}): Record<string, unknown> {
  const extracted = extractSystemPromptFromOpenAi(input.messages);
  return buildKiroConversationPayload({
    model: input.model,
    messages: extracted.messages,
    systemPrompt: extracted.systemPrompt,
  });
}

export function buildKiroPayloadFromAnthropic(input: {
  model: string;
  messages: unknown[];
  system?: unknown;
}): Record<string, unknown> {
  const systemPrompt = extractTextContent(input.system);
  return buildKiroConversationPayload({
    model: input.model,
    messages: input.messages,
    systemPrompt: systemPrompt || undefined,
  });
}

function buildKiroConversationPayload(input: {
  model: string;
  messages: unknown[];
  systemPrompt?: string;
}): Record<string, unknown> {
  const conversationId = crypto.randomUUID();
  const unified = ensureAlternating(ensureUserFirst(toUnifiedMessages(input.messages)));
  const historyMessages = unified.slice(0, -1);
  const current = unified[unified.length - 1] ?? { role: "user" as const, content: "Continue" };

  const history = historyMessages.map((msg) => toHistoryEntry(msg, input.model));
  let currentContent = current.content || "Continue";

  if (input.systemPrompt) {
    if (history.length > 0) {
      const first = history[0] as Record<string, unknown>;
      const userInput = first.userInputMessage as Record<string, unknown> | undefined;
      if (userInput && typeof userInput.content === "string") {
        userInput.content = `${input.systemPrompt}\n\n${userInput.content}`;
      }
    } else {
      currentContent = `${input.systemPrompt}\n\n${currentContent}`;
    }
  }

  if (current.role === "assistant") {
    history.push({
      assistantResponseMessage: {
        content: currentContent || "(empty)",
      },
    });
    currentContent = "Continue";
  }

  return {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      ...(history.length > 0 ? { history } : {}),
      currentMessage: {
        userInputMessage: {
          content: currentContent || "Continue",
          modelId: input.model,
          origin: "AI_EDITOR",
        },
      },
    },
  };
}
