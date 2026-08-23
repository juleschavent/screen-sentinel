# Screen Sentinel

Watches a browser tab for a specific type of event and pushes a notification to your phone. Works on apps with **no API**: a free in-browser text diff detects "something changed", Claude (Haiku) wakes only on change to judge "is this the event?", and a `ntfy.sh` push fires on YES.

```
Chrome tab: extension/content.js polls visible text every 20s, line-diffs (free)
        | changed?
        v
server.mjs (localhost) --> claude -p (haiku): "ping-worthy per the rules? YES/NO"
        | YES
        v
ntfy.sh/<your-topic> --> phone
```

## Prerequisites (fresh machine)

- macOS with Google Chrome (any Chromium browser works for extension mode)
- Node.js 22+ (`node --version`)
- [Claude Code](https://claude.com/claude-code) installed and logged in (`claude -p "say hi"` must work) — every event classification is one cheap Haiku call
- ntfy app on your phone (iOS/Android, free, no account)

## Setup

1. Clone this repo.
2. `cp .env.example .env` and fill it in:
   - `NTFY_TOPIC`: pick an unguessable name (`sentinel-$(openssl rand -hex 4)`), subscribe to the same topic in the ntfy phone app. The name is the only access control — treat it like a password.
   - `TARGET_URL_PATTERN`: substring of the URL of the tab to watch (copy from the address bar of the logged-in app, e.g. `kustomerapp.com`, not the marketing site).
3. Load the extension in your normal Chrome: `chrome://extensions` → enable **Developer mode** (top right) → **Load unpacked** → select this repo's `extension/` folder.

## Watch rules

For anything richer than a one-sentence `EVENT_DESCRIPTION` (in `.env`), copy `WATCH_RULES.example.md` to `WATCH_RULES.md` (git-ignored) and write the rulebook in plain English: ping-worthy actions, explicit exclusions, edge cases. When `WATCH_RULES.md` exists it replaces `EVENT_DESCRIPTION` entirely — Claude judges every screen change against the file.

## Run

```sh
node server.mjs
```

Leave it running, and have the watched app open in a tab. The extension attaches to any tab whose URL matches `TARGET_URL_PATTERN` (badge of proof: `[screen-sentinel] watching this tab` in that tab's DevTools console) and reports changes; the server logs every change, Claude's verdict, and running counters. If the tab was opened before the server started, it attaches by itself within ~15s.

## Tuning / test mode

Every detected change is appended to `events.jsonl` (git-ignored): timestamp, the exact appeared/disappeared lines Claude saw, its verdict (`YES: summary` or `NO: reason`), and whether a ping fired. Watch it live with:

```sh
tail -f events.jsonl | jq .
```

To tune without spamming your phone, run `DRY_RUN=1 node server.mjs`: everything works and logs normally, but no pings are sent. Typical loop: dry-run against the real app, do a few actions of each kind, read the verdicts in `events.jsonl`, edit `WATCH_RULES.md`, repeat.

## Test

```sh
node test.mjs
```

Asserts the full chain twice (one Haiku call each, one real ping to your topic per stage): once through CDP mode against a throwaway headless Chrome with a fake inbox, once through the server endpoint exactly as the extension calls it.

## Alternative: CDP mode (no extension)

`node watcher.mjs` polls the tab from outside the browser via the DevTools protocol instead. Needs a dedicated Chrome instance with a debugging port, which endpoint-security tools often flag — prefer extension mode on any managed machine:

```sh
open -na "Google Chrome" --args --user-data-dir="$HOME/.screen-sentinel-chrome" --remote-debugging-port=9222 --no-first-run
```

## A word on corporate laptops

This tool reads the watched page's content and sends changed text to Anthropic (classification) and event summaries to ntfy.sh (push). On a work machine, or pointed at an app with customer data, clear it with IT first — the design is easy to explain (localhost server, two known endpoints, full audit trail in `events.jsonl`), but it's their call.

## Hardening for real 9-to-5 use

All three are built in and off by default:

**Dead-man's switch.** The failure mode that matters is the watcher dying *silently* (laptop asleep, Chrome closed, server crashed) — no pings looks identical to no events. Fix: create a free check at [healthchecks.io](https://healthchecks.io) with a grace period of ~5 minutes, add its ping URL to `.env` as `HEARTBEAT_URL`, and in the check's settings add an **ntfy** integration pointing at your same topic. The extension heartbeats through the server every poll; the moment the chain goes quiet, your phone gets a "check is down" alert.

**Keep-alive.** `./launchd-install.sh` installs a launchd agent that starts `server.mjs` at login and restarts it if it crashes. Output goes to `server.log` (git-ignored). The script prints the uninstall command.

**Noise filter.** If the watched page has constantly-changing text (relative timestamps, counters, ads), set `IGNORE_REGEX` in `.env`. Changed lines matching it are dropped before Claude is called; if nothing is left, no call at all. Find candidates by watching `events.jsonl` in dry-run mode for `NO` verdicts that keep recurring.
