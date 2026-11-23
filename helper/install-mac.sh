#!/bin/zsh
# Keeps the helper running on this Mac: starts it at login and restarts it if it stops (launchd).
#   ./install-mac.sh            install or update
#   ./install-mac.sh remove     stop and remove it
cd "${0:A:h}"; KIT="$PWD"; LABEL=com.whatsapp-agent-kit; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [[ "$1" == "remove" ]]; then launchctl bootout gui/$(id -u) "$PLIST" 2>/dev/null; rm -f "$PLIST"; echo "Removed. Your files and chat history are untouched."; exit 0; fi
NODE=$(command -v node); [[ -z "$NODE" ]] && { echo "Node.js isn't installed. Get it from nodejs.org (version 20 or newer), then run this again."; exit 1; }
[[ -f config.json ]] || { echo "Make config.json first (copy config.example.json)."; exit 1; }
mkdir -p logs "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$KIT/agent.mjs</string></array>
  <key>WorkingDirectory</key><string>$KIT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${NODE:h}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$KIT/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$KIT/logs/launchd-errors.log</string>
</dict></plist>
PL
launchctl bootout gui/$(id -u) "$PLIST" 2>/dev/null
launchctl bootstrap gui/$(id -u) "$PLIST" && echo "Installed. The helper is running; watch it with: tail -f \"$KIT/logs/agent.log\""
