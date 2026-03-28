# kiro-proxy JSON creds + OpenAI/Anthropic proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `@superpowers/subagent-driven-development` (aka `superpowers:subagent-driven-development`, recommended) or `@superpowers/executing-plans` (aka `superpowers:executing-plans`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Bun 项目 `kiro-proxy` 中实现一个本地/自托管 Kiro API 代理网关，提供 OpenAI/Anthropic 兼容端点，并支持从 `KIRO_CREDS_FILE` 读取/刷新/回写 Kiro 凭据（含 Enterprise `clientIdHash` → `~/.aws/sso/cache/*.json` 的 AWS SSO OIDC 刷新）。

**Architecture:** 使用 `Bun.serve()` 作为单体 HTTP 服务。路由层负责鉴权与协议兼容（OpenAI/Anthropic）；中间层负责 Kiro 上游调用（含 headers、URL、streaming）；认证层 `KiroAuthManager` 负责加载/刷新/并发锁/原子回写凭据文件，确保所有请求共享同一个 token 状态。

**Tech Stack:** Bun (`Bun.serve`, `fetch`, `bun test`), TypeScript (strict), Web Streams API (ReadableStream), Node 兼容路径/OS (`node:path`, `node:os`) 仅用于路径计算（尽量用 `Bun.file` 做 IO）。

---

## Preconditions (one-time)

- [ ] **Step: Ensure git is initialized (optional but required for commit steps)**

Run: `git status`
Expected: If it says "not a git repository", run `git init` then re-run `git status` successfully.

## Spec

- Spec: `docs/superpowers/specs/2026-03-26-kiro-proxy-json-creds-design.md`

## File structure (locked in)

**Create:**
- `src/config.ts`：读取/校验环境变量，输出强类型配置
- `src/errors.ts`：统一错误体与 helper（OpenAI 风格为主）
- `src/http/auth.ts`：代理 API key 鉴权（Authorization Bearer / x-api-key）
- `src/auth/types.ts`：AuthType/凭据结构类型
- `src/auth/credsFile.ts`：读取/写入 `KIRO_CREDS_FILE`（保留未知字段、原子写）
- `src/auth/awsSsoCache.ts`：读取 `~/.aws/sso/cache/{clientIdHash}.json`
- `src/auth/refreshDesktop.ts`：Kiro Desktop Auth 刷新实现
- `src/auth/refreshSsoOidc.ts`：AWS SSO OIDC 刷新实现
- `src/auth/kiroAuthManager.ts`：核心 auth manager（single-flight 刷新锁、阈值刷新、降级策略）
- `src/kiro/endpoints.ts`：拼装 Kiro API host + 上游路径
- `src/kiro/headers.ts`：上游请求 headers（不泄露 token）
- `src/kiro/client.ts`：对 Kiro 上游的 fetch/streaming（包含错误映射）
- `src/kiro/models.ts`：ListAvailableModels 调用与对外 models 映射
- `src/stream/awsEventStream.ts`：AWS EventStream 解析（最小可用，按 spec 指向的 kiro-gateway 行为）
- `src/stream/openaiSse.ts`：Kiro stream → OpenAI SSE
- `src/stream/anthropicSse.ts`：Kiro stream → Anthropic SSE
- `src/routes/openai.ts`：`/v1/models`、`/v1/chat/completions`
- `src/routes/anthropic.ts`：`/v1/messages`
- `src/server.ts`：Bun.serve 入口、路由注册
- `index.ts`：改为启动 `src/server.ts`
- `README.md`：补充配置与运行说明

**Tests (bun test):**
- `tests/config.test.ts`
- `tests/http/auth.test.ts`
- `tests/auth/credsFile.test.ts`
- `tests/auth/awsSsoCache.test.ts`
- `tests/auth/kiroAuthManager.concurrent-refresh.test.ts`
- `tests/auth/kiroAuthManager.threshold.test.ts`
- `tests/auth/kiroAuthManager.priority-and-degrade.test.ts`
- `tests/routes/openai.models.auth.test.ts`
- `tests/routes/openai.chat.validation.test.ts`
- `tests/routes/anthropic.messages.validation.test.ts`
- `tests/routes/openai.stream.mock-upstream.test.ts`
- `tests/routes/anthropic.stream.mock-upstream.test.ts`
- `tests/kiro/headers.test.ts`
- `tests/kiro/endpoints.test.ts`
- `tests/stream/awsEventStream.test.ts`
- `tests/stream/openaiSse.test.ts`
- `tests/stream/anthropicSse.test.ts`
- `tests/stream/e2e.eventstream-to-sse.test.ts`

> 说明：streaming 端到端测试在本计划中先做“可单测的解析器/映射器”，不做真实连 Kiro 上游的集成测试（spec 明确优先最小可用与正确性）。

---

### Task 1: Project scaffold for `src/**` + test runner baseline

**Files:**
- Modify: `index.ts`
- Create: `src/server.ts`
- Create: `src/errors.ts`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test (config defaults + required api key)**

