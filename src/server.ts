import { createKiroAccessTokenGetter } from "./auth/kiroAccessToken";
import type { AppConfig } from "./config";
import { KiroClient, type KiroUpstreamEvent } from "./kiro/client";
import { createLogger, errorToLogFields, getAuthHeadersMasked, newRequestId } from "./logging";
import { createAnthropicRoutes } from "./routes/anthropic";
import { createOpenAiRoutes } from "./routes/openai";

export function createFetchHandler(config: AppConfig): (req: Request) => Response | Promise<Response> {
  const logger = createLogger();
  const onUpstreamEvent = (event: KiroUpstreamEvent) => {
    if (event.type === "upstream_request") {
      logger.debug("upstream_request", event);
      return;
    }
    if (event.type === "upstream_no_body") {
      logger.warn("upstream_no_body", event);
      return;
    }
    if (event.type === "upstream_response") {
      if (event.status >= 400) {
        logger.warn("upstream_response", event);
      } else {
        logger.debug("upstream_response", event);
      }
    }
  };
  const kiro = new KiroClient({
    region: config.kiroRegion,
    getAccessToken: createKiroAccessTokenGetter(config),
    onUpstreamEvent,
  });

  const openAi = createOpenAiRoutes({
    proxyApiKey: config.proxyApiKey,
    kiro,
    includeProfileArn: false,
    profileArn: undefined,
  });

  const anthropic = createAnthropicRoutes({
    proxyApiKey: config.proxyApiKey,
    kiro,
    includeProfileArn: false,
    profileArn: undefined,
  });

  return async (req: Request) => {
    const requestId = newRequestId();
    const t0 = performance.now();
    const url = new URL(req.url);
    const { authorization, xApiKey } = getAuthHeadersMasked(req.headers);
    const contentLength = req.headers.get("content-length") ?? undefined;

    logger.info("request_start", {
      requestId,
      method: req.method,
      path: url.pathname,
      query: url.search ? url.search.slice(1) : undefined,
      authorization,
      xApiKey,
      contentLength,
    });

    try {
      let res: Response;

      if (url.pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
        // Lightweight health check for tools that probe the root path.
        res = new Response(req.method === "HEAD" ? null : "ok", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      } else if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
        const body = {
          status: "ok",
          service: "kiro-proxy",
          region: config.kiroRegion,
        };
        res = new Response(req.method === "HEAD" ? null : JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } else if (url.pathname === "/v1/models" && req.method === "GET") {
        res = await openAi.models(req);
      } else if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        res = await openAi.chatCompletions(req);
      } else if (url.pathname === "/v1/messages" && req.method === "POST") {
        res = await anthropic.messages(req);
      } else {
        res = new Response("Not Found", { status: 404 });
      }

      const durationMs = Math.round(performance.now() - t0);
      logger.info("request_end", {
        requestId,
        method: req.method,
        path: url.pathname,
        status: res.status,
        durationMs,
      });

      if (res.status >= 400) {
        const hint =
          res.status === 401
            ? "Proxy auth failed (check Authorization Bearer / x-api-key vs PROXY_API_KEY)"
            : res.status === 501
              ? "Non-streaming not supported by this endpoint; set stream: true"
            : res.status === 503
              ? "Upstream credentials missing/invalid (check KIRO_ACCESS_TOKEN or KIRO_CREDS_FILE)"
              : res.status === 502
                ? "Bad gateway (upstream returned no body or invalid stream)"
                : res.status === 404
                  ? "Route not found (supported: GET /v1/models, POST /v1/chat/completions, POST /v1/messages)"
                  : undefined;

        logger.warn("request_diagnostics", {
          requestId,
          method: req.method,
          path: url.pathname,
          status: res.status,
          durationMs,
          hint,
        });
      }

      return res;
    } catch (error) {
      const durationMs = Math.round(performance.now() - t0);
      logger.error("request_error", {
        requestId,
        method: req.method,
        path: url.pathname,
        durationMs,
        authorization,
        xApiKey,
        contentLength,
        ...errorToLogFields(error),
      });
      return new Response("Internal Server Error", { status: 500 });
    }
  };
}

export function startServer(config: AppConfig) {
  return Bun.serve({
    hostname: config.serverHost,
    port: config.serverPort,
    fetch: createFetchHandler(config),
  });
}
