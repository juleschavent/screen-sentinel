#!/usr/bin/env node
// Screen Sentinel: poll a Chrome tab's text over CDP, wake Claude only on change,
// push to phone via ntfy when Claude says the watched event happened.
// Zero dependencies (Node 22+: built-in fetch + WebSocket).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// ---- config: .env file (next to this script), real env vars win ----
try {
  for (const line of readFileSync(new URL(".env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const TARGET_URL_PATTERN = process.env.TARGET_URL_PATTERN ?? "mail.google.com";
const EVENT_DESCRIPTION =
  process.env.EVENT_DESCRIPTION ?? "a new incoming email arrived in the inbox";
const NTFY_TOPIC = process.env.NTFY_TOPIC;
if (!NTFY_TOPIC) {
  console.error("NTFY_TOPIC is not set. Copy .env.example to .env and pick your own topic (see README).");
  process.exit(1);
}
const POLL_MS = Number(process.env.POLL_MS ?? 20_000);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
const MAX_DIFF_CHARS = 8_000;

let lastText = null;
const stats = { polls: 0, changes: 0, claudeCalls: 0, pings: 0 };
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function readTabText() {
  const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
  const tab = targets.find(
    (t) => t.type === "page" && t.url.includes(TARGET_URL_PATTERN)
  );
  if (!tab) throw new Error(`no tab matching "${TARGET_URL_PATTERN}"`);
  // ponytail: fresh websocket per poll — simpler than a persistent session and
  // survives tab reloads for free; revisit only if 20s polling ever feels heavy
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  try {
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const reply = new Promise((res, rej) => {
      ws.onmessage = (e) => res(JSON.parse(e.data));
      ws.onerror = rej;
    });
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression: "document.body.innerText", returnByValue: true },
    }));
    return (await reply).result?.result?.value ?? "";
  } finally {
    ws.close();
  }
}

function diffLines(oldText, newText) {
  const oldSet = new Set(oldText.split("\n"));
  const newSet = new Set(newText.split("\n"));
  const added = [...newSet].filter((l) => l.trim() && !oldSet.has(l));
  const removed = [...oldSet].filter((l) => l.trim() && !newSet.has(l));
  return { added, removed };
}

function classify(added, removed) {
  const prompt = `You are a screen-change classifier watching a web page for one event type.
Watched event: ${EVENT_DESCRIPTION}

Lines that just APPEARED on the page:
${added.join("\n").slice(0, MAX_DIFF_CHARS) || "(none)"}

Lines that just DISAPPEARED:
${removed.join("\n").slice(0, MAX_DIFF_CHARS) || "(none)"}

Did the watched event just happen? Reply with exactly "NO", or "YES: <one-line summary under 150 chars>". Nothing else.`;
  stats.claudeCalls++;
  return execFileSync("claude", ["-p", prompt, "--model", "haiku"], {
    encoding: "utf8",
    timeout: 120_000,
  }).trim();
}

async function ping(summary) {
  await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    headers: { Title: "Screen Sentinel", Priority: "high", Tags: "bell" },
    body: summary,
  });
  stats.pings++;
}

async function poll() {
  stats.polls++;
  const text = await readTabText();
  if (lastText === null) {
    lastText = text;
    log(`baseline captured (${text.length} chars)`);
    return;
  }
  const { added, removed } = diffLines(lastText, text);
  lastText = text;
  if (!added.length && !removed.length) return;
  stats.changes++;
  log(`change detected (+${added.length}/-${removed.length} lines), asking Claude...`);
  const verdict = classify(added, removed);
  log(`claude: ${verdict}`);
  if (verdict.startsWith("YES")) {
    const summary = verdict.replace(/^YES:?\s*/, "") || EVENT_DESCRIPTION;
    await ping(summary);
    log(`pinged phone: ${summary}`);
  }
}

log(`watching "${TARGET_URL_PATTERN}" for: ${EVENT_DESCRIPTION}`);
log(`ntfy topic: ${NTFY_TOPIC} | poll every ${POLL_MS / 1000}s`);
while (true) {
  try {
    await poll();
  } catch (err) {
    log(`poll failed: ${err.message} (retrying next cycle)`);
  }
  log(`stats: ${stats.polls} polls, ${stats.changes} changes, ${stats.claudeCalls} claude calls, ${stats.pings} pings`);
  await new Promise((r) => setTimeout(r, POLL_MS));
}
