## 背景

`kiro-ide-proxy` 是一个基于 Bun 的本地/自托管 Kiro API 代理网关，对外提供 OpenAI/Anthropic 兼容端点，并在本地管理/刷新上游 Kiro 访问凭据。

当前仓库已有：

- `README.md`：包含运行、端点概览、测试与 live smoke、部分常见问题
- `docs/superpowers/specs/*` 与 `docs/superpowers/plans/*`：偏“设计/实施计划”的过程文档（不是面向使用者的长期文档）

问题是：使用者第一次进入项目时，虽然能“跑起来”，但对关键契约（仅支持流式、鉴权方式、凭据优先级、常见错误）与进一步排错/联调路径的理解需要在代码与测试之间跳转；同时缺少可长期维护的 `docs/` 文档分层。

本设计旨在补齐并重构文档信息架构：让 README 保持简洁、5 分钟上手；把深水区细节下沉到 `docs/` 的小而专一文档。

## 目标与非目标

### 目标

- README 读完即可完成：
  - 安装依赖
  - 使用两种凭据路径之一启动服务（默认 `KIRO_CREDS_FILE`，同时提供 `KIRO_ACCESS_TOKEN` 备选）
  - 用最小 curl 示例验证三个端点的基本可用性
- README 明确写出关键契约与限制：
  - 代理鉴权（`PROXY_API_KEY`）支持 `Authorization: Bearer` 与 `x-api-key`
  - 仅支持流式（非流式返回 `501`）
  - 未配置 Kiro 凭据时流式请求返回 `503`
- 新增 `docs/` 下的最小长期文档集合（4 篇），每篇聚焦一个主题，README 仅做索引链接。

### 非目标

- 不重写已有 `docs/superpowers/specs/*` 与 `docs/superpowers/plans/*` 的历史内容（本次新增一份“docs 刷新”的设计文档即可）。
- 不扩展实现功能（本任务只涉及文档与信息架构，不改业务逻辑）。

## 受众与写作策略

### 受众

- **外部用户**：希望快速上手运行、理解端点与限制、知道出错如何排查
- **内部维护者**：希望文档结构稳定、变更点局部化、便于长期维护

### 策略

- **两者兼顾**：README 简洁；细节下沉到 `docs/`，并在 README 提供清晰索引。
- 示例命令统一使用 Bun（`bun install` / `bun run` / `bun test`）。
- 文档保持“最小但完整”：优先覆盖使用路径与常见错误语义，避免堆砌实现细节。

## README 信息架构设计

### README 的定位

- “5 分钟上手 + 关键契约摘要 + 文档索引”
- 不在 README 里展开长篇协议细节（例如 SSE 事件序列、EventStream 桥接细节），这些写到 `docs/`。

### README 结构（建议目录）

1. 简介（1-2 句）
2. 快速开始（安装 + 启动）
   - 安装：`bun install`
   - 启动（默认）：`PROXY_API_KEY=... KIRO_CREDS_FILE=... bun run index.ts`
   - 启动（备选）：`PROXY_API_KEY=... KIRO_ACCESS_TOKEN=... bun run index.ts`
3. 关键契约（只列最重要的 4 条）
   - 代理鉴权 header：`Authorization: Bearer <PROXY_API_KEY>` 或 `x-api-key: <PROXY_API_KEY>`
   - 仅支持流式：非流式返回 `501`
   - 未配置/无法读取上游凭据：流式请求返回 `503`
   - `KIRO_ACCESS_TOKEN` 优先，且设置后绕过凭据文件读取/刷新/阈值逻辑
4. 端点（简表）
   - `GET /v1/models`
   - `POST /v1/chat/completions`（仅 stream）
   - `POST /v1/messages`（仅 stream）
5. 最小调用示例（curl，必须包含 `-N` 防止缓冲）
   - models
   - OpenAI chat completions stream
   - Anthropic messages stream
6. 配置（环境变量表格）
7. 错误码速查（小表：状态码→原因→怎么做）
8. 测试与真实联调
   - `bun test`
   - live smoke（`smoke-live.sh` + Bun script）
9. 文档索引（新增）
   - 链接到 `docs/auth-and-creds.md`
   - 链接到 `docs/api-compat.md`
   - 链接到 `docs/streaming.md`
   - 链接到 `docs/development.md`

## `docs/` 最小长期文档集合

新增 4 个文件（都短小、可长期维护），并在 README 中索引。

### 1) `docs/auth-and-creds.md`

目的：解释“代理鉴权”与“Kiro 上游凭据”的关系、优先级与刷新/降级行为，让使用者知道如何配置与排错。

章节建议：

