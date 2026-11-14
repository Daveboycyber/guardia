/**
 * Structured logger. Human-readable by default; set GUARDIA_LOG=json for
 * one JSON object per line (pipe into jq, Loki, Datadog, etc).
 */
type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const JSON_MODE = process.env.GUARDIA_LOG === "json";

function fmtValue(v: unknown): string {
  if (typeof v === "string") return /\s/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === "bigint") return v.toString();
  return JSON.stringify(v);
}

export function log(level: Level, event: string, fields: Fields = {}) {
  const ts = new Date().toISOString();
  if (JSON_MODE) {
    const line = JSON.stringify({ ts, level, event, ...fields }, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    (level === "error" ? console.error : console.log)(line);
    return;
  }
  const kv = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${fmtValue(v)}`)
    .join(" ");
  const tag = level === "info" ? "" : ` ${level.toUpperCase()}`;
  const line = `${ts.slice(11, 19)}${tag} ${event}${kv ? `  ${kv}` : ""}`;
  (level === "error" ? console.error : console.log)(line);
}
