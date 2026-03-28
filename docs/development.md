## 开发者指南

这份文档面向需要本地开发、跑测试、做真实联调（live smoke）与排错的维护者。

## 本地开发

安装依赖：

```bash
bun install
```

启动（默认：使用 `KIRO_CREDS_FILE`）：

```bash
PROXY_API_KEY=dev-secret \
KIRO_CREDS_FILE="/path/to/kiro-creds.json" \
bun run index.ts
```

提示：若不设置 `KIRO_CREDS_FILE`，当默认文件 `~/.aws/sso/cache/kiro-auth-token.json` 存在时，代理会自动使用该路径（支持 `~` 展开）；若该默认文件不存在，则仍视为未配置上游凭据。

启动（备选：使用 `KIRO_ACCESS_TOKEN`）：

```bash
PROXY_API_KEY=dev-secret \
KIRO_ACCESS_TOKEN="eyJ..." \
bun run index.ts
```

默认监听：`0.0.0.0:8000`（可通过 `SERVER_HOST`/`SERVER_PORT` 调整）。

## 测试

```bash
bun test
```

## 真实联调（live smoke）

先启动服务（示例用本地凭据文件）：

```bash
PROXY_API_KEY=dev-secret \
KIRO_CREDS_FILE="/Users/mamba/.aws/sso/cache/kiro-auth-token.json" \
bun run index.ts
```

另开一个终端执行：

```bash
chmod +x ./smoke-live.sh
BASE_URL=http://127.0.0.1:8000 PROXY_API_KEY=dev-secret ./smoke-live.sh
```

也可以直接用 Bun script：

```bash
BASE_URL=http://127.0.0.1:8000 PROXY_API_KEY=dev-secret bun run smoke:live
```

脚本会依次验证：

- `GET /v1/models`
- `POST /v1/chat/completions`（stream）
- `POST /v1/messages`（stream）

## 排错

- **401**：代理密钥错误（`Authorization: Bearer ...` 或 `x-api-key` 不匹配）。
- **503**：未配置 `KIRO_ACCESS_TOKEN`/`KIRO_CREDS_FILE`，或 `KIRO_CREDS_FILE` 无效/缺字段。
- **403**：上游 token 无效或过期（可能透传上游 `status + text`，不保证标准 JSON）。
- **400 Improperly formed request**：很可能打到了旧进程；先确认端口监听进程并重启。

快速排查端口占用：

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

