import { loadConfigFromEnv } from "./src/config";
import { ConfigError } from "./src/errors";
import { startServer } from "./src/server";
import { createLogger } from "./src/logging";

const logger = createLogger();

try {
  const config = loadConfigFromEnv();
  const server = startServer(config);

  const credsSource = process.env.KIRO_ACCESS_TOKEN
    ? "KIRO_ACCESS_TOKEN"
    : process.env.KIRO_CREDS_FILE || config.kiroCredsFile
      ? "KIRO_CREDS_FILE"
      : "none";

  logger.info("server_started", {
    host: config.serverHost,
    port: config.serverPort,
    region: config.kiroRegion,
    credsSource,
    endpoints: [
      "GET /v1/models",
      "POST /v1/chat/completions (stream-only)",
      "POST /v1/messages (stream-only)",
    ],
  });

  // Keep reference to prevent GC in some runtimes (defensive).
  void server;
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    logger.error("server_start_failed", { reason: error.message, hint: "Service is not running" });
  } else {
    console.error(error);
    logger.error("server_start_failed", { reason: "Unknown error", error });
  }
  process.exit(1);
}