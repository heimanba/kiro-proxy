import type { KiroClient } from "../kiro/client";
import { assertProxyApiKey, UnauthorizedError } from "../http/auth";
import { anthropicJsonError, anthropicNotImplementedResponse } from "../http/responses";
import { resolveKiroModelId } from "../kiro/modelResolver";
import { kiroBytesToAnthropicMessage } from "../kiro/nonStreaming";
import { buildKiroPayloadFromAnthropic as mapAnthropicToKiroPayload } from "../kiro/payload";
import { readAllStreamBytes } from "../kiro/streamingBridge";

export type AnthropicRoutesDeps = {
  proxyApiKey: string;
  kiro: KiroClient;
  includeProfileArn: boolean;
  profileArn: string | undefined;
};

function requireProxyAuth(req: Request, proxyApiKey: string): Response | null {
  try {
    assertProxyApiKey(req.headers, proxyApiKey);
    return null;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return anthropicJsonError(401, error.message, "authentication_error");
    }
    throw error;
  }
}

function buildKiroPayloadFromAnthropic(record: Record<string, unknown>, deps: AnthropicRoutesDeps): Record<string, unknown> {
  const payload = mapAnthropicToKiroPayload({
    model: resolveKiroModelId(String(record.model)),
    messages: (record.messages as unknown[]) ?? [],
    system: record.system,
  });

  if (deps.includeProfileArn && deps.profileArn) {
    payload.profileArn = deps.profileArn;
  }

  return payload;
}

export function createAnthropicRoutes(deps: AnthropicRoutesDeps): {
  messages: (req: Request) => Promise<Response>;
} {
  return {
    async messages(req: Request): Promise<Response> {
      const authError = requireProxyAuth(req, deps.proxyApiKey);
      if (authError) {
        return authError;
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return anthropicJsonError(400, "Invalid JSON body", "invalid_request_error");
      }

      if (!body || typeof body !== "object") {
        return anthropicJsonError(400, "Request body must be a JSON object", "invalid_request_error");
      }

      const record = body as Record<string, unknown>;
      const model = record.model;
      if (typeof model !== "string" || model.trim() === "") {
        return anthropicJsonError(400, "Missing or invalid 'model'", "invalid_request_error");
      }

      const maxTokens = record.max_tokens;
      if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens <= 0) {
        return anthropicJsonError(400, "Missing or invalid 'max_tokens'", "invalid_request_error");
      }

      if (!Array.isArray(record.messages)) {
        return anthropicJsonError(400, "Missing or invalid 'messages'", "invalid_request_error");
      }

      const kiroBody = buildKiroPayloadFromAnthropic(record, deps);

      try {
        if (record.stream === true) {
          return await deps.kiro.streamAnthropicFromUpstream(kiroBody);
        }

        const upstream = await deps.kiro.generateAssistantResponseStream(kiroBody);
        if (!upstream.res.ok) {
          const text = await upstream.res.text();
          return new Response(text, { status: upstream.res.status });
        }
        if (!upstream.res.body) {
          return anthropicJsonError(502, "Upstream returned no body", "invalid_request_error");
        }
        const bytes = await readAllStreamBytes(upstream.res.body);
        const out = kiroBytesToAnthropicMessage(bytes, resolveKiroModelId(String(record.model)));
        return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === "No Kiro credentials configured") {
            return anthropicJsonError(503, error.message, "invalid_request_error");
          }
          if (error.message.startsWith("Invalid creds file:")) {
            return anthropicJsonError(503, error.message, "invalid_request_error");
          }
          if ("code" in error && (error as { code?: unknown }).code === "ENOENT") {
            return anthropicJsonError(503, "Kiro credentials file not found", "invalid_request_error");
          }
        }
        return anthropicNotImplementedResponse("Internal server error");
      }
    },
  };
}
