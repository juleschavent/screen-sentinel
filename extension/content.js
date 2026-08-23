// Screen Sentinel content script: free in-browser tier.
// Polls this page's visible text, line-diffs it, and POSTs changes to the local
// sentinel server, which runs the Claude classification and the phone ping.
// Inert unless the server is running AND this page's URL matches its pattern.
(async () => {
  const SERVER = "http://localhost:8790";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fetch config, retrying quietly so a tab opened before the server still attaches.
  let cfg;
  while (true) {
    try { cfg = await (await fetch(`${SERVER}/config`)).json(); break; }
    catch { await sleep(15000); }
  }
  if (!location.href.includes(cfg.pattern)) return;
  console.log(`[screen-sentinel] watching this tab (poll every ${cfg.pollMs / 1000}s)`);

  let last = null;
  setInterval(async () => {
    fetch(`${SERVER}/heartbeat`).catch(() => {});
    const text = document.body.innerText;
    if (last === null) { last = text; console.log("[screen-sentinel] baseline captured"); return; }
    const oldSet = new Set(last.split("\n"));
    const newSet = new Set(text.split("\n"));
    const added = [...newSet].filter((l) => l.trim() && !oldSet.has(l));
    const removed = [...oldSet].filter((l) => l.trim() && !newSet.has(l));
    last = text;
    if (!added.length && !removed.length) return;
    try {
      const res = await fetch(`${SERVER}/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: location.href, added, removed }),
      });
      console.log("[screen-sentinel]", (await res.json()).verdict);
    } catch (err) {
      console.warn("[screen-sentinel] server unreachable, change dropped:", err.message);
    }
  }, cfg.pollMs);
})();
