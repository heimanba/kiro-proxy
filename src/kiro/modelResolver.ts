export function resolveKiroModelId(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;

  const lower = raw.toLowerCase();

  // Claude Code (and other tools) often default to "*-latest" model IDs.
  // Kiro may not recognize these, but it does support a generic "auto" model.
  if (lower.endsWith("-latest")) {
    return "auto";
  }

  // Normalize common Claude naming variants:
  // - "claude-sonnet-4-6" -> "claude-sonnet-4.6"
  // - "claude-opus-4-5" -> "claude-opus-4.5"
  // Keep other model IDs untouched (e.g. DeepSeek / Qwen IDs).
  const m = /^claude-(sonnet|opus|haiku)-(\d+)(?:[.-](\d+))?(?:[.-].*)?$/i.exec(raw);
  if (m) {
    const family = m[1]!.toLowerCase();
    const major = m[2]!;
    const minor = m[3];
    if (minor) return `claude-${family}-${major}.${minor}`;
    return `claude-${family}-${major}`;
  }

  return raw;
}

