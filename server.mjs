#!/usr/bin/env node
// Extension mode: local endpoint for the extension/ content script.
// The extension does the free in-browser diffing; this server does the paid part
// (Claude classification + ntfy ping). Binds to localhost only.
import { createServer } from "node:http";
import { cfg, handleChange, heartbeat, log, logStartup, stats } from "./lib.mjs";

const PORT = Number(process.env.SENTINEL_PORT ?? 8790);

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  try {
    if (req.method === "OPTIONS") return res.end();
    if (req.method === "GET" && req.url === "/heartbeat") {
      heartbeat();
      return res.end("ok");
    }
    if (req.method === "GET" && req.url === "/config") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ pattern: cfg.TARGET_URL_PATTERN, pollMs: cfg.POLL_MS }));
    }
    if (req.method === "POST" && req.url === "/event") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { url, added = [], removed = [] } = JSON.parse(body);
      log(`change from ${url} (+${added.length}/-${removed.length} lines), asking Claude...`);
      const result = await handleChange(added, removed);
      log(`stats: ${stats.changes} changes, ${stats.claudeCalls} claude calls, ${stats.pings} pings`);
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(result));
    }
    res.statusCode = 404;
    res.end();
  } catch (err) {
    log(`request failed: ${err.message}`);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, "127.0.0.1", () => {
  logStartup(`extension mode: listening on http://localhost:${PORT}, watching "${cfg.TARGET_URL_PATTERN}"`);
});
