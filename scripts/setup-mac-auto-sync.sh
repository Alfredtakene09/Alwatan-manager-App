#!/usr/bin/env bash
# Installe une tâche launchd qui synchronise Git toutes les 5 minutes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYNC_SCRIPT="${ROOT}/scripts/mac-auto-sync.sh"
PLIST_LABEL="com.alwatan.manager.git-sync"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/alwatan-manager"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

if [ ! -x "${SYNC_SCRIPT}" ]; then
  chmod +x "${SYNC_SCRIPT}"
fi

mkdir -p "${LOG_DIR}" "${HOME}/Library/LaunchAgents"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SYNC_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd-stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "${DOMAIN}" "${PLIST_PATH}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST_PATH}"
launchctl enable "${DOMAIN}/${PLIST_LABEL}"

echo "✓ Auto-sync Git installé (${PLIST_LABEL})"
echo "  Dépôt  : ${ROOT}"
echo "  Script : ${SYNC_SCRIPT}"
echo "  Logs   : ${LOG_DIR}/git-sync.log"
echo "  Fréquence : toutes les 5 minutes + au démarrage de session"
echo ""
echo "Test manuel : ${SYNC_SCRIPT}"
echo "Désinstaller : launchctl bootout ${DOMAIN} ${PLIST_PATH} && rm ${PLIST_PATH}"

"${SYNC_SCRIPT}"
