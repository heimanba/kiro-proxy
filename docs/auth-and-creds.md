## 鉴权与凭据：两套东西

本项目有两类“凭据”，不要混淆：

- **代理鉴权（对外）**：客户端调用本代理时，用 `PROXY_API_KEY` 保护 `/v1/*` 端点。
- **上游凭据（对内）**：本代理调用 Kiro 上游 API 时需要的 Kiro access token（来自 `KIRO_ACCESS_TOKEN` 或 `KIRO_CREDS_FILE`）。

## 代理鉴权（`PROXY_API_KEY`）

客户端请求需要携带以下任一 header：

- `Authorization: Bearer <PROXY_API_KEY>`
- `x-api-key: <PROXY_API_KEY>`

缺失或不匹配时返回 `401`（OpenAI/Anthropic 端点的错误 JSON 形状不同，见 `docs/api-compat.md`）。

## 上游凭据优先级

优先级为：

1. `KIRO_ACCESS_TOKEN`
2. `KIRO_CREDS_FILE`

注意：一旦设置 `KIRO_ACCESS_TOKEN`，代理会**直接使用该 token**，并**绕过**凭据文件读取、刷新与 `TOKEN_REFRESH_THRESHOLD_SECONDS` 的阈值逻辑。

## `KIRO_CREDS_FILE`（JSON 文件）

这是一个包含 access token 与刷新信息的 JSON 文件。本项目读取该文件用于上游调用，并在需要时原子回写更新。

默认值与行为：

- 当显式设置 `KIRO_CREDS_FILE` 时（支持 `~` 展开），代理会使用该路径。
- 当未设置 `KIRO_CREDS_FILE` 时，若默认文件 `~/.aws/sso/cache/kiro-auth-token.json` 存在，代理会自动使用该路径；若该默认文件不存在，则仍视为未配置上游凭据。

### 基础必需字段（总是需要）

- `accessToken`：上游 Bearer token
- `refreshToken`：用于刷新 access token
- `expiresAt`：ISO8601 日期字符串（建议 UTC），例如：`"2026-01-01T00:00:00.000Z"`

示例（最小）：

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresAt": "2026-01-01T00:00:00.000Z"
}
```

### 可选：启用 AWS SSO OIDC 刷新（同一文件的额外字段）

当你希望走 AWS SSO OIDC 刷新路径时，需要在**同一个 JSON** 里额外提供：

- `clientIdHash`
- `region`

并且需要存在文件：`~/.aws/sso/cache/{clientIdHash}.json`，其中必须包含：

- `clientId`
- `clientSecret`

示例（同一文件叠加字段）：

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresAt": "2026-01-01T00:00:00.000Z",
  "clientIdHash": "abc123...",
  "region": "us-east-1"
}
```

## 刷新与阈值（高层）

- 当使用 `KIRO_CREDS_FILE` 时，代理会在 `expiresAt` 临近到期前，根据 `TOKEN_REFRESH_THRESHOLD_SECONDS` 尝试刷新并回写同一文件。
- 若未配置上游凭据（既没有 `KIRO_ACCESS_TOKEN` 也没有 `KIRO_CREDS_FILE`），流式请求会返回 `503`。

## 安全注意事项

- 不要把 `KIRO_ACCESS_TOKEN` 或 `KIRO_CREDS_FILE` 提交到 git 仓库。
- 建议把 creds 文件权限设置为仅当前用户可读（例如 `0600`）。

