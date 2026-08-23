#!/bin/sh
# Installs a launchd agent so server.mjs starts at login and restarts on crash.
# Run from the repo: ./launchd-install.sh   Uninstall line is printed at the end.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)" || { echo "node not on PATH"; exit 1; }
CLAUDE="$(command -v claude)" || { echo "claude not on PATH"; exit 1; }
PLIST="$HOME/Library/LaunchAgents/com.screen-sentinel.plist"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.screen-sentinel</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$DIR/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/bin:/bin</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/server.log</string>
</dict></plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed and started: $PLIST"
echo "logs:      tail -f $DIR/server.log"
echo "uninstall: launchctl unload $PLIST && rm $PLIST"
