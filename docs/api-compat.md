## API 兼容性概览

本项目对外提供 OpenAI / Anthropic 兼容端点（但只支持流式）。代理鉴权与上游凭据的区别见 `docs/auth-and-creds.md`。

## 鉴权

客户端调用需携带 `PROXY_API_KEY`，支持：

- `Authorization: Bearer <PROXY_API_KEY>`
- `x-api-key: <PROXY_API_KEY>`

## 端点

- `GET /v1/models`
- `POST /v1/chat/completions`（仅 `stream: true`）
- `POST /v1/messages`（仅 `stream: true`）

### `GET /v1/models`

- 若已配置上游凭据：请求上游 `ListAvailableModels` 并映射为 OpenAI `models` 列表。
- 若未配置上游凭据或上游请求失败：**降级返回 `200` 且 `data: []`**。

### `POST /v1/chat/completions`（OpenAI）

- 必填：`model`、`messages`
- 仅支持：`stream: true`

### `POST /v1/messages`（Anthropic）

- 必填：`model`、`max_tokens`、`messages`
- 仅支持：`stream: true`

## 错误与返回体形状（最重要的规则）

### 顶层规则：上游非 2xx 透传

当上游 Kiro 返回非 2xx 时，当前实现通常会**透传**：

- **HTTP status**：保持上游状态码（例如 403）
- **body**：上游返回的 **纯文本**（`text`），不保证是 JSON
- **content-type**：不保证存在/不保证为 `application/json`

因此：这类错误响应**不保证**符合 OpenAI/Anthropic 的标准错误 JSON 形状。

### 本地生成的错误（校验/鉴权/不支持）

下面这些错误由代理本地生成，返回 **JSON**（但 OpenAI/Anthropic 形状不同）。

## 端点 × 状态码 → body 形状（矩阵）

| 端点 | 401（代理 key） | 400（请求校验/JSON） | 501（非流式） | 503（缺 creds / creds file 无效） | 上游非 2xx（例如 403） |
|---|---|---|---|---|---|
| `GET /v1/models` | OpenAI JSON | — | — | —（降级为 200 空列表） | —（降级为 200 空列表） |
| `POST /v1/chat/completions` | OpenAI JSON | OpenAI JSON | OpenAI JSON | OpenAI JSON | 透传 `status + text` |
| `POST /v1/messages` | Anthropic JSON | Anthropic JSON | Anthropic JSON（`api_error`） | Anthropic JSON（仅“未配置 creds”场景被明确处理） | 透传 `status + text` |

说明：

- **OpenAI JSON** 形状：

```json
{ "error": { "message": "...", "type": "invalid_request_error|authentication_error|server_error", "code": null } }
```

- **Anthropic JSON** 形状：

```json
{ "type": "error", "error": { "type": "invalid_request_error|authentication_error|api_error", "message": "..." } }
```

