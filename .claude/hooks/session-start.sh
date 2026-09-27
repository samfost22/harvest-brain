#!/bin/bash
# Installs dependencies so tests, lint and the build work in Claude Code on the web sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
# npm install (not npm ci) keeps what the cached container already has and only fills gaps.
npm install --no-audit --no-fund
