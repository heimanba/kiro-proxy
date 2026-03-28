# kiro-proxy Docs Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 刷新 `kiro-proxy` 的面向使用者文档：README 实现 5 分钟上手闭环（含 `curl -N` 流式验证），并新增 4 篇长期维护的 `docs/*.md`（鉴权与凭据、API 兼容、Streaming、开发者指南），内容严格对齐当前实现。

**Architecture:** README 只保留“快速开始 + 关键契约 + 最小验证 + 错误速查 + 文档索引”；深水区细节（凭据字段分层、上游非 2xx 透传、SSE 调试要点、开发与联调）下沉到 `docs/` 的小而专一文档。

**Tech Stack:** Bun（`bun run` / `bun test`），Markdown 文档（README + `docs/*.md`），与现有 TypeScript 实现保持一致（不改代码逻辑）。

---

## Spec

- Spec: `docs/superpowers/specs/2026-03-27-kiro-proxy-docs-refresh-design.md`

---

## File structure (locked in)

**Modify:**
- `README.md`

**Create:**
- `docs/auth-and-creds.md`
- `docs/api-compat.md`
- `docs/streaming.md`
- `docs/development.md`

---

## Verification strategy (evidence before claims)

- 文案一致性核对：对照以下真实实现点逐条确认文档措辞
  - 代理鉴权：`Authorization: Bearer <PROXY_API_KEY>` 或 `x-api-key: <PROXY_API_KEY>`（`src/http/auth.ts`）
  - 仅支持流式：OpenAI/Anthropic 路由 `stream !== true` → 501（`src/routes/openai.ts`、`src/routes/anthropic.ts`）
  - 未配置 creds：
    - OpenAI chat：`No Kiro credentials configured` → 503 OpenAI JSON（`src/routes/openai.ts` + `tests/routes/openai.chat.errors.test.ts`）
    - Anthropic messages：`No Kiro credentials configured` → 503 Anthropic JSON（`src/routes/anthropic.ts`）
  - 上游非 2xx：`KiroClient.streamOpenAiFromUpstream/streamAnthropicFromUpstream` 透传 `status + text`，不保证标准 JSON（`src/kiro/client.ts`）
  - `/v1/models`：无凭据或上游失败时降级返回 `200` + 空列表（`src/kiro/client.ts`）
  - `KIRO_ACCESS_TOKEN`：设置后绕过 creds file 与刷新阈值（`src/auth/kiroAccessToken.ts` + README 需更正）
  - `KIRO_CREDS_FILE` 字段分层：
    - 基础必需：`accessToken`/`refreshToken`/`expiresAt`
    - SSO OIDC 刷新（可选，同一文件额外字段）：`clientIdHash`/`region` + `~/.aws/sso/cache/{clientIdHash}.json`（`src/auth/refreshAwsSsoOidc.ts`）
- 跑一遍现有测试（不新增测试，仅作为“文案不误导”的护栏）：
  - `bun test`

---

### Task 1: Update README to “5-minute loop” (curl -N + key contracts)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README and list mismatches vs code**

Checklist to confirm (write down in notes before editing):
- README 是否已经包含 3 个最小 curl（models/openai stream/anthropic stream）
- 是否显式写了 `curl -N`
- 是否明确“上游非 2xx 透传 status+text（不保证标准 JSON）”
- 是否仍然写了“Desktop/SSO OIDC 刷新占位”（需要更正）

- [ ] **Step 2: Edit README structure to match spec**

Target README sections (in this order):
1) 简介
2) 快速开始（安装 + 启动：默认 `KIRO_CREDS_FILE`，备选 `KIRO_ACCESS_TOKEN`）
3) 关键契约（至少 5 条）
   - 代理鉴权 header 两种形式
   - 仅支持流式（非流式 501）
   - 未配置/无法读取凭据：流式 503
   - `KIRO_ACCESS_TOKEN` 优先且绕过刷新/阈值
   - 上游非 2xx：透传 `status + text`（不保证 OpenAI/Anthropic 标准错误 JSON；也不保证 content-type）
4) 端点概览
5) 最小 curl（必须包含 `-N`）
6) 配置（环境变量表：保留原表，补关键行为描述）
7) 错误码速查（表格：状态码→原因→怎么做）
8) 测试与真实联调（`bun test` + `smoke-live.sh`）
9) 文档索引（链接到 4 篇 docs）

