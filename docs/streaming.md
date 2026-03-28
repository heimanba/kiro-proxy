## Streaming（SSE）调试指南

本项目的 `/v1/chat/completions` 与 `/v1/messages` 目前只支持 `stream: true`。如果你不启用 stream，会收到 `501`。

## 用 curl 验证（建议 `-N`）

流式响应是 SSE（`text/event-stream`）。命令行测试时建议加 `curl -N`（禁用输出缓冲，便于观察持续输出）。

### OpenAI SSE

- 端点：`POST /v1/chat/completions`
- 结束：会输出 `data: [DONE]`

示例：

```bash
curl -N \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/v1/chat/completions" \
  -d '{"model":"x","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

### Anthropic SSE

- 端点：`POST /v1/messages`
- 事件：以 `event: ...` + `data: ...` 形式输出，常见事件名包括：
  - `message_start`
  - `content_block_start`
  - `content_block_delta`
  - `content_block_stop`
  - `message_delta`
  - `message_stop`

示例：

```bash
curl -N \
  -H "x-api-key: $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  "$BASE_URL/v1/messages" \
  -d '{"model":"x","stream":true,"max_tokens":64,"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}'
```

## 常见问题

- **看起来“不流式”**：通常是因为客户端/终端在缓冲输出。优先用 `curl -N` 验证。
- **上游报错时不是 JSON**：上游非 2xx 时当前实现常透传 `status + text`，不保证标准错误 JSON，见 `docs/api-compat.md`。

