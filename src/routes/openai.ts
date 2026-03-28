import type { KiroClient } from "../kiro/client";
import { assertProxyApiKey, UnauthorizedError } from "../http/auth";
import { openAiJsonError } from "../http/responses";
import { resolveKiroModelId } from "../kiro/modelResolver";
import { kiroBytesToOpenAiChatCompletion } from "../kiro/nonStreaming";
import { buildKiroPayloadFromOpenAi as mapOpenAiToKiroPayload } from "../kiro/payload";
import { readAllStreamBytes } from "../kiro/streamingBridge";

export type OpenAiRoutesDeps = {
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
      return openAiJsonError(401, error.message, "authentication_error");
    }
    throw error;
  }
}

function buildKiroPayloadFromOpenAi(record: Record<string, unknown>, deps: OpenAiRoutesDeps): Record<string, unknown> {
  const payload = mapOpenAiToKiroPayload({
    model: resolveKiroModelId(String(record.model)),
    messages: (record.messages as unknown[]) ?? [],
  });

  if (deps.includeProfileArn && deps.profileArn) {
    payload.profileArn = deps.profileArn;
  }

  return payload;
}

export function createOpenAiRoutes(deps: OpenAiRoutesDeps): {
  models: (req: Request) => Promise<Response>;
  chatCompletions: (req: Request) => Promise<Response>;
} {
  return {
    async models(req: Request): Promise<Response> {
      const authError = requireProxyAuth(req, deps.proxyApiKey);
      if (authError) {
        return authError;
      }

      return deps.kiro.listAvailableModels({
        includeProfileArn: deps.includeProfileArn,
        profileArn: deps.profileArn,
      });
    },

    async chatCompletions(req: Request): Promise<Response> {
      const authError = requireProxyAuth(req, deps.proxyApiKey);
      if (authError) {
        return authError;
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return openAiJsonError(400, "Invalid JSON body", "invalid_request_error");
      }

      if (!body || typeof body !== "object") {
        return openAiJsonError(400, "Request body must be a JSON object", "invalid_request_error");
      }

      const record = body as Record<string, unknown>;
      const model = record.model;
      if (typeof model !== "string" || model.trim() === "") {
        return openAiJsonError(400, "Missing or invalid 'model'", "invalid_request_error");
      }

      if (!Array.isArray(record.messages)) {
        return openAiJsonError(400, "Missing or invalid 'messages'", "invalid_request_error");
      }

      const kiroBody = buildKiroPayloadFromOpenAi(record, deps);

      try {
        if (record.stream === true) {
          return await deps.kiro.streamOpenAiFromUpstream(kiroBody);
        }

        // Non-streaming: still call upstream streaming and collect to one JSON response.
        const upstream = await deps.kiro.generateAssistantResponseStream(kiroBody);
        if (!upstream.res.ok) {
          const text = await upstream.res.text();
          return new Response(text, { status: upstream.res.status });
        }
        if (!upstream.res.body) {
          return openAiJsonError(502, "Upstream returned no body", "server_error");
        }
        const bytes = await readAllStreamBytes(upstream.res.body);
        const out = kiroBytesToOpenAiChatCompletion(bytes);
        return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
      } catch (error) {
        if (error instanceof Error) {
          // Keep errors JSON-shaped for OpenAI clients; avoid Bun's default HTML 500.
          // `/v1/models` intentionally degrades to empty list when creds aren't available;
          // chat completions should similarly surface "service unavailable" instead of crashing.
          if (error.message === "No Kiro credentials configured") {
            return openAiJsonError(503, error.message, "server_error");
          }
          if (error.message.startsWith("Invalid creds file:")) {
            return openAiJsonError(503, error.message, "server_error");
          }
          if ("code" in error && (error as { code?: unknown }).code === "ENOENT") {
            return openAiJsonError(503, "Kiro credentials file not found", "server_error");
          }
        }

        return openAiJsonError(500, "Internal server error", "server_error");
      }
    },
  };
}
