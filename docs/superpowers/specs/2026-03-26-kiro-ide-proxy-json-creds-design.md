## 背景与目标

我们要在 Bun 项目 `kiro-proxy` 中实现一个本地/自托管的 Kiro API 代理网关，向外提供：

- OpenAI 兼容接口：`/v1/models`、`/v1/chat/completions`
- Anthropic 兼容接口：`/v1/messages`

并移植 `kiro-gateway` 的 **“JSON 凭据文件（Kiro IDE / Enterprise）”**能力：

- 通过 `KIRO_CREDS_FILE` 读取 `accessToken / refreshToken / expiresAt / profileArn / region / clientIdHash(可选)`。
- Enterprise 场景：若存在 `clientIdHash`，自动读取 `~/.aws/sso/cache/{clientIdHash}.json` 获取 `clientId / clientSecret`（用于 AWS SSO OIDC 刷新）。
- 自动刷新 access token（到期前阈值刷新），并回写 JSON 文件更新 token/过期时间。

约束与已确认选择：

- 对外兼容层：**OpenAI + Anthropic（C）**
- 凭据来源：**`KIRO_CREDS_FILE` + `REFRESH_TOKEN`（A,B）**（不做 SQLite 读取）
- 实现方案：**方案 1：`Bun.serve()` 直连实现**

## 非目标（本期不做）

- 不支持 `KIRO_CLI_DB_FILE`（kiro-cli SQLite）读取/回写。
- 不追求完整复刻 `kiro-gateway` 的所有高级功能（隐藏模型/别名/复杂重试/调试日志系统等），优先最小可用与正确性。
- 不做 UI、管理后台或多租户。

## 术语与外部依赖

- **Kiro Desktop Auth**：无 `clientId/clientSecret` 时使用的刷新方式（Kiro IDE 个人账户常见）。
- **AWS SSO OIDC**：有 `clientId/clientSecret` 时使用的刷新方式（企业 SSO / Enterprise 常见）。
- **Kiro API Host**：`https://q.{region}.amazonaws.com`（Kiro 上游 API 的主机名；我们在本项目中固定使用 `kiro-gateway` 已验证的路径）。

本项目将直接对齐 `kiro-gateway` 的上游契约（用于保证可实现性与可测试性），最小集合如下：

- **模型列表**：`GET {KIRO_API_HOST}/ListAvailableModels`
  - Query：`origin=AI_EDITOR`
  - 仅在 `Kiro Desktop Auth` 且存在 `profileArn` 时额外带：`profileArn=<arn...>`
- **对话生成（流式）**：`POST {KIRO_API_HOST}/generateAssistantResponse`
  - Body：JSON（由 OpenAI/Anthropic 请求转换得到）
  - Response：AWS EventStream（字节流），需要解析并转为 OpenAI/Anthropic 的 SSE

上游请求必须携带（参考 `kiro-gateway`）的最小 headers：

- `Authorization: Bearer <accessToken>`
- `Content-Type: application/json`
- `User-Agent`、`x-amz-user-agent`、`x-amzn-codewhisperer-optout: true`、`x-amzn-kiro-agent-mode: vibe`
- `amz-sdk-invocation-id`（UUID）、`amz-sdk-request: attempt=1; max=3`

## 配置设计

### 环境变量

- **`PROXY_API_KEY`**：保护代理网关的访问密钥（客户端调用时必须携带）
- **`KIRO_CREDS_FILE`**：JSON 凭据文件路径（优先级高于 `REFRESH_TOKEN`）
- **`REFRESH_TOKEN`**：当不提供 `KIRO_CREDS_FILE` 时使用的刷新 token
- **`PROFILE_ARN`**：Kiro Desktop Auth 情况下可能需要（企业 SSO 通常不需要）
- **`KIRO_REGION`**：默认 `us-east-1`
- **`TOKEN_REFRESH_THRESHOLD_SECONDS`**：到期前提前刷新的秒数，默认 `600`
- **`SERVER_HOST`**：默认 `0.0.0.0`
- **`SERVER_PORT`**：默认 `8000`

