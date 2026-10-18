#!/usr/bin/env bash
# PulseForge DAW — Native Ubuntu Launcher (Works on both Wayland & Xorg)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3000}"
URL="http://127.0.0.1:${PORT}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required. Install on Ubuntu with: sudo apt install nodejs"
  exit 1
fi

# Check if already listening
if ! curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
  node "${SCRIPT_DIR}/app/server.mjs" &
  SERVER_PID=$!
  trap 'kill "${SERVER_PID}" >/dev/null 2>&1 || true' EXIT INT TERM

  for _ in $(seq 1 30); do
    if curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.15
  done
fi

echo "PulseForge DAW running at ${URL}"

# Launch in standalone desktop app window on Ubuntu if a browser is available
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
  for browser in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
    if command -v "$browser" >/dev/null 2>&1; then
      "$browser" --app="${URL}" --new-window >/dev/null 2>&1 &
      wait "${SERVER_PID:-}"
      exit 0
    fi
  done
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" >/dev/null 2>&1 || true
  fi
fi

if [ -n "${SERVER_PID:-}" ]; then
  wait "${SERVER_PID}"
fi
