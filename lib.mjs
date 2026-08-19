// Shared core: config loading, Claude classification, ntfy push, audit trail.
// Used by watcher.mjs (CDP mode) and server.mjs (extension mode).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

// ---- config: .env file (next to this script), real env vars win ----
try {
  for (const line of readFileSync(new URL(".env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const EVENT_DESCRIPTION =
  process.env.EVENT_DESCRIPTION ?? "a new incoming email arrived in the inbox";
const RULES_FILE = process.env.WATCH_RULES_FILE ?? new URL("WATCH_RULES.md", import.meta.url).pathname;
let RULES;
try { RULES = readFileSync(RULES_FILE, "utf8").trim(); } catch { RULES = EVENT_DESCRIPTION; }

export const cfg = {
  TARGET_URL_PATTERN: process.env.TARGET_URL_PATTERN ?? "mail.google.com",
  NTFY_TOPIC: process.env.NTFY_TOPIC,
  POLL_MS: Number(process.env.POLL_MS ?? 20_000),
  CDP_PORT: Number(process.env.CDP_PORT ?? 9222),
  DRY_RUN: !!process.env.DRY_RUN,
  RULES,
  RULES_SOURCE: RULES === EVENT_DESCRIPTION ? `EVENT_DESCRIPTION ("${EVENT_DESCRIPTION}")` : RULES_FILE,
};
if (!cfg.NTFY_TOPIC) {
  console.error("NTFY_TOPIC is not set. Copy .env.example to .env and pick your own topic (see README).");
  process.exit(1);
}

const EVENTS_LOG = new URL("events.jsonl", import.meta.url).pathname;
const MAX_DIFF_CHARS = 8_000;

export const stats = { polls: 0, changes: 0, claudeCalls: 0, pings: 0 };
export const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
export const logStartup = (mode) => {
  log(`${mode} | rules: ${cfg.RULES_SOURCE}`);
  log(`ntfy topic: ${cfg.NTFY_TOPIC}${cfg.DRY_RUN ? " | DRY RUN (no pings)" : ""}`);
  log(`event audit trail: ${EVENTS_LOG}`);
};

export function diffLines(oldText, newText) {
  const oldSet = new Set(oldText.split("\n"));
  const newSet = new Set(newText.split("\n"));
  const added = [...newSet].filter((l) => l.trim() && !oldSet.has(l));
  const removed = [...oldSet].filter((l) => l.trim() && !newSet.has(l));
  return { added, removed };
}

function classify(added, removed) {
  const prompt = `You are a screen-change classifier watching a web page. Ping-worthy events are defined by these rules:

<rules>
${cfg.RULES}
</rules>

Lines that just APPEARED on the page:
${added.join("\n").slice(0, MAX_DIFF_CHARS) || "(none)"}

Lines that just DISAPPEARED:
${removed.join("\n").slice(0, MAX_DIFF_CHARS) || "(none)"}

Did a ping-worthy event just happen per the rules? Reply with exactly "YES: <one-line summary under 150 chars>" or "NO: <one-line reason under 100 chars>". Nothing else.`;
  stats.claudeCalls++;
  return execFileSync("claude", ["-p", prompt, "--model", "haiku"], {
    encoding: "utf8",
    timeout: 120_000,
  }).trim();
}

async function ping(summary) {
  await fetch(`https://ntfy.sh/${cfg.NTFY_TOPIC}`, {
    method: "POST",
    headers: { Title: "Screen Sentinel", Priority: "high", Tags: "bell" },
    body: summary,
  });
  stats.pings++;
}

// A screen change happened: classify it, ping on YES, append to the audit trail.
export async function handleChange(added, removed) {
  stats.changes++;
  const verdict = classify(added, removed);
  log(`claude: ${verdict}`);
  const isYes = verdict.startsWith("YES");
  if (isYes && !cfg.DRY_RUN) {
    const summary = verdict.replace(/^YES:?\s*/, "") || "watched event happened";
    await ping(summary);
    log(`pinged phone: ${summary}`);
  } else if (isYes) {
    log(`[dry-run] would have pinged`);
  }
  const pinged = isYes && !cfg.DRY_RUN;
  appendFileSync(EVENTS_LOG, JSON.stringify({
    ts: new Date().toISOString(), added, removed, verdict, pinged,
  }) + "\n");
  return { verdict, pinged };
}