- [ ] **Step 3: Write/update “快速开始” section (install + two start options)**

- [ ] **Step 4: Write/update “关键契约” section**

Hard requirement: include the “upstream non-2xx passthrough status+text” rule.

- [ ] **Step 5: Add minimal curl snippets (copy/paste-ready)**

Include these exact shapes:
- `GET /v1/models` (Authorization: Bearer)
- OpenAI stream:
  - `POST /v1/chat/completions`
  - JSON includes `{ "model": "...", "stream": true, "messages": [...] }`
  - use `curl -N`
- Anthropic stream:
  - `POST /v1/messages`
  - JSON includes `{ "model": "...", "stream": true, "max_tokens": 64, "messages": [...] }`
  - use `curl -N`

- [ ] **Step 6: Add error quick reference table**

Minimum rows:
- 401（代理 key 错/缺）
- 501（非流式不支持；给出如何改成 stream）
- 503（缺 creds / creds file 无效/找不到；指出 OpenAI/Anthropic 返回体不同）
- 403（上游 token 无效：透传 body 为 text；建议重新登录/更新 creds）
- 400（Invalid JSON / missing fields；以及 README 现有的 “Improperly formed request 可能打到旧进程”）

- [ ] **Step 7: Ensure README does not promise behavior we don’t implement**

Hard rules:
- 不声称“所有错误都返回 OpenAI/Anthropic 标准 JSON”
- `/v1/models` 的“降级为空列表”要写清（避免误判）

- [ ] **Step 8: Run tests**

Run: `bun test`
Expected: PASS（若已有失败，记录为“既有失败”，不在本任务范围内扩修）

- [ ] **Step 9: README acceptance checklist**

All must be true:
- README 不包含“刷新占位/placeholder”类表述
- README 含 3 段最小 curl，且都包含 `-N`
- README 明确写出：上游非 2xx 透传 `status + text`（不保证标准 JSON / 不保证 content-type）

---

### Task 2: Create `docs/auth-and-creds.md` (auth + creds layering)

**Files:**
- Create: `docs/auth-and-creds.md`

- [ ] **Step 1: Create file with title + 2-line overview**

- [ ] **Step 2: Write section “概览：代理鉴权 vs 上游凭据”**

- [ ] **Step 3: Write section “代理鉴权（PROXY_API_KEY）”**

- [ ] **Step 4: Write section “上游凭据优先级”**

Must include: 设置 `KIRO_ACCESS_TOKEN` 会绕过 creds file 读取/刷新/阈值逻辑。

- [ ] **Step 5: Write section “KIRO_CREDS_FILE JSON（字段分层）”**

Must be explicit:
- **基础必需（总是需要）**：`accessToken` / `refreshToken` / `expiresAt`
- **可选：启用 AWS SSO OIDC 刷新（同一文件额外字段）**：`clientIdHash` / `region`
  - 以及 `~/.aws/sso/cache/{clientIdHash}.json` 需要 `clientId` / `clientSecret`

- [ ] **Step 6: Write section “刷新与阈值（高层）”**

- [ ] **Step 7: Write section “安全注意事项”**

- [ ] **Step 8: Cross-check statements against code**

Sections:
- 概览：代理鉴权 vs 上游凭据
- 代理鉴权（`PROXY_API_KEY`）：两种 header、401 典型原因
- 上游凭据优先级：`KIRO_ACCESS_TOKEN` > `KIRO_CREDS_FILE`（并写清：设置 access token 会绕过文件读取/刷新/阈值）
- `KIRO_CREDS_FILE` JSON：
  - **基础必需（总是需要）**：`accessToken` / `refreshToken` / `expiresAt`
  - **可选：启用 AWS SSO OIDC 刷新（同一文件额外字段）**：`clientIdHash` / `region` + `~/.aws/sso/cache/{clientIdHash}.json` 的 `clientId` / `clientSecret`
  - `expiresAt` 格式示例（ISO UTC）
- 刷新与阈值：`TOKEN_REFRESH_THRESHOLD_SECONDS`（高层描述，不写实现细节）
- 安全注意事项：不提交凭据、权限建议