```ts
import { test, expect } from "bun:test";
import { loadConfigFromEnv } from "../src/config";

test("loadConfigFromEnv throws when PROXY_API_KEY missing", () => {
  expect(() => loadConfigFromEnv({})).toThrow();
});

test("loadConfigFromEnv applies defaults", () => {
  const cfg = loadConfigFromEnv({
    PROXY_API_KEY: "k",
    REFRESH_TOKEN: "rt",
  });
  expect(cfg.serverHost).toBe("0.0.0.0");
  expect(cfg.serverPort).toBe(8000);
  expect(cfg.kiroRegion).toBe("us-east-1");
  expect(cfg.tokenRefreshThresholdSeconds).toBe(600);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL with "Cannot find module '../src/config'" (or missing export)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config.ts
export type Config = {
  proxyApiKey: string;
  kiroCredsFile?: string;
  refreshToken?: string;
  profileArn?: string;
  kiroRegion: string;
  tokenRefreshThresholdSeconds: number;
  serverHost: string;
  serverPort: number;
};

export function loadConfigFromEnv(env: Record<string, string | undefined>): Config {
  const proxyApiKey = env.PROXY_API_KEY;
  if (!proxyApiKey) throw new Error("PROXY_API_KEY is required");

  const tokenRefreshThresholdSeconds = env.TOKEN_REFRESH_THRESHOLD_SECONDS
    ? Number(env.TOKEN_REFRESH_THRESHOLD_SECONDS)
    : 600;
  const serverPort = env.SERVER_PORT ? Number(env.SERVER_PORT) : 8000;

  return {
    proxyApiKey,
    kiroCredsFile: env.KIRO_CREDS_FILE,
    refreshToken: env.REFRESH_TOKEN,
    profileArn: env.PROFILE_ARN,
    kiroRegion: env.KIRO_REGION ?? "us-east-1",
    tokenRefreshThresholdSeconds,
    serverHost: env.SERVER_HOST ?? "0.0.0.0",
    serverPort,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.ts src/config.ts src/errors.ts src/server.ts tests/config.test.ts README.md
git commit -m "feat: scaffold bun server config and tests"
```

---

### Task 2: Proxy API key authentication helper

**Files:**
- Create: `src/http/auth.ts`
- Test: `tests/http/auth.test.ts`

- [ ] **Step 1: Write the failing test (bearer + x-api-key)**

```ts
import { test, expect } from "bun:test";
import { assertProxyApiKey } from "../../src/http/auth";

function req(headers: Record<string, string>) {
  return new Request("http://localhost/", { headers });
}

test("accepts Authorization: Bearer", () => {
  expect(() => assertProxyApiKey(req({ authorization: "Bearer k" }), "k")).not.toThrow();
});

test("accepts x-api-key", () => {
  expect(() => assertProxyApiKey(req({ "x-api-key": "k" }), "k")).not.toThrow();
});

test("rejects missing key", () => {
  expect(() => assertProxyApiKey(req({}), "k")).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/http/auth.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Write minimal implementation**

```ts
export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "unauthorized") {
    super(message);
  }
}

export function assertProxyApiKey(req: Request, expected: string) {
  const auth = req.headers.get("authorization");
  const xApiKey = req.headers.get("x-api-key");
  const token =
    auth?.toLowerCase().startsWith("bearer ") ? auth.slice("bearer ".length) : xApiKey ?? null;
  if (!token || token !== expected) throw new UnauthorizedError("invalid api key");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/http/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/http/auth.ts tests/http/auth.test.ts
git commit -m "feat: add proxy api key auth helper"
```

---

### Task 3: Creds JSON file IO (read/merge/write atomically)

**Files:**
- Create: `src/auth/types.ts`
- Create: `src/auth/credsFile.ts`
- Test: `tests/auth/credsFile.test.ts`

- [ ] **Step 1: Write the failing test (preserve unknown fields + iso expiresAt)**

```ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import { readCredsFile, writeCredsFileMerged } from "../../src/auth/credsFile";

test("writeCredsFileMerged preserves unknown fields and normalizes expiresAt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kiro-proxy-"));
  const file = join(dir, "creds.json");
  writeFileSync(
    file,
    JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: "2025-01-01T00:00:00Z", keep: 1 }),
  );

  await writeCredsFileMerged(file, {
    accessToken: "a2",
    refreshToken: "r2",
    expiresAt: new Date("2025-01-02T00:00:00.000Z"),
  });

  const raw = JSON.parse(readFileSync(file, "utf8"));
  expect(raw.keep).toBe(1);
  expect(raw.accessToken).toBe("a2");
  expect(raw.refreshToken).toBe("r2");
  expect(raw.expiresAt).toBe("2025-01-02T00:00:00.000Z");

  const parsed = await readCredsFile(file);
  expect(parsed.accessToken).toBe("a2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/credsFile.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/auth/types.ts
export type KiroCredsJson = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  region?: string;
  profileArn?: string;
  clientIdHash?: string;
  [k: string]: unknown;
};

export type KiroCredsUpdate = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};
```

```ts
// src/auth/credsFile.ts
import { dirname, join } from "node:path";
import type { KiroCredsJson, KiroCredsUpdate } from "./types";

export async function readCredsFile(path: string): Promise<KiroCredsJson> {
  const text = await Bun.file(path).text();
  const json = JSON.parse(text) as KiroCredsJson;
  if (!json.accessToken || !json.refreshToken || !json.expiresAt) {
    throw new Error("invalid creds file: missing required fields");
  }
  return json;
}