### `KIRO_CREDS_FILE` JSON 格式（Kiro IDE / Enterprise）

最小字段：

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresAt": "2025-01-12T23:00:00.000Z",
  "region": "us-east-1"
}
```

可选字段：

```json
{
  "profileArn": "arn:aws:codewhisperer:us-east-1:...",
  "clientIdHash": "abc123..."
}
```

Enterprise device registration 文件：

- 路径：`~/.aws/sso/cache/{clientIdHash}.json`
- 需要字段：`clientId`、`clientSecret`

## API 对外契约

### 鉴权

客户端必须提供 `PROXY_API_KEY`，以下两种方式均接受：

- `Authorization: Bearer <PROXY_API_KEY>`
- `x-api-key: <PROXY_API_KEY>`

未提供或不匹配：返回 `401`，JSON 错误体说明“unauthorized / invalid api key”。

### OpenAI 兼容

- `GET /v1/models`
- `POST /v1/chat/completions`

支持：

- 非流式：返回 OpenAI 标准 JSON
- 流式：SSE（`text/event-stream`）

### Anthropic 兼容

- `POST /v1/messages`

支持：

- 非流式：Anthropic 标准 JSON
- 流式：**严格采用 Anthropic Messages Streaming SSE 事件格式**（对齐 `kiro-gateway`）：
  - `event: message_start`
  - `event: content_block_start`
  - `event: content_block_delta`
  - `event: content_block_stop`
  - `event: message_delta`
  - `event: message_stop`
  - 出错：`event: error`

## 核心数据流（高层）

1. 请求进入网关 → 校验 `PROXY_API_KEY`
2. 解析请求（OpenAI/Anthropic）
3. `authManager.getAccessToken()`：
   - 若 token 未过期且不接近过期 → 直接使用
   - 否则串行化刷新（single-flight lock）
4. 使用 access token 组装 Kiro 请求 headers
5. 向 Kiro API 发起请求（流式则保持 streaming 转发）
6. 将 Kiro 响应转换为 OpenAI/Anthropic 格式返回客户端

## 请求/响应映射（最小可用，规范来源）

为避免“看起来合理但实现不一致”，本项目的映射规则**以 `kiro-gateway` 的现有实现为规范来源**，实现阶段在 TS 中逐条移植：

- OpenAI → Kiro：`kiro/converters_openai.py::build_kiro_payload()`
- Anthropic → Kiro：`kiro/converters_anthropic.py::anthropic_to_kiro()`
- Kiro 流式 → OpenAI SSE：`kiro/streaming_openai.py::stream_kiro_to_openai_internal()`
- Kiro 流式 → Anthropic SSE：`kiro/streaming_anthropic.py::stream_kiro_to_anthropic()`
- Kiro AWS EventStream 解析：`kiro/streaming_core.py::parse_kiro_stream()` + `kiro/parsers.py::AwsEventStreamParser`

### OpenAI → Kiro（要点）

- **system prompt**：把 OpenAI `messages` 中 `role=system` 的内容抽出并拼成 `system_prompt`（用换行连接）。
- **tool messages（role=tool）**：聚合成一个“用户消息 + tool_results”输入给 Kiro（并提取其中可能包含的图片 data url）。
- **assistant tool_calls**：从 `message.tool_calls` 提取函数名与参数（字符串 JSON），并进入统一消息结构。
- **user tool_result blocks**：若 user message 的 content 里出现 `{\"type\":\"tool_result\" ...}`，转换为统一 `tool_results`。
- **images**：支持从 OpenAI content block 里提取 `image_url`（`data:image/...;base64,...`）。
- **profileArn**：仅在 `Kiro Desktop Auth` 且存在 `profileArn` 时，才进入上游 payload / query（Enterprise/AWS SSO OIDC 不发送，避免 403）。

### Anthropic → Kiro（要点）

- **system**：Anthropic 的 `system` 字段本身就是独立字段（支持 string 或 content blocks），提取文本后作为 `system_prompt`。
- **messages**：把 Anthropic 的 content blocks（text/tool_use/tool_result）提取为统一消息：
  - assistant 里 `tool_use` → tool_calls
  - user 里 `tool_result` → tool_results（并从 tool_result content 中提取图片）

## Streaming 映射状态机（最小可用）

### Kiro AWS EventStream → OpenAI SSE

规范来源：`kiro/streaming_openai.py`

- 上游解析输出统一事件 `KiroEvent`：`content` / `thinking` / `tool_use` / `usage` / `context_usage`
- **content**：每个增量片段立刻产出一个 `chat.completion.chunk`：
  - 首个 chunk 需要带 `delta.role=\"assistant\"`
  - 后续 chunk 仅带 `delta.content`
- **thinking**：当启用 reasoning 模式时，以 `delta.reasoning_content`（或退化到 `delta.content`）输出增量
- **tool_use**：流中收集，结束时一次性输出一个包含 `delta.tool_calls` 的 chunk（每个 tool_call 需要 `index` 字段）
- **结束**：
  - 输出一个 final chunk：`delta={}` 且 `finish_reason=\"tool_calls\" | \"stop\"`，并携带 `usage`
  - 最后输出 `data: [DONE]\\n\\n`

### Kiro AWS EventStream → Anthropic SSE

规范来源：`kiro/streaming_anthropic.py`

- 首先输出 `message_start`
- **thinking**（如启用并选择 as_reasoning_content）：作为 `content_block(type=\"thinking\")`，通过 `thinking_delta` 增量输出
- **content**：作为 `content_block(type=\"text\")`，通过 `text_delta` 增量输出
- **tool_use**：转为 `content_block(type=\"tool_use\")`，通过 `input_json_delta` 输出完整（或增量）JSON
- 最后输出：
  - `message_delta`（包含 `stop_reason: \"tool_use\" | \"end_turn\"` 与 `usage.output_tokens`）
  - `message_stop`
- 异常：输出 `event: error`，并尽量优雅结束流

## 认证与刷新设计（移植重点）

### 凭据加载优先级

1. 若设置 `KIRO_CREDS_FILE`：
   - 读取 JSON：`accessToken/refreshToken/expiresAt/profileArn/region/clientIdHash?`
   - 若有 `clientIdHash`：
     - 尝试读取 `~/.aws/sso/cache/{clientIdHash}.json` 加载 `clientId/clientSecret`
     - 若该文件不存在或缺字段：**记录 warning 并继续**（此时会按 `Kiro Desktop Auth` 处理；让用户仍可用 refreshToken 走 desktop 刷新）
2. 否则使用 `REFRESH_TOKEN`（可选 `PROFILE_ARN/KIRO_REGION`）

### AuthType 自动检测

- 若内存中存在 `clientId` 且 `clientSecret` → `AWS_SSO_OIDC`
- 否则 → `KIRO_DESKTOP`

### 刷新策略

- 维护：
  - `accessToken?: string`
  - `refreshToken?: string`
  - `expiresAt?: Date`
  - `profileArn?: string`
  - `region: string`
  - `authType: AWS_SSO_OIDC | KIRO_DESKTOP`
- 刷新阈值：到期前 \(600s\)（由 `TOKEN_REFRESH_THRESHOLD_SECONDS` 控制，默认 10 分钟）
- 刷新成功后：
  - 更新内存 token
  - 若使用 `KIRO_CREDS_FILE`：回写 JSON（保留未知字段），并将 `expiresAt` 标准化为 **ISO8601 UTC**

#### Kiro Desktop Auth 刷新

- URL 模板：`https://prod.{region}.auth.desktop.kiro.dev/refreshToken`
- `POST` JSON：`{ "refreshToken": "..." }`
- 期望响应：
  - `accessToken`
  - `refreshToken?`
  - `expiresIn?`（秒）
  - `profileArn?`

#### AWS SSO OIDC 刷新

- URL 模板：`https://oidc.{region}.amazonaws.com/token`
- `POST` JSON（camelCase）：
  - `grantType: "refresh_token"`
  - `clientId`
  - `clientSecret`
  - `refreshToken`
- 期望响应（camelCase）：
  - `accessToken`
  - `refreshToken?`
  - `expiresIn?`

说明：尽管常见 OIDC token endpoint 多使用 `application/x-www-form-urlencoded`，但本项目 **明确对齐 `kiro-gateway` 的已验证实现**（其对该 endpoint 使用 JSON + camelCase），以降低“实现正确但不可用”的风险。

### 并发与一致性

- 所有请求共享单个 `KiroAuthManager` 实例。
- `getAccessToken()` 内部用互斥锁保证同时只有一个刷新请求在飞。
- 读写 `KIRO_CREDS_FILE` 时采用“读-改-写”并保持 JSON 其它字段不丢失。
- 回写采用**原子写**：写入临时文件（同目录）→ `rename` 覆盖，避免进程中断导致凭据文件损坏。

### 降级策略（最小实现）

当刷新失败时：

- 若当前 `accessToken` 仍未过期：允许继续使用该 token 尝试请求（并在日志中记录 warning）
- 若已过期：返回 **`502 Bad Gateway`**（上游认证不可用），并提示用户重新登录 Kiro IDE / 更新凭据文件

## 组件拆分（文件级）

建议目录结构（实现阶段落地）：

- `src/config.ts`
- `src/server.ts`
- `src/auth/kiroAuthManager.ts`
- `src/kiro/endpoints.ts`（组装 URL）
- `src/kiro/headers.ts`（组装 headers，含 User-Agent）
- `src/kiro/client.ts`（fetch + streaming）
- `src/routes/openai.ts`
- `src/routes/anthropic.ts`
- `src/types/openai.ts`、`src/types/anthropic.ts`（最小类型）
- `src/errors.ts`（统一错误格式）

## 错误处理与可观测性

- 统一 JSON 错误体：`{ "error": { "message": "...", "type": "...", "code": "..." } }`（OpenAI 风格优先；Anthropic 端点可做轻量映射）
- 必须覆盖：
  - `401`：代理 api key 不正确
  - `400`：请求体不合法（缺字段）
  - `502`：Kiro 上游错误（含上游非 200）、刷新失败、凭据读取失败（网关作为 Bad Gateway）
  - `500`：网关内部未捕获错误
- 日志：
  - 默认 `info`，失败场景输出 `warn/error`
  - 日志中绝不打印 token 明文（可打印前 6-8 位用于排障）

## 测试点（最小集合）

- **配置解析**：
  - 仅 `KIRO_CREDS_FILE` 生效
  - 仅 `REFRESH_TOKEN` 生效
  - 两者都给：以 `KIRO_CREDS_FILE` 优先
- **Enterprise 逻辑**：
  - `clientIdHash` 存在时能正确加载 `clientId/clientSecret`
  - `clientIdHash` 文件缺失/缺字段 → **降级为 Kiro Desktop + warning**（行为已固定）
- **刷新锁**：
  - 并发请求触发刷新时只发生一次刷新调用
- **路由鉴权**：
  - 缺 header / 错 api key → 401
- **流式转发**：
  - `/v1/chat/completions` stream 基本可用（至少能把 token chunks 透传/映射）
  - `/v1/messages` stream 基本可用

## 安全考虑

- `PROXY_API_KEY` 必须由用户自行设置强随机字符串；README 中明确风险。
- 凭据文件只读/写本地路径，不提供 HTTP 上传接口。
- 回写凭据文件时使用 `0600` 权限（若平台允许），避免泄露。

## 交付物

- 在 `kiro-proxy` 新增上述模块并提供可运行的 `bun run index.ts`（或 `bun run src/server.ts`）。
- README 增加配置示例与“JSON 凭据文件（Kiro IDE / Enterprise）”说明。

## 开放问题（实现阶段需要最后拍板）

本期**不支持** AWS SSO OIDC region 与 API region 分离：统一使用 `KIRO_REGION`（后续如需要，再新增 `KIRO_OIDC_REGION` 扩展）。
