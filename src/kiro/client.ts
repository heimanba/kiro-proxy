import { readAllStreamBytes, bytesToAnthropicSse, bytesToOpenAiSse } from "./streamingBridge";
import { buildListAvailableModelsUrl } from "./endpoints";
import { buildKiroHeaders } from "./headers";
import { mapListModelsToOpenAi } from "./models";

export type KiroFetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type KiroUpstreamEvent =
  | {
      type: "upstream_request";
      operation: "ListAvailableModels" | "GenerateAssistantResponse";
      method: string;
      url: string;
      invocationId: string;
    }
  | {
      type: "upstream_response";
      operation: "ListAvailableModels" | "GenerateAssistantResponse";
      status: number;
      contentType: string | null;
      invocationId: string;
      errorSnippet?: string;
    }
  | {
      type: "upstream_no_body";
      operation: "GenerateAssistantResponse";
      status: number;
      invocationId: string;
    };

export type KiroClientOptions = {
  region: string;
  getAccessToken: () => Promise<string>;
  fetchFn?: KiroFetchFn;
  onUpstreamEvent?: (event: KiroUpstreamEvent) => void;
};

function kiroApiBase(region: string): string {
  return `https://q.${region}.amazonaws.com`;
}

function headerRecord(invocationId: string, accessToken: string): Record<string, string> {
  const h = buildKiroHeaders({ accessToken, invocationId });
  return { ...h };
}

export class KiroClient {
  private readonly region: string;
  private readonly getAccessTokenFn: () => Promise<string>;
  private readonly fetchFn: KiroFetchFn;
  private readonly onUpstreamEvent?: (event: KiroUpstreamEvent) => void;

  constructor(options: KiroClientOptions) {
    this.region = options.region;
    this.getAccessTokenFn = options.getAccessToken;
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.onUpstreamEvent = options.onUpstreamEvent;
  }

  async getAccessToken(): Promise<string> {
    return this.getAccessTokenFn();
  }

  private emit(event: KiroUpstreamEvent) {
    try {
      this.onUpstreamEvent?.(event);
    } catch {
      // Never let logging break the proxy.
    }
  }

  async listAvailableModels(options: {
    includeProfileArn: boolean;
    profileArn: string | undefined;
  }): Promise<Response> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch {
      return new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const url = buildListAvailableModelsUrl({
      region: this.region,
      profileArn: options.profileArn,
      includeProfileArn: options.includeProfileArn,
    });

    const invocationId = crypto.randomUUID();
    this.emit({
      type: "upstream_request",
      operation: "ListAvailableModels",
      method: "GET",
      url,
      invocationId,
    });

    const res = await this.fetchFn(url, {
      method: "GET",
      headers: headerRecord(invocationId, token),
    });

    if (!res.ok) {
      this.emit({
        type: "upstream_response",
        operation: "ListAvailableModels",
        status: res.status,
        contentType: res.headers.get("content-type"),
        invocationId,
      });
      return new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    this.emit({
      type: "upstream_response",
      operation: "ListAvailableModels",
      status: res.status,
      contentType: res.headers.get("content-type"),
      invocationId,
    });

    const json = (await res.json()) as unknown;
    const body = mapListModelsToOpenAi(json);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  async generateAssistantResponseStream(body: unknown): Promise<{ res: Response; invocationId: string; url: string }> {
    const token = await this.getAccessToken();
    const url = `${kiroApiBase(this.region)}/generateAssistantResponse`;
    const invocationId = crypto.randomUUID();
    this.emit({
      type: "upstream_request",
      operation: "GenerateAssistantResponse",
      method: "POST",
      url,
      invocationId,
    });
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: headerRecord(invocationId, token),
      body: JSON.stringify(body),
    });
    return { res, invocationId, url };
  }

  async streamOpenAiFromUpstream(body: unknown): Promise<Response> {
    const upstream = await this.generateAssistantResponseStream(body);
    const res = upstream.res;
    if (!res.ok) {
      const text = await res.text();
      this.emit({
        type: "upstream_response",
        operation: "GenerateAssistantResponse",
        status: res.status,
        contentType: res.headers.get("content-type"),
        invocationId: upstream.invocationId,
        errorSnippet: text.slice(0, 2000),
      });
      return new Response(text, { status: res.status });
    }
    this.emit({
      type: "upstream_response",
      operation: "GenerateAssistantResponse",
      status: res.status,
      contentType: res.headers.get("content-type"),
      invocationId: upstream.invocationId,
    });

    if (!res.body) {
      this.emit({
        type: "upstream_no_body",
        operation: "GenerateAssistantResponse",
        status: res.status,
        invocationId: upstream.invocationId,
      });
      return new Response("Upstream returned no body", { status: 502 });
    }
    const bytes = await readAllStreamBytes(res.body);
    const sse = bytesToOpenAiSse(bytes);
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }

  async streamAnthropicFromUpstream(body: unknown): Promise<Response> {
    const upstream = await this.generateAssistantResponseStream(body);
    const res = upstream.res;
    if (!res.ok) {
      const text = await res.text();
      this.emit({
        type: "upstream_response",
        operation: "GenerateAssistantResponse",
        status: res.status,
        contentType: res.headers.get("content-type"),
        invocationId: upstream.invocationId,
        errorSnippet: text.slice(0, 2000),
      });
      return new Response(text, { status: res.status });
    }
    this.emit({
      type: "upstream_response",
      operation: "GenerateAssistantResponse",
      status: res.status,
      contentType: res.headers.get("content-type"),
      invocationId: upstream.invocationId,
    });

    if (!res.body) {
      this.emit({
        type: "upstream_no_body",
        operation: "GenerateAssistantResponse",
        status: res.status,
        invocationId: upstream.invocationId,
      });
      return new Response("Upstream returned no body", { status: 502 });
    }
    const bytes = await readAllStreamBytes(res.body);
    const sse = bytesToAnthropicSse(bytes);
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }
}
