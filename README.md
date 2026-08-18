# Screen Sentinel

Watches a browser tab for a specific type of event and pushes a notification to your phone. Works on apps with **no API**: a free DOM-text diff detects "something changed", Claude (Haiku) wakes only on change to judge "is this the event?", and a `ntfy.sh` push fires on YES.

```
Chrome tab --CDP--> watcher.mjs (poll ~20s, free)
                        | text changed?
                        v
              claude -p (haiku): "is this <event>? YES/NO"
                        | YES
                        v
              ntfy.sh/<your-topic> --> phone
```

## Prerequisites (fresh machine)

- macOS with Google Chrome
- Node.js 22+ (`node --version`)
- [Claude Code](https://claude.com/claude-code) installed and logged in (`claude -p "say hi"` must work) — every event classification is one cheap Haiku call
- ntfy app on your phone (iOS/Android, free, no account)

## Setup

1. Clone this repo.
2. `cp .env.example .env` and fill it in:
   - `NTFY_TOPIC`: pick an unguessable name (`sentinel-$(openssl rand -hex 4)`), subscribe to the same topic in the ntfy phone app. The name is the only access control — treat it like a password.
   - `TARGET_URL_PATTERN`: substring of the URL of the tab to watch.
   - `EVENT_DESCRIPTION`: plain English; Claude judges each screen change against it.
3. **Launch the sentinel Chrome.** Chrome 136+ ignores `--remote-debugging-port` on your default profile (security), so the sentinel runs as a second Chrome instance with its own profile, alongside your normal Chrome:

   ```sh
   open -na "Google Chrome" --args --user-data-dir="$HOME/.screen-sentinel-chrome" --remote-debugging-port=9222 --no-first-run
   ```

   Verify with `curl http://localhost:9222/json/version` (expect JSON). First time only: log into the watched app (e.g. Gmail) in that window — the profile remembers it. Alias worth adding: `alias sentinel-chrome='open -na "Google Chrome" --args --user-data-dir="$HOME/.screen-sentinel-chrome" --remote-debugging-port=9222 --no-first-run'`

## Watch rules

For anything richer than a one-sentence `EVENT_DESCRIPTION`, copy `WATCH_RULES.example.md` to `WATCH_RULES.md` (git-ignored) and write the rulebook in plain English: ping-worthy actions, explicit exclusions, edge cases. When `WATCH_RULES.md` exists it replaces `EVENT_DESCRIPTION` entirely — Claude judges every screen change against the file.

## Tuning / test mode

Every detected change is appended to `events.jsonl` (git-ignored): timestamp, the exact appeared/disappeared lines Claude saw, its verdict (`YES: summary` or `NO: reason`), and whether a ping fired. This is the audit trail for tuning rules — watch it live with:

```sh
tail -f events.jsonl | jq .
```

To tune without spamming your phone, run with `DRY_RUN=1 node watcher.mjs`: everything works and logs normally, but no pings are sent. Typical loop: dry-run against the real app, do a few actions of each kind, read the verdicts in `events.jsonl`, edit `WATCH_RULES.md`, repeat.

## Run

Open the watched app in a tab of the sentinel Chrome, then:

```sh
node watcher.mjs
```

Leave it running in a terminal. It logs every poll cycle plus running counters (polls / changes / claude calls / pings), so you can confirm Claude only runs when the screen changed.

## Test

```sh
node test.mjs
```

Spins up a throwaway headless Chrome with a fake inbox, appends a fake mail, and asserts the full chain (diff -> Claude YES -> ntfy ping). Costs one Haiku call and sends one real ping to your topic.

## Not built yet (add before real 9-to-5 use)

- Dead-man's switch: curl a healthchecks.io heartbeat each poll so you get alerted when the watcher itself dies (laptop asleep, Chrome closed, crash).
- launchd keep-alive so watcher + sentinel Chrome survive crashes/reboots.
- Noise filter: if the watched page has constantly-changing text (clocks, counters), an ignore-regex so Claude isn't called every poll.