- 概览：代理鉴权 vs 上游凭据
- 代理鉴权（`PROXY_API_KEY`）
  - 支持的 header 形式
  - 典型 401 场景
- 上游凭据来源与优先级
  - `KIRO_ACCESS_TOKEN`（直接注入）
  - `KIRO_CREDS_FILE`（从 JSON 文件读取）
  - 优先级与冲突时行为
- `KIRO_CREDS_FILE` 格式
  - **基础运行必需**：`accessToken` / `refreshToken` / `expiresAt`（ISO 日期字符串）
  - **可选：启用 AWS SSO OIDC 刷新（同一文件的额外字段）**：在同一个 JSON 中额外提供 `clientIdHash` + `region`，并且 `~/.aws/sso/cache/{clientIdHash}.json` 需要包含 `clientId` / `clientSecret`
  - 其它字段（如 `profileArn`）不作为基础必需；是否生效取决于路由与上游调用策略
- 刷新与降级（高层，不写实现细节）
  - 阈值刷新：`TOKEN_REFRESH_THRESHOLD_SECONDS`
  - 刷新失败：token 仍有效则继续使用；已过期则请求失败（在 `docs/api-compat.md` 里按端点固化状态码与返回体形状，避免“由路由决定”的模糊描述）
- 安全注意事项
  - 不要提交凭据文件
  - 凭据文件权限建议（例如 `0600`）

### 2) `docs/api-compat.md`

目的：给调用方一个稳定的“对外契约摘要”，避免因为实现细节变化而误解。

章节建议：

- 端点总览（OpenAI/Anthropic）
- 鉴权方式（引用 `docs/auth-and-creds.md`）
- OpenAI 兼容
  - `/v1/models`
  - `/v1/chat/completions`（仅 `stream: true`）
- Anthropic 兼容
  - `/v1/messages`（仅 `stream: true`）
- 错误语义（简表）
  - 401：代理 key 不正确
  - 503：未配置或无法读取凭据（例如缺少 `KIRO_ACCESS_TOKEN`/`KIRO_CREDS_FILE`，或 creds 文件不可读/无效）。需要在文档中明确：OpenAI/Anthropic 端点的错误体形状不同
  - 501：非流式未实现
  - 403：上游 token 失效/过期（来自上游）。需要在文档中明确：当前实现对“上游非 2xx”通常会透传 `status + body(text)`，不保证包装为 OpenAI/Anthropic 的标准错误 JSON
  - 400：请求体缺字段或格式不正确

> 备注：`docs/api-compat.md` 的错误语义章节需要把“上游非 2xx 透传 `status + text`”提升为最重要的顶层规则，并在表格里明确这类错误响应通常**不是** OpenAI/Anthropic 标准错误 JSON（也不保证 `content-type`）。

### 3) `docs/streaming.md`

目的：让使用者能调试流式请求（SSE），理解为什么必须使用 stream，以及如何在命令行/客户端正确消费流。

章节建议：

- 为什么只支持流式（简述）
- OpenAI SSE：如何验证（curl `-N`）、`[DONE]` 结束语义
- Anthropic SSE：事件类型概览（不必逐字段，但要列出常见 event 名称）
- 常见问题
  - 缓冲导致“看起来不流式”
  - 反代/代理的超时与 buffering 设置提示（高层）

### 4) `docs/development.md`

目的：给维护者/贡献者一条“开发→测试→联调→排错”的稳定路径。

章节建议：

- 本地开发
  - 安装依赖、启动服务
  - 常用环境变量
- 测试
  - `bun test`
- 真实联调（live smoke）
  - 启动服务示例（`KIRO_CREDS_FILE` / `KIRO_ACCESS_TOKEN`）
  - 运行 `smoke-live.sh`（或 `bun run smoke:live`）
- 排错
  - 端口占用检查
  - 旧进程/错误请求指向旧服务的诊断

## 验收标准（文档）

- README 满足“5 分钟上手”：新用户无需读代码即可跑通并验证端点。
- README 清晰写出“仅支持流式”与“凭据优先级/缺失行为”。
- `docs/` 新增 4 篇，README 有可点击索引，且每篇内容不重复堆叠。
- 示例命令与现有实现一致（Bun 命令、环境变量名、端点路径与当前路由一致）。
- README 现有描述如与实现不一致（例如把 SSO OIDC 刷新写成“占位”），需要在本次文档刷新中一并更正，避免误导读者。

## 变更清单（将要修改/新增的文件）

- 修改：`README.md`
- 新增：
  - `docs/auth-and-creds.md`
  - `docs/api-compat.md`
  - `docs/streaming.md`
  - `docs/development.md`

