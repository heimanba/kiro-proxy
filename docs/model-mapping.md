## 模型映射说明

本文说明代理如何把客户端请求里的 **`model` 字段**映射为 Kiro 上游使用的 **`modelId`**，以及 **`GET /v1/models`** 如何把上游列表转成 OpenAI 兼容形状。

---

## 请求路径：`model` → `resolveKiroModelId` → Kiro `modelId`

OpenAI（`POST /v1/chat/completions`）与 Anthropic（`POST /v1/messages`）在构造 Kiro 请求体之前，都会对客户端传入的 `model` 调用：

- `src/kiro/modelResolver.ts` → `resolveKiroModelId(string)`

解析结果会作为 **`modelId`** 写入发往 `POST .../generateAssistantResponse` 的请求体（`conversationState`）中，例如：

- `conversationState.currentMessage.userInputMessage.modelId`
- 历史消息中用户消息的 `userInputMessage.modelId`（见 `src/kiro/payload.ts` 中 `toHistoryEntry`）

**没有**维护一张「任意别名 → 固定上游 ID」的全局配置表；未命中下列规则时，**原样**把字符串交给 Kiro。

---

## `resolveKiroModelId` 规则

实现位置：`src/kiro/modelResolver.ts`。

| 输入特征 | 输出 |
|----------|------|
| 空字符串（trim 后） | 原样返回 |
| 不区分大小写，以 `-latest` 结尾 | **`auto`**（常见工具默认 `*-latest`，Kiro 可能不认该后缀，但支持 `auto`） |
| 匹配 `claude-(sonnet\|opus\|haiku)-…` 版本模式 | 将主次版本规范为 **`major.minor`**（例如 `claude-sonnet-4-6` → `claude-sonnet-4.6`）；仅主版本则保留为 `claude-{family}-{major}` |
| 其它任意非空字符串 | **不修改**（例如 `deepseek-3.2`、`qwen-…` 等） |

正则意图：把 `4-6`、`4.6` 等写法统一成 Kiro 侧更常见的 **`claude-*-4.6`** 形式；带额外后缀的变体仍会在同一正则捕获范围内被归一化（详见源码与 `tests/kiro/modelResolver.test.ts`）。

---

## 列表路径：`GET /v1/models`（Kiro → OpenAI 列表）

与「请求里选模型」是另一条线：

- 上游：`GET https://q.{region}.amazonaws.com/ListAvailableModels?origin=AI_EDITOR`
- 映射：`src/kiro/models.ts` 中 `mapListModelsToOpenAi`
- 作用：把上游 JSON（支持数组根、或 `models` / `modelSummaries` / `data` 等字段）转成 OpenAI 风格的 `{ object: "list", data: [...] }`，每条含 `id`、`object: "model"`、`owned_by: "kiro"` 等

**不会**在这里对 `id` 再跑一遍 `resolveKiroModelId`；列表展示的是上游返回的标识。

---

## 如何扩展映射

若需要「固定别名 → 固定 `modelId`」（例如 `gpt-4` → `auto`）：

1. 在 `resolveKiroModelId` 开头增加显式映射表（或读取环境变量 / 配置文件），**先于**现有 `-latest` 与 Claude 正则逻辑；
2. 为新规则补充 `tests/kiro/modelResolver.test.ts` 用例。

修改后所有经 `buildKiroPayloadFromOpenAi` / `buildKiroPayloadFromAnthropic` 的流式请求都会使用新规则。

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `src/kiro/modelResolver.ts` | `resolveKiroModelId` |
| `src/kiro/payload.ts` | 将解析后的 `model` 写入 Kiro `modelId` 字段 |
| `src/routes/openai.ts` / `src/routes/anthropic.ts` | 调用 `resolveKiroModelId` 后再组 payload |
| `src/kiro/models.ts` | `ListAvailableModels` 响应 → OpenAI `models` 列表 |
| `tests/kiro/modelResolver.test.ts` | 解析器单元测试 |

其它契约（错误码、仅流式等）见 `docs/api-compat.md`。
