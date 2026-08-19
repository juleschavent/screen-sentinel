#!/usr/bin/env node
// CDP mode: poll a Chrome tab's text over the DevTools protocol, wake Claude on change.
// Needs Chrome launched with --remote-debugging-port (loud on managed machines);
// prefer extension mode (server.mjs + extension/) for daily use. Used by test.mjs.
import { cfg, diffLines, handleChange, log, logStartup, stats } from "./lib.mjs";

let lastText = null;

async function readTabText() {
  const targets = await (await fetch(`http://localhost:${cfg.CDP_PORT}/json`)).json();
  const tab = targets.find(
    (t) => t.type === "page" && t.url.includes(cfg.TARGET_URL_PATTERN)
  );
  if (!tab) throw new Error(`no tab matching "${cfg.TARGET_URL_PATTERN}"`);
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
  log(`change detected (+${added.length}/-${removed.length} lines), asking Claude...`);
  await handleChange(added, removed);
}

logStartup(`CDP mode: watching "${cfg.TARGET_URL_PATTERN}" every ${cfg.POLL_MS / 1000}s`);
while (true) {
  try {
    await poll();
  } catch (err) {
    log(`poll failed: ${err.message} (retrying next cycle)`);
  }
  log(`stats: ${stats.polls} polls, ${stats.changes} changes, ${stats.claudeCalls} claude calls, ${stats.pings} pings`);
  await new Promise((r) => setTimeout(r, cfg.POLL_MS));
}
