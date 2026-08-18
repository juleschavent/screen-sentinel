# Screen Sentinel

Watches a browser tab for a specific type of event and pushes a notification to your phone. No API needed on the watched app: a free DOM-text diff detects "something changed", Claude (Haiku) wakes only on change to judge "is this the event?", and a `ntfy.sh` push fires on YES.

POC target: Gmail inbox, event = new incoming mail. Point it at anything by changing two strings.

## One-time setup

1. **Phone**: install the ntfy app (iOS/Android), subscribe to topic `jules-sentinel-f7f20e0b`.
2. **Launch the dedicated sentinel Chrome.** Chrome 136+ ignores `--remote-debugging-port` on your default profile (security), so the sentinel runs as a second Chrome instance with its own profile, alongside your normal Chrome:

   ```sh
   open -na "Google Chrome" --args --user-data-dir="$HOME/.screen-sentinel-chrome" --remote-debugging-port=9222 --no-first-run
   ```

   Verify with `curl http://localhost:9222/json/version` (expect JSON). First time only: log into the watched app (e.g. Gmail) in that window — the profile remembers it.

   Alias worth adding: `alias sentinel-chrome='open -na "Google Chrome" --args --user-data-dir="$HOME/.screen-sentinel-chrome" --remote-debugging-port=9222 --no-first-run'`

## Run

Open the target app in a tab (e.g. Gmail), then:

```sh
node watcher.mjs
```

Config knobs (env vars, defaults at the top of `watcher.mjs`):

| var | default | meaning |
|---|---|---|
| `TARGET_URL_PATTERN` | `mail.google.com` | substring matched against tab URLs |
| `EVENT_DESCRIPTION` | new incoming email in the inbox | what Claude looks for, plain English |
| `NTFY_TOPIC` | `jules-sentinel-f7f20e0b` | phone push channel (unguessable = access control) |
| `POLL_MS` | `20000` | free DOM poll interval |
| `CDP_PORT` | `9222` | Chrome debugging port |

To watch the real software later: set `TARGET_URL_PATTERN` and `EVENT_DESCRIPTION`. That's it.

## Test

```sh
node test.mjs
```

Spins up a throwaway headless Chrome with a fake inbox, appends a fake mail, and asserts the full chain (diff -> Claude YES -> ntfy ping). Costs one Haiku call and sends one real ping.

## Not built yet (add before real 9-to-5 use)

- Dead-man's switch: curl a healthchecks.io heartbeat each poll so you get alerted when the watcher itself dies.
- launchd keep-alive so it survives crashes/reboots.
- Noise filter: if the watched page has constantly-changing text (clocks, counters), add an ignore-regex so Claude isn't called every poll.
