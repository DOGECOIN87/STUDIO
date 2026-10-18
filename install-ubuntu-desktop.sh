#!/usr/bin/env bash
# Installs a desktop entry for PulseForge DAW in Ubuntu's Application Menu
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "${SCRIPT_DIR}/run-ubuntu.sh"

APPS_DIR="${HOME}/.local/share/applications"
mkdir -p "${APPS_DIR}"

DESKTOP_FILE="${APPS_DIR}/pulseforge-daw.desktop"
cat > "${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=PulseForge DAW
Comment=Ubuntu Playlist & Audio Arrangement Workstation
Exec=${SCRIPT_DIR}/run-ubuntu.sh
Path=${SCRIPT_DIR}
Terminal=false
Categories=AudioVideo;Audio;Sequencer;
StartupNotify=true
EOF

chmod +x "${DESKTOP_FILE}"
echo "Installed Ubuntu desktop launcher: ${DESKTOP_FILE}"