Confirm:
- creds file 的“必需字段”与 `src/auth/credsFile.ts` 一致
- SSO OIDC 的“额外字段”与 `src/auth/refreshAwsSsoOidc.ts` 一致

- [ ] **Step 9: Add 2 JSON examples**

Required examples:
- 基础（仅必需字段）
- 启用 SSO OIDC 刷新（同一文件额外字段：`clientIdHash` / `region`）

---

### Task 3: Create `docs/api-compat.md` (endpoint contract + error shapes)

**Files:**
- Create: `docs/api-compat.md`

- [ ] **Step 1: Create file with title + scope**

- [ ] **Step 2: Write “端点总览”**

- [ ] **Step 3: Write “鉴权” (link to `docs/auth-and-creds.md`)**

- [ ] **Step 4: Write “OpenAI 兼容”**

Must include `/v1/models` downgrade-to-empty behavior.

- [ ] **Step 5: Write “Anthropic 兼容”**

- [ ] **Step 6: Write “错误与返回体形状（顶层规则）”**

Hard requirement:
- **顶层规则**：上游非 2xx → 透传 `status + text`，不保证标准 JSON / 不保证 content-type
- Provide endpoint × status → body-shape matrix.

- [ ] **Step 7: Split matrix writing into 3 passes**

Pass A: write the top-level passthrough rule + 1-2 examples  
Pass B: document local-generated errors (401/400/501/503) and their JSON shapes  
Pass C: finalize the endpoint×status matrix table

Implementation notes (non-steps):
- 本文必须明确 `/v1/models`：无凭据或上游失败时降级空列表（200）。
- “错误与返回体形状”必须以矩阵表明确：Endpoint × Status → Body shape (OpenAI JSON / Anthropic JSON / plain text passthrough)。

---

### Task 4: Create `docs/streaming.md` (SSE debugging)

**Files:**
- Create: `docs/streaming.md`

- [ ] **Step 1: Create file with title + scope**

- [ ] **Step 2: Write “为什么只支持流式”**

- [ ] **Step 3: Write “OpenAI SSE 调试（curl -N + [DONE]）”**

- [ ] **Step 4: Write “Anthropic SSE 事件概览（event: ...）”**

- [ ] **Step 5: Write “常见问题（缓冲/代理）”**

Sections:
- 为什么只支持流式（1-2 段）
- OpenAI SSE：`curl -N`、`data: [DONE]`
- Anthropic SSE：常见 `event:` 名称概览
- 常见问题：缓冲/代理导致“不流式”

- [ ] **Step 2: Keep it implementation-aligned**

Rules:
- 不承诺精确事件序列字段（除非当前实现保证）
- 只写“调试必需”的内容

---

### Task 5: Create `docs/development.md` (dev/test/live smoke/troubleshooting)

**Files:**
- Create: `docs/development.md`

- [ ] **Step 1: Create file with title + scope**

- [ ] **Step 2: Write “本地开发（两种凭据启动示例）”**

- [ ] **Step 3: Write “测试（bun test）”**

- [ ] **Step 4: Write “真实联调（smoke-live）”**

- [ ] **Step 5: Write “排错（端口占用/旧进程/常见 4xx/5xx）”**

Sections:
- 本地开发（安装/启动；两种凭据示例）
- 测试（`bun test`）
- 真实联调（`smoke-live.sh` / `bun run smoke:live`）
- 排错（端口占用、旧进程、常见 4xx/5xx）

---

### Task 6: Final docs pass (links + consistency)

**Files:**
- Modify: `README.md`
- Modify: `docs/*.md`

- [ ] **Step 1: Ensure README links to all 4 docs**
- [ ] **Step 2: Ensure docs cross-link minimally (auth ↔ api-compat)**
- [ ] **Step 3: Run tests again**

Run: `bun test`
Expected: PASS

---

## Notes / Constraints

- 本计划只改文档，不调整代码行为；文档必须以当前实现为准。
- 任何会误导的表述（例如“上游错误也会包装成标准 JSON”）一律删除或改成明确的“当前实现行为”。

## Plan review fixes applied

- 已将每篇 `docs/*.md` 的写作按 section 拆分为更小步骤（便于 2–5 分钟节拍推进）。
- README 需移除“刷新占位”表述并补齐 `curl -N` 的最小验证闭环（作为 Task 1 验收硬标准）。

