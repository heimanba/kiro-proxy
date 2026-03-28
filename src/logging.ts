export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = Record<string, unknown>;

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const levelUpper: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

function parseLogLevel(raw: string | undefined): LogLevel {
  const v = (raw ?? "info").toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return v;
  return "info";
}

export type Logger = {
  level: LogLevel;
  debug: (msg: string, fields?: LogRecord) => void;
  info: (msg: string, fields?: LogRecord) => void;
  warn: (msg: string, fields?: LogRecord) => void;
  error: (msg: string, fields?: LogRecord) => void;
};

function formatLocalTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function shouldLog(current: LogLevel, target: LogLevel): boolean {
  return levelOrder[target] >= levelOrder[current];
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ msg: "Failed to serialize log record" });
  }
}

/** Parse one V8/Bun stack line into file basename (no ext), function name, line number. */
function parseStackLine(line: string): { module: string; fn: string; line: number } | null {
  const fileLine = line.match(/([^/\\]+\.[jt]sx?):(\d+)/);
  if (!fileLine?.[1] || fileLine[2] === undefined) return null;

  const moduleName = fileLine[1].replace(/\.(ts|tsx|js|jsx)$/, "");
  const lineNum = parseInt(fileLine[2], 10);

  const withFn = line.match(/at (?:async )?([^(]+?)\s+\(([^)]+)\)/);
  if (withFn?.[1] !== undefined && withFn[2] !== undefined) {
    const fn = withFn[1].trim();
    if (withFn[2].includes(fileLine[1])) {
      return { module: moduleName, fn, line: lineNum };
    }
  }

  return { module: moduleName, fn: "<anonymous>", line: lineNum };
}

function getCallerLocation(): string {
  const stack = new Error().stack ?? "";
  const lines = stack.split("\n");
  for (const line of lines) {
    if (!line.includes(".ts") && !line.includes(".tsx") && !line.includes(".js")) continue;
    if (line.includes("logging.ts:") || line.includes("/logging.ts") || line.includes("\\logging.ts")) continue;
    const loc = parseStackLine(line);
    if (loc) return `${loc.module}:${loc.fn}:${loc.line}`;
  }
  return "unknown:unknown:0";
}

const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
};

function useColor(): boolean {
  return Boolean(process.stderr.isTTY && !process.env.NO_COLOR);
}

function colorizeLevel(level: LogLevel, text: string): string {
  if (!useColor()) return text;
  switch (level) {
    case "error":
      return `${ANSI.red}${text}${ANSI.reset}`;
    case "warn":
      return `${ANSI.yellow}${text}${ANSI.reset}`;
    case "debug":
      return `${ANSI.gray}${text}${ANSI.reset}`;
    default:
      return `${ANSI.white}${text}${ANSI.reset}`;
  }
}

function formatLogLine(level: LogLevel, msg: string, fields?: LogRecord): string {
  const time = formatLocalTime(new Date());
  const levelPadded = levelUpper[level].padEnd(8, " ");
  const location = getCallerLocation();
  const fieldsPart =
    fields !== undefined && Object.keys(fields).length > 0 ? ` ${safeJson(fields)}` : "";

  if (!useColor()) {
    return `${time} | ${levelPadded} | ${location} - ${msg}${fieldsPart}`;
  }

  const timeColored = `${ANSI.green}${time}${ANSI.reset}`;
  const locColored = `${ANSI.cyan}${location}${ANSI.reset}`;
  const levelColored = colorizeLevel(level, levelPadded);
  const msgColored = colorizeLevel(level, msg);
  return `${timeColored} | ${levelColored} | ${locColored} - ${msgColored}${fieldsPart}`;
}

function write(level: LogLevel, msg: string, fields?: LogRecord) {
  const line = formatLogLine(level, msg, fields);
  console.error(line);
}

export function createLogger(env: Record<string, string | undefined> = process.env): Logger {
  const level = parseLogLevel(env.LOG_LEVEL);

  const logFn = (target: LogLevel) => (msg: string, fields?: LogRecord) => {
    if (!shouldLog(level, target)) return;
    write(target, msg, fields);
  };

  return {
    level,
    debug: logFn("debug"),
    info: logFn("info"),
    warn: logFn("warn"),
    error: logFn("error"),
  };
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function maskSecret(value: string, options?: { keepStart?: number; keepEnd?: number }): string {
  const keepStart = options?.keepStart ?? 6;
  const keepEnd = options?.keepEnd ?? 4;
  const v = value.trim();
  if (v.length <= keepStart + keepEnd + 3) return "***";
  return `${v.slice(0, keepStart)}***${v.slice(v.length - keepEnd)}`;
}

export function getHeaderMasked(headers: Headers, name: string): string | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  return maskSecret(raw);
}

export function getAuthHeadersMasked(headers: Headers): { authorization?: string; xApiKey?: string } {
  const authorization = headers.get("authorization");
  const xApiKey = headers.get("x-api-key");

  return {
    authorization: authorization ? maskSecret(authorization) : undefined,
    xApiKey: xApiKey ? maskSecret(xApiKey) : undefined,
  };
}

export function errorToLogFields(error: unknown): LogRecord {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      // Stack is very useful for debugging; keep it but avoid exploding log size.
      errorStack: error.stack ? String(error.stack).slice(0, 8000) : undefined,
    };
  }
  return { error: String(error) };
}
