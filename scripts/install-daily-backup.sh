#!/bin/sh
# Installs a macOS launchd job: encrypted production backup daily at 02:30 (runs on wake if the Mac was asleep).
# Remove with: launchctl bootout gui/$(id -u)/com.<INSTANCE_NAME>.backup && rm ~/Library/LaunchAgents/com.<INSTANCE_NAME>.backup.plist
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
. ./scripts/instance.sh
label="com.$(instance_name production).backup"
plist="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>$label</string>
 <key>ProgramArguments</key><array><string>/bin/sh</string><string>$root/scripts/backup.sh</string><string>production</string></array>
 <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
 <key>StandardOutPath</key><string>$root/backups/backup.log</string>
 <key>StandardErrorPath</key><string>$root/backups/backup.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
printf 'Daily backup scheduled for 02:30. Test now: launchctl kickstart gui/%s/%s\n' "$(id -u)" "$label"