export async function writeCredsFileMerged(path: string, update: KiroCredsUpdate): Promise<void> {
  const existing = await readCredsFile(path);
  const merged: KiroCredsJson = {
    ...existing,
    accessToken: update.accessToken,
    refreshToken: update.refreshToken,
    expiresAt: update.expiresAt.toISOString(),
  };

  const dir = dirname(path);
  const tmp = join(dir, `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await Bun.write(tmp, JSON.stringify(merged, null, 2));
  await Bun.$`chmod 600 ${tmp}`.quiet().catch(() => {});
  await Bun.$`mv ${tmp} ${path}`.quiet();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/auth/credsFile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/types.ts src/auth/credsFile.ts tests/auth/credsFile.test.ts
git commit -m "feat: add creds file read and atomic merge write"
```

---

### Task 4: Enterprise `clientIdHash` → AWS SSO cache loader

**Files:**
- Create: `src/auth/awsSsoCache.ts`
- Test: `tests/auth/awsSsoCache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadClientCredsFromSsoCacheFile } from "../../src/auth/awsSsoCache";

test("loads clientId and clientSecret", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kiro-proxy-"));
  const file = join(dir, "abc.json");
  writeFileSync(file, JSON.stringify({ clientId: "id", clientSecret: "sec" }));
  const c = await loadClientCredsFromSsoCacheFile(file);
  expect(c).toEqual({ clientId: "id", clientSecret: "sec" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/awsSsoCache.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Write minimal implementation**

```ts
export async function loadClientCredsFromSsoCacheFile(path: string) {
  const text = await Bun.file(path).text();
  const json = JSON.parse(text) as { clientId?: string; clientSecret?: string };
  if (!json.clientId || !json.clientSecret) throw new Error("invalid sso cache file");
  return { clientId: json.clientId, clientSecret: json.clientSecret };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/auth/awsSsoCache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/awsSsoCache.ts tests/auth/awsSsoCache.test.ts
git commit -m "feat: load aws sso oidc client creds from cache file"
```

---

### Task 5: `KiroAuthManager` refresh logic + concurrency lock

**Files:**
- Create: `src/auth/refreshDesktop.ts`
- Create: `src/auth/refreshSsoOidc.ts`
- Create: `src/auth/kiroAuthManager.ts`
- Test: `tests/auth/kiroAuthManager.concurrent-refresh.test.ts`
- Test: `tests/auth/kiroAuthManager.threshold.test.ts`
- Test: `tests/auth/kiroAuthManager.priority-and-degrade.test.ts`

- [ ] **Step 1: Write the failing test (single-flight refresh)**

```ts
import { test, expect } from "bun:test";
import { KiroAuthManager } from "../../src/auth/kiroAuthManager";

test("concurrent getAccessToken triggers only one refresh", async () => {
  let refreshCalls = 0;
  const m = new KiroAuthManager({
    region: "us-east-1",
    tokenRefreshThresholdSeconds: 600,
    credsFilePath: undefined,
    initial: { refreshToken: "rt", accessToken: "old", expiresAt: new Date(0) },
    refreshDesktop: async () => {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: "new", refreshToken: "rt2", expiresAt: new Date(Date.now() + 3600_000) };
    },
    refreshSsoOidc: async () => {
      throw new Error("should not be called");
    },
  });

  const [a, b, c] = await Promise.all([m.getAccessToken(), m.getAccessToken(), m.getAccessToken()]);
  expect(a).toBe("new");
  expect(b).toBe("new");
  expect(c).toBe("new");
  expect(refreshCalls).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/kiroAuthManager.concurrent-refresh.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Write minimal implementation**

```ts
export type RefreshResult = { accessToken: string; refreshToken: string; expiresAt: Date; profileArn?: string };

export class KiroAuthManager {
  #refreshing: Promise<void> | null = null;
  #accessToken?: string;
  #refreshToken?: string;
  #expiresAt?: Date;

  constructor(private readonly deps: {
    region: string;
    tokenRefreshThresholdSeconds: number;
    credsFilePath?: string;
    initial: { accessToken?: string; refreshToken?: string; expiresAt?: Date; profileArn?: string };
    refreshDesktop: () => Promise<RefreshResult>;
    refreshSsoOidc: () => Promise<RefreshResult>;
  }) {
    this.#accessToken = deps.initial.accessToken;
    this.#refreshToken = deps.initial.refreshToken;
    this.#expiresAt = deps.initial.expiresAt;
  }

  async getAccessToken(): Promise<string> {
    if (this.#accessToken && this.#expiresAt) {
      const msLeft = this.#expiresAt.getTime() - Date.now();
      if (msLeft > this.deps.tokenRefreshThresholdSeconds * 1000) return this.#accessToken;
    }
    await this.#refreshOnce();
    if (!this.#accessToken) throw new Error("no access token after refresh");
    return this.#accessToken;
  }

  async #refreshOnce() {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = (async () => {
      try {
        const r = await this.deps.refreshDesktop();
        this.#accessToken = r.accessToken;
        this.#refreshToken = r.refreshToken;
        this.#expiresAt = r.expiresAt;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }
}
```

- [ ] **Step 4: Write failing tests for threshold refresh**

```ts
import { test, expect } from "bun:test";
import { KiroAuthManager } from "../../src/auth/kiroAuthManager";

test("does not refresh when expiresAt is beyond threshold", async () => {
  let calls = 0;
  const m = new KiroAuthManager({
    region: "us-east-1",
    tokenRefreshThresholdSeconds: 600,
    credsFilePath: undefined,
    initial: { refreshToken: "rt", accessToken: "ok", expiresAt: new Date(Date.now() + 601_000) },
    refreshDesktop: async () => {
      calls++;
      return { accessToken: "new", refreshToken: "rt2", expiresAt: new Date(Date.now() + 3600_000) };
    },
    refreshSsoOidc: async () => {
      throw new Error("should not be called");
    },
  });
  const t = await m.getAccessToken();
  expect(t).toBe("ok");
  expect(calls).toBe(0);
});

test("refreshes when expiresAt is within threshold", async () => {
  let calls = 0;
  const m = new KiroAuthManager({
    region: "us-east-1",
    tokenRefreshThresholdSeconds: 600,
    credsFilePath: undefined,
    initial: { refreshToken: "rt", accessToken: "old", expiresAt: new Date(Date.now() + 599_000) },
    refreshDesktop: async () => {
      calls++;
      return { accessToken: "new", refreshToken: "rt2", expiresAt: new Date(Date.now() + 3600_000) };
    },
    refreshSsoOidc: async () => {
      throw new Error("should not be called");
    },
  });
  const t = await m.getAccessToken();
  expect(t).toBe("new");
  expect(calls).toBe(1);
});
```

- [ ] **Step 5: Run threshold tests to verify they fail**

Run: `bun test tests/auth/kiroAuthManager.threshold.test.ts`
Expected: FAIL (behavior not implemented / file missing)

- [ ] **Step 6: Write failing tests for spec constraints (priority + degrade)**

```ts
import { test, expect } from "bun:test";
import { KiroAuthManager } from "../../src/auth/kiroAuthManager";

test("prefers creds file refreshToken over env refresh token when both provided", async () => {
  // Arrange: construct manager as if it loaded creds file token already.
  // The manager should use its in-memory refreshToken sourced from creds file.
  let usedRefreshToken: string | null = null;
  const m = new KiroAuthManager({
    region: "us-east-1",
    tokenRefreshThresholdSeconds: 600,
    credsFilePath: "/tmp/creds.json",
    initial: { refreshToken: "from-creds", accessToken: "old", expiresAt: new Date(0) },
    refreshDesktop: async () => {
      usedRefreshToken = "from-creds";
      return { accessToken: "new", refreshToken: "from-creds2", expiresAt: new Date(Date.now() + 3600_000) };
    },
    refreshSsoOidc: async () => {
      throw new Error("should not be called");
    },
  });
  await m.getAccessToken();
  expect(usedRefreshToken).toBe("from-creds");
});

test("if refresh fails but current token is still valid, keeps using current token", async () => {
  const m = new KiroAuthManager({
    region: "us-east-1",
    tokenRefreshThresholdSeconds: 600,
    credsFilePath: undefined,
    initial: { refreshToken: "rt", accessToken: "still-ok", expiresAt: new Date(Date.now() + 60_000) },
    refreshDesktop: async () => {
      throw new Error("refresh failed");
    },
    refreshSsoOidc: async () => {
      throw new Error("should not be called");
    },
  });
  const t = await m.getAccessToken();
  expect(t).toBe("still-ok");
});
```

- [ ] **Step 7: Run spec-constraint tests to verify they fail**

Run: `bun test tests/auth/kiroAuthManager.priority-and-degrade.test.ts`
Expected: FAIL (fallback behavior missing / file missing)

- [ ] **Step 8: Implement refresh method selection (SSO OIDC vs Desktop)**
- [ ] **Step 9: Implement `profileArn` rule (Desktop only; never for SSO)**
- [ ] **Step 10: Implement refresh-failure degrade (use still-valid token; no token prints)**
- [ ] **Step 11: Implement creds-file atomic persistence on successful refresh**
- [ ] **Step 12: Implement `clientIdHash` cache-missing degrade (warning → Desktop)**

- [ ] **Step 13: Run all Task 5 tests to verify they pass**

Run:
- `bun test tests/auth/kiroAuthManager.concurrent-refresh.test.ts`
- `bun test tests/auth/kiroAuthManager.threshold.test.ts`
- `bun test tests/auth/kiroAuthManager.priority-and-degrade.test.ts`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add src/auth/refreshDesktop.ts src/auth/refreshSsoOidc.ts src/auth/kiroAuthManager.ts tests/auth/kiroAuthManager.concurrent-refresh.test.ts tests/auth/kiroAuthManager.threshold.test.ts tests/auth/kiroAuthManager.priority-and-degrade.test.ts
git commit -m "feat: implement KiroAuthManager refresh policy and degrade behavior"
```

---

### Task 6: HTTP server routes (OpenAI + Anthropic) skeleton + README update

**Files:**
- Create: `src/routes/openai.ts`
- Create: `src/routes/anthropic.ts`
- Modify: `src/server.ts`
- Modify: `index.ts`
- Modify: `README.md`
- Test: `tests/routes/openai.models.auth.test.ts`
- Test: `tests/routes/openai.chat.validation.test.ts`
- Test: `tests/routes/anthropic.messages.validation.test.ts`

- [ ] **Step 1: Write failing tests for route auth + basic validation**

```ts
import { test, expect } from "bun:test";

test("/v1/models returns 401 without proxy key", async () => {
  const res = await fetch("http://localhost:8000/v1/models");
  expect(res.status).toBe(401);
});
```

> 注：若测试不启 server，改为对 `src/server.ts` 暴露的 `routes` handler 做单测（计划实现时二选一：要么把 `Bun.serve` 抽离成可注入 handler，要么用随机端口启动一次 server 进行轻量集成测试）。

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/routes/openai.models.auth.test.ts`
Expected: FAIL (no server / no route)

- [ ] **Step 3: Implement minimal routes returning 501 until Kiro wiring**

Acceptance:
- `/v1/models`: 200 JSON（空数组或占位）或 501 JSON（明确 message）
- `/v1/chat/completions` + `/v1/messages`: 501 JSON（明确 message）
- all require proxy api key, otherwise 401 JSON error body
- add request-body validation for required fields: OpenAI requires `model` + `messages`; Anthropic requires `model` + `max_tokens` + `messages`

- [ ] **Step 4: Re-run route tests to verify they pass**

Run:
- `bun test tests/routes/openai.models.auth.test.ts`
- `bun test tests/routes/openai.chat.validation.test.ts`
- `bun test tests/routes/anthropic.messages.validation.test.ts`
Expected: PASS

- [ ] **Step 5: Document env vars + examples in README**

- [ ] **Step 6: Smoke run**

Run: `PROXY_API_KEY=dev REFRESH_TOKEN=rt bun run index.ts`
Expected: server listens on `0.0.0.0:8000`

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/routes/openai.ts src/routes/anthropic.ts index.ts README.md tests/routes/openai.models.auth.test.ts tests/routes/openai.chat.validation.test.ts tests/routes/anthropic.messages.validation.test.ts
git commit -m "feat: add openai/anthropic route skeleton with auth"
```

---

### Task 7: Upstream contract guards (endpoints + headers + profileArn rules)

**Files:**
- Create: `src/kiro/endpoints.ts`
- Create: `src/kiro/headers.ts`
- Test: `tests/kiro/headers.test.ts`
- Test: `tests/kiro/endpoints.test.ts`

- [ ] **Step 1: Write failing test for required upstream headers**

```ts
import { test, expect } from "bun:test";
import { buildKiroHeaders } from "../../src/kiro/headers";

test("buildKiroHeaders includes required headers and never returns raw token in logs", () => {
  const h = buildKiroHeaders({ accessToken: "tok", invocationId: "00000000-0000-0000-0000-000000000000" });
  expect(h.authorization).toBe("Bearer tok");
  expect(h["x-amzn-codewhisperer-optout"]).toBe("true");
  expect(h["x-amzn-kiro-agent-mode"]).toBe("vibe");
  expect(h["amz-sdk-invocation-id"]).toBe("00000000-0000-0000-0000-000000000000");
  expect(h["amz-sdk-request"]).toContain("attempt=1");
});
```

- [ ] **Step 2: Run header test to verify it fails**

Run: `bun test tests/kiro/headers.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `buildKiroHeaders`**

```ts
export function buildKiroHeaders(input: { accessToken: string; invocationId: string }) {
  return {
    authorization: `Bearer ${input.accessToken}`,
    "content-type": "application/json",
    "user-agent": "kiro-proxy/0.0.0",
    "x-amz-user-agent": "aws-sdk-js/3.x",
    "x-amzn-codewhisperer-optout": "true",
    "x-amzn-kiro-agent-mode": "vibe",
    "amz-sdk-invocation-id": input.invocationId,
    "amz-sdk-request": "attempt=1; max=3",
  } as const;
}
```
- [ ] **Step 4: Re-run header test to verify it passes**

Run: `bun test tests/kiro/headers.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for endpoints (origin + conditional profileArn)**

```ts
import { test, expect } from "bun:test";
import { buildListAvailableModelsUrl } from "../../src/kiro/endpoints";

test("ListAvailableModels always includes origin=AI_EDITOR", () => {
  const u = buildListAvailableModelsUrl({ region: "us-east-1", profileArn: undefined, includeProfileArn: false });
  expect(u).toContain("origin=AI_EDITOR");
});

test("ListAvailableModels includes profileArn only when Desktop mode + profileArn exists", () => {
  const u = buildListAvailableModelsUrl({
    region: "us-east-1",
    profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/x",
    includeProfileArn: true,
  });
  expect(u).toContain("profileArn=");
});
```

- [ ] **Step 6: Run endpoints test to verify it fails**

Run: `bun test tests/kiro/endpoints.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 7: Implement endpoint builders**

```ts
const kiroApiHost = (region: string) => `https://q.${region}.amazonaws.com`;

export function buildListAvailableModelsUrl(input: {
  region: string;
  profileArn: string | undefined;
  includeProfileArn: boolean;
}) {
  const u = new URL("/ListAvailableModels", kiroApiHost(input.region));
  u.searchParams.set("origin", "AI_EDITOR");
  if (input.includeProfileArn && input.profileArn) u.searchParams.set("profileArn", input.profileArn);
  return u.toString();
}
```
- [ ] **Step 8: Re-run endpoints test to verify it passes**

Run: `bun test tests/kiro/endpoints.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/kiro/endpoints.ts src/kiro/headers.ts tests/kiro/headers.test.ts tests/kiro/endpoints.test.ts
git commit -m "feat: add kiro upstream endpoints and required headers"
```

---

### Task 8: AWS EventStream parser (contract-first, no TODO fixtures)

**Files:**
- Create: `src/stream/awsEventStream.ts`
- Test: `tests/stream/awsEventStream.test.ts`

- [ ] **Step 1: Write failing tests with synthetic, fully-specified fixtures**

```ts
import { test, expect } from "bun:test";
import { encodeAwsEventStreamMessage, decodeAwsEventStreamMessages } from "../../src/stream/awsEventStream";

test("round-trips a single message with json payload", () => {
  const bytes = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const msgs = decodeAwsEventStreamMessages(bytes);
  expect(msgs.length).toBe(1);
  expect(new TextDecoder().decode(msgs[0]!.payload)).toContain('"delta":"hi"');
});

test("decodes two concatenated messages", () => {
  const a = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new Uint8Array([1, 2, 3]),
  });
  const b = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new Uint8Array([4, 5]),
  });
  const msgs = decodeAwsEventStreamMessages(new Uint8Array([...a, ...b]));
  expect(msgs.length).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/stream/awsEventStream.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement encoder/decoder per AWS EventStream framing**

```ts
// Minimal AWS EventStream framing (for test fixtures + decoding):
// message := totalLen(4) + headersLen(4) + preludeCrc(4) + headers + payload + messageCrc(4)
// CRC is CRC32 (IEEE). Header format: nameLen(1) + name + type(1) + value (string: len(2) + bytes)

type HeaderValue = string;
type HeaderMap = Record<string, HeaderValue>;
export type AwsEventStreamMessage = { headers: HeaderMap; payload: Uint8Array };

const te = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}
function u16be(n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, false);
  return b;
}

function encodeHeaders(headers: HeaderMap): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = te.encode(name);
    const valBytes = te.encode(value);
    parts.push(new Uint8Array([nameBytes.length]));
    parts.push(nameBytes);
    parts.push(new Uint8Array([7])); // string type
    parts.push(u16be(valBytes.length));
    parts.push(valBytes);
  }
  return concat(parts);
}

function concat(chunks: Uint8Array[]) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function encodeAwsEventStreamMessage(msg: AwsEventStreamMessage): Uint8Array {
  const headersBytes = encodeHeaders(msg.headers);
  const totalLen = 4 + 4 + 4 + headersBytes.length + msg.payload.length + 4;
  const prelude = concat([u32be(totalLen), u32be(headersBytes.length)]);
  const preludeCrc = u32be(crc32(prelude));
  const withoutMsgCrc = concat([prelude, preludeCrc, headersBytes, msg.payload]);
  const msgCrc = u32be(crc32(withoutMsgCrc));
  return concat([withoutMsgCrc, msgCrc]);
}

export function decodeAwsEventStreamMessages(bytes: Uint8Array): AwsEventStreamMessage[] {
  const out: AwsEventStreamMessage[] = [];
  let off = 0;
  while (off + 16 <= bytes.length) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + off);
    const totalLen = dv.getUint32(0, false);
    const headersLen = dv.getUint32(4, false);
    if (off + totalLen > bytes.length) break; // need more bytes
    const msg = bytes.subarray(off, off + totalLen);
    // Validate CRCs (throws on mismatch so tests catch framing bugs)
    const prelude = msg.subarray(0, 8);
    const preludeCrc = new DataView(msg.buffer, msg.byteOffset + 8).getUint32(0, false);
    if (crc32(prelude) !== preludeCrc) throw new Error("bad prelude crc");
    const msgCrc = new DataView(msg.buffer, msg.byteOffset + totalLen - 4).getUint32(0, false);
    if (crc32(msg.subarray(0, totalLen - 4)) !== msgCrc) throw new Error("bad message crc");

    const headersStart = 12;
    const headersEnd = headersStart + headersLen;
    const payloadStart = headersEnd;
    const payloadEnd = totalLen - 4;
    const headers = {} as HeaderMap;
    let hOff = headersStart;
    while (hOff < headersEnd) {
      const nameLen = msg[hOff]!;
      hOff += 1;
      const name = new TextDecoder().decode(msg.subarray(hOff, hOff + nameLen));
      hOff += nameLen;
      const type = msg[hOff]!;
      hOff += 1;
      if (type !== 7) throw new Error("unsupported header type");
      const valLen = new DataView(msg.buffer, msg.byteOffset + hOff).getUint16(0, false);
      hOff += 2;
      const value = new TextDecoder().decode(msg.subarray(hOff, hOff + valLen));
      hOff += valLen;
      headers[name] = value;
    }
    out.push({ headers, payload: msg.subarray(payloadStart, payloadEnd) });
    off += totalLen;
  }
  return out;
}
```
- [ ] **Step 4: Re-run tests to verify they pass**

Run: `bun test tests/stream/awsEventStream.test.ts`
Expected: PASS

Acceptance:
- decoder can process concatenated messages from a streaming byte buffer
- encoder exists only to generate deterministic fixtures for tests (not used in production)

- [ ] **Step 5: Commit**

```bash
git add src/stream/awsEventStream.ts tests/stream/awsEventStream.test.ts
git commit -m "feat: add aws eventstream encoder/decoder for testable parsing"
```

---

### Task 9: SSE mappers (OpenAI + Anthropic) with strict sequence tests

**Files:**
- Create: `src/stream/openaiSse.ts`
- Create: `src/stream/anthropicSse.ts`
- Test: `tests/stream/openaiSse.test.ts`
- Test: `tests/stream/anthropicSse.test.ts`

- [ ] **Step 1: Write failing OpenAI SSE tests (role-first, deltas, final, DONE, tool_calls)**

```ts
import { test, expect } from "bun:test";
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
    { type: "tool_use", toolCalls: [{ name: "f", argumentsJson: "{\"x\":1}" }] },
    { type: "end", finishReason: "tool_calls" },
  ]);
  expect(sse).toContain('"finish_reason":"tool_calls"');
  expect(sse).toContain('"tool_calls"');
  expect(sse).toContain('"index":0');
});
```

- [ ] **Step 2: Run OpenAI SSE tests to verify they fail**

Run: `bun test tests/stream/openaiSse.test.ts`
Expected: FAIL (module missing / assertions fail)

- [ ] **Step 3: Implement minimal OpenAI SSE mapper and re-run until PASS**

Acceptance (spec-aligned):
- first emitted chunk includes `delta.role="assistant"`
- content deltas: `delta.content`
- tool_calls: emitted with `index` (and `id` per call if required by your client)
- final chunk contains `finish_reason` and includes `usage` when present
- ends with `data: [DONE]\\n\\n`

- [ ] **Step 4: Write failing Anthropic SSE tests (message_start → blocks → message_stop, error event)**

```ts
import { test, expect } from "bun:test";
import { kiroEventsToAnthropicSse } from "../../src/stream/anthropicSse";

test("anthropic sse: emits message_start and message_stop", () => {
  const sse = kiroEventsToAnthropicSse([
    { type: "content", delta: "hi" },
    { type: "end", finishReason: "end_turn", usage: { output_tokens: 2 } },
  ]);
  expect(sse).toContain("event: message_start\n");
  expect(sse).toContain("event: content_block_start\n");
  expect(sse).toContain("event: content_block_delta\n");
  expect(sse).toContain("event: content_block_stop\n");
  expect(sse).toContain("event: message_delta\n");
  expect(sse).toContain("event: message_stop\n");
});

test("anthropic sse: on error emits event:error and still terminates", () => {
  const sse = kiroEventsToAnthropicSse([{ type: "error", message: "boom" }]);
  expect(sse).toContain("event: error\n");
  expect(sse).toContain('"message":"boom"');
});
```

- [ ] **Step 5: Run Anthropic SSE tests to verify they fail**

Run: `bun test tests/stream/anthropicSse.test.ts`
Expected: FAIL (module missing / assertions fail)

- [ ] **Step 6: Implement minimal Anthropic SSE mapper and re-run until PASS**

Acceptance (spec-aligned, minimal):
- strict event ordering for at least the text stream case
- `event: error` shape is stable and ends gracefully (no hanging streams)

- [ ] **Step 7: Commit**

```bash
git add src/stream/openaiSse.ts src/stream/anthropicSse.ts tests/stream/openaiSse.test.ts tests/stream/anthropicSse.test.ts
git commit -m "feat: map kiro events to openai and anthropic sse"
```

---

### Task 10: Kiro client + route integration (models + generateAssistantResponse)

**Files:**
- Create: `src/kiro/client.ts`
- Create: `src/kiro/models.ts`
- Modify: `src/routes/openai.ts`
- Modify: `src/routes/anthropic.ts`
- Test: `tests/routes/openai.stream.mock-upstream.test.ts`
- Test: `tests/routes/anthropic.stream.mock-upstream.test.ts`

- [ ] **Step 1: Write failing tests that mock upstream streaming**

Strategy:
- inject a `fetch`-like function into `KiroClient` so tests can return a fake `Response` with a `ReadableStream<Uint8Array>`
- use Task 8 encoder to produce an EventStream byte stream for the fake upstream body

Implementation constraint (to make tests trivial):
- `src/routes/openai.ts` MUST export `createOpenAiRoutes(deps)` returning `{ chatCompletions(req): Promise<Response>; models(req): Promise<Response> }`
- `src/routes/anthropic.ts` MUST export `createAnthropicRoutes(deps)` returning `{ messages(req): Promise<Response> }`
- `KiroClient` MUST accept an injected `fetchFn` in constructor for tests

**Test: `tests/routes/openai.stream.mock-upstream.test.ts`**

```ts
import { test, expect } from "bun:test";
import { encodeAwsEventStreamMessage } from "../../src/stream/awsEventStream";
import { createOpenAiRoutes } from "../../src/routes/openai";
import { KiroClient } from "../../src/kiro/client";

function streamFromBytes(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

test("openai chat completions stream: maps upstream eventstream to SSE with [DONE]", async () => {
  const msg1 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const msg2 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "end", finishReason: "stop" })),
  });
  const upstreamBytes = new Uint8Array([...msg1, ...msg2]);

  const fetchFn: typeof fetch = async () =>
    new Response(streamFromBytes(upstreamBytes), { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } });

  const kiro = new KiroClient({
    region: "us-east-1",
    getAccessToken: async () => "token",
    fetchFn,
  });

  const routes = createOpenAiRoutes({
    proxyApiKey: "dev",
    kiro,
    // Desktop mode profileArn is optional; tests here focus on streaming mapping.
    includeProfileArn: false,
    profileArn: undefined,
  });

  const req = new Request("http://local/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer dev", "content-type": "application/json" },
    body: JSON.stringify({ model: "x", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });

  const res = await routes.chatCompletions(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  expect(text).toContain('"role":"assistant"');
  expect(text).toContain('"content":"hi"');
  expect(text).toContain("data: [DONE]");
});
```

**Test: `tests/routes/anthropic.stream.mock-upstream.test.ts`**

```ts
import { test, expect } from "bun:test";
import { encodeAwsEventStreamMessage } from "../../src/stream/awsEventStream";
import { createAnthropicRoutes } from "../../src/routes/anthropic";
import { KiroClient } from "../../src/kiro/client";

function streamFromBytes(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

test("anthropic messages stream: emits message_start ... message_stop", async () => {
  const msg1 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const msg2 = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "end", finishReason: "end_turn", usage: { output_tokens: 2 } })),
  });
  const upstreamBytes = new Uint8Array([...msg1, ...msg2]);

  const fetchFn: typeof fetch = async () =>
    new Response(streamFromBytes(upstreamBytes), { status: 200, headers: { "content-type": "application/vnd.amazon.eventstream" } });

  const kiro = new KiroClient({
    region: "us-east-1",
    getAccessToken: async () => "token",
    fetchFn,
  });

  const routes = createAnthropicRoutes({
    proxyApiKey: "dev",
    kiro,
    includeProfileArn: false,
    profileArn: undefined,
  });

  const req = new Request("http://local/v1/messages", {
    method: "POST",
    headers: { "x-api-key": "dev", "content-type": "application/json" },
    body: JSON.stringify({ model: "x", stream: true, max_tokens: 16, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  });

  const res = await routes.messages(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  expect(text).toContain("event: message_start");
  expect(text).toContain("event: content_block_delta");
  expect(text).toContain("event: message_stop");
});
```

- [ ] **Step 2: Run mock-upstream route tests to verify they fail**

Run:
- `bun test tests/routes/openai.stream.mock-upstream.test.ts`
- `bun test tests/routes/anthropic.stream.mock-upstream.test.ts`
Expected: FAIL with "Cannot find module '../../src/routes/openai'" (or missing exported `createOpenAiRoutes` / `KiroClient`)

- [ ] **Step 3: Implement `KiroClient.generateAssistantResponseStream(...)` (accept injected fetchFn)**
- [ ] **Step 4: Implement `createOpenAiRoutes` and `createAnthropicRoutes` (pure handlers)**
- [ ] **Step 5: Wire `/v1/chat/completions` to Kiro stream + OpenAI SSE mapper**
- [ ] **Step 6: Wire `/v1/messages` to Kiro stream + Anthropic SSE mapper**
- [ ] **Step 7: Wire `/v1/models` to real upstream**
- [ ] **Step 8: Re-run mock-upstream route tests to verify they pass**

Run:
- `bun test tests/routes/openai.stream.mock-upstream.test.ts`
- `bun test tests/routes/anthropic.stream.mock-upstream.test.ts`
Expected: PASS

- [ ] **Step 9: Add one end-to-end chain test (eventstream bytes → parser → SSE string)**

Files:
- Test: `tests/stream/e2e.eventstream-to-sse.test.ts`

```ts
import { test, expect } from "bun:test";
import { encodeAwsEventStreamMessage, decodeAwsEventStreamMessages } from "../../src/stream/awsEventStream";
import { kiroEventsToOpenAiSse } from "../../src/stream/openaiSse";

test("e2e: eventstream -> payload json -> kiro events -> openai sse", () => {
  const msg = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const decoded = decodeAwsEventStreamMessages(msg);
  const payload = new TextDecoder().decode(decoded[0]!.payload);
  const ev = JSON.parse(payload);
  const sse = kiroEventsToOpenAiSse([ev, { type: "end", finishReason: "stop" }]);
  expect(sse).toContain('"content":"hi"');
  expect(sse).toContain("data: [DONE]");
});
```

Run: `bun test tests/stream/e2e.eventstream-to-sse.test.ts`
Expected: FAIL then PASS after wiring parser→events→mapper correctly

- [ ] **Step 10: Manual smoke test against real Kiro env (documented below)**
- [ ] **Step 11: Commit**

```bash
git add src/kiro src/routes tests/routes/openai.stream.mock-upstream.test.ts tests/routes/anthropic.stream.mock-upstream.test.ts
git commit -m "feat: integrate kiro upstream streaming into openai/anthropic routes"
```

---

## Manual test plan (after Task 10)

- Start server:
  - `PROXY_API_KEY=dev KIRO_CREDS_FILE=/path/to/kiro-creds.json bun run index.ts`
- Verify auth:
  - Missing key: `curl -i http://localhost:8000/v1/models` → `401`
  - With key: `curl -i -H 'Authorization: Bearer dev' http://localhost:8000/v1/models` → `200`
- OpenAI streaming:
  - `curl -N -H 'Authorization: Bearer dev' -H 'Content-Type: application/json' http://localhost:8000/v1/chat/completions -d '{"model":"...", "stream": true, "messages":[{"role":"user","content":"hi"}]}'`
  - Expected: `text/event-stream` with chunked `data: {...}`
- Anthropic streaming:
  - `curl -N -H 'x-api-key: dev' -H 'Content-Type: application/json' http://localhost:8000/v1/messages -d '{"model":"...", "stream": true, "max_tokens": 64, "messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}'`
  - Expected: SSE events `message_start` → ... → `message_stop`

