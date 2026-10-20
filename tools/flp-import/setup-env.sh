#!/usr/bin/env bash
# Recreate the throwaway Python environment for the .flp pipeline.
# /tmp does not survive between sandbox sessions, so run this once per
# session before using the tools in this folder. Idempotent.
set -euo pipefail
VENV=/tmp/flpvenv
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q -r "$(dirname "$0")/requirements.txt"
"$VENV/bin/python" -c "import pyflp, mido; print('flp-import env ready:', '$VENV/bin/python')"
