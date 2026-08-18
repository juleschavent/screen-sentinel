#!/usr/bin/env node
// End-to-end self-check: headless Chrome + fake inbox -> watcher detects a new
// "mail" line -> Claude classifies YES -> ntfy ping fires. Exits 0 on pass.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9223;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const kids = [];
const die = (msg, code) => { kids.forEach((k) => k.kill()); console.log(msg); process.exit(code); };

async function cdpEval(expression) {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const tab = targets.find((t) => t.type === "page");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const reply = new Promise((res) => { ws.onmessage = (e) => res(JSON.parse(e.data)); });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
  await reply;
  ws.close();
}

// 1. throwaway Chrome
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "sentinel-test-"))}`, "about:blank",
]);
kids.push(chrome);
for (let i = 0; ; i++) {
  try { await fetch(`http://localhost:${PORT}/json/version`); break; }
  catch { if (i > 20) die("FAIL: chrome never opened CDP port", 1); await new Promise((r) => setTimeout(r, 500)); }
}
await cdpEval(`document.body.innerText = "Inbox\\nMail from Alice: lunch plans"`);

// 2. watcher against the fake inbox
const watcher = spawn("node", [new URL("watcher.mjs", import.meta.url).pathname], {
  env: { ...process.env, CDP_PORT: String(PORT), TARGET_URL_PATTERN: "about:blank", POLL_MS: "2000" },
});
kids.push(watcher);
let out = "";
watcher.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
watcher.stderr.on("data", (d) => process.stderr.write(d));

const waitFor = async (needle, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (!out.includes(needle)) {
    if (Date.now() > deadline) die(`FAIL: never saw "${needle}"`, 1);
    await new Promise((r) => setTimeout(r, 500));
  }
};

await waitFor("baseline captured", 15_000);

// 3. a new mail arrives
await cdpEval(`document.body.innerText += "\\nNew mail from Bob: Test subject"`);
await waitFor("pinged phone", 180_000);

die("PASS: change -> Claude YES -> ntfy ping", 0);
