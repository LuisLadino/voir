#!/usr/bin/env bash
# watch-workers.sh — stream dispatch worker events for Monitor.
#
# Usage: bash watch-workers.sh
#
# Polls .claude/dispatch/*.jsonl under the current repo for new files, tails
# each, filters for key events, emits one line per event prefixed with the
# worker's session id. Monitor surfaces each line as a notification.
#
# Events surfaced:
#   [SESSION] tool_use:NAME              — worker invoked a tool
#   [SESSION] tool error                 — worker hit a tool_use error
#   [SESSION] PR: URL                    — PR URL detected
#   [SESSION] done status=X cost=$Y      — worker emitted its result event
#
# Resilience: picks up workers spawned after the script started (the original
# `tail -F $DIR/*.jsonl` glob-expanded once at invocation and missed them).
# Uses per-file tails spawned on demand and reaped on exit.

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DIR="$ROOT/.claude/dispatch"

# Track which files we've already started tailing to avoid duplicate tails
TRACKED_FILE="$(mktemp)"
trap 'rm -f "$TRACKED_FILE"; jobs -p | xargs -r kill 2>/dev/null' EXIT

emit_filter() {
  # Cheap prefilter: only run the expensive regexes on lines with "type":"
  awk -v sid="$1" '
    /"type":"/ {
      if (match($0, /"type":"tool_use","id":"[^"]*","name":"([^"]+)"/, t)) {
        printf "[%s] tool_use:%s\n", sid, t[1]
        fflush()
        next
      }
      if (match($0, /"type":"result","subtype":"([^"]+)"/, s)) {
        cost = "?"
        if (match($0, /"total_cost_usd":([0-9.]+)/, c)) cost = c[1]
        printf "[%s] done status=%s cost=$%s\n", sid, s[1], cost
        fflush()
        next
      }
    }
    /"is_error":true/ {
      printf "[%s] tool error\n", sid
      fflush()
      next
    }
    /github\.com\/[^/]+\/[^/]+\/pull\// {
      if (match($0, /github\.com\/[^\/]+\/[^\/]+\/pull\/[0-9]+/)) {
        printf "[%s] PR: %s\n", sid, substr($0, RSTART, RLENGTH)
        fflush()
      }
      next
    }
  '
}

# Wait for the dispatch dir to exist, then poll for new files.
WAIT_BUDGET=30
while [ ! -d "$DIR" ] && [ "$WAIT_BUDGET" -gt 0 ]; do
  sleep 1
  WAIT_BUDGET=$((WAIT_BUDGET - 1))
done
if [ ! -d "$DIR" ]; then
  echo "[dispatch] no dispatch dir — no workers fired"
  exit 0
fi

# Poll loop: every 2s, scan for new .jsonl files and spawn a tail for each.
# Each tail runs its own awk filter in the background and writes to stdout.
while true; do
  for f in "$DIR"/*.jsonl; do
    [ -f "$f" ] || continue
    if ! grep -qxF "$f" "$TRACKED_FILE" 2>/dev/null; then
      base="$(basename "$f")"
      sid="${base%.jsonl}"
      sid_short="${sid:0:8}"
      echo "$f" >> "$TRACKED_FILE"
      # Tail this file in the background; awk pipeline labels events with sid
      (tail -F -n 0 "$f" 2>/dev/null | emit_filter "$sid_short") &
    fi
  done
  sleep 2
done
