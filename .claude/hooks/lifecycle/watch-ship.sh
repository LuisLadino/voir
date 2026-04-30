#!/usr/bin/env bash
# watch-ship.sh — Post-commit verification for the /commit skill.
#
# Usage: bash watch-ship.sh <PR_NUMBER>
#
# Spawned via the Monitor tool from the /commit skill. Watches CI for the
# PR, then verifies the deploy if a URL is configured in stack-config.yaml.
# Emits exactly one line to stdout on terminal state:
#
#   ✓  PR #N merged [+ deploy healthy]     — happy path
#   ✗  PR #N — CI failed or merge blocked   — needs action
#   ✗  PR #N merged but deploy unreachable  — needs revert or investigation
#
# Silent until the terminal event. Monitor surfaces each line as a
# notification, so the session gets a single event when the ship settles.

set -uo pipefail

PR="${1:-}"
if [ -z "$PR" ]; then
  echo "[ship] ✗ watch-ship.sh: no PR number given"
  exit 1
fi

# Validate PR arg is numeric. Prevents flag injection into gh commands
# (e.g., -R victim/repo), and a bad value fails fast instead of polling
# forever against a nonsense target.
if ! [[ "$PR" =~ ^[0-9]+$ ]]; then
  echo "[ship] ✗ watch-ship.sh: PR must be numeric, got: $PR"
  exit 1
fi

# Anchor file reads to the git root so the Monitor still finds
# stack-config.yaml when spawned from a subdirectory.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Read deploy URL from stack-config.yaml if configured.
# Looks for:
#   deploy:
#     url: "https://..."
DEPLOY_URL=""
DEPLOY_BLOCK_PRESENT=""
CONFIG="$ROOT/.claude/specs/stack-config.yaml"
if [ -f "$CONFIG" ]; then
  DEPLOY_BLOCK_PRESENT=$(awk '
    /^deploy:[[:space:]]*$/ { print "yes"; exit }
  ' "$CONFIG")
  DEPLOY_URL=$(awk '
    /^deploy:[[:space:]]*$/ { in_deploy = 1; next }
    in_deploy && /^[^[:space:]]/ { in_deploy = 0 }
    in_deploy && /^[[:space:]]+url:/ {
      sub(/^[[:space:]]+url:[[:space:]]*/, "")
      gsub(/["'"'"']/, "")
      sub(/[[:space:]]+$/, "")
      print
      exit
    }
  ' "$CONFIG")
fi

# If deploy: block is present but url is missing or malformed, that's a
# misconfiguration — surface it rather than silently skipping the check.
if [ -n "$DEPLOY_BLOCK_PRESENT" ] && [ -z "$DEPLOY_URL" ]; then
  echo "[ship] ✗ PR #$PR — stack-config.yaml has a deploy: block but no valid url. Fix the config or remove the block."
  exit 1
fi

# Validate DEPLOY_URL scheme. Blocks SSRF via file://, gopher://, etc.
# curl's --proto flag below is the real defense; this gives a clearer
# diagnostic when the config is wrong. Reject whitespace/newlines too.
if [ -n "$DEPLOY_URL" ]; then
  if ! [[ "$DEPLOY_URL" =~ ^https?:// ]] || [[ "$DEPLOY_URL" =~ [[:space:]] ]]; then
    echo "[ship] ✗ PR #$PR — stack-config.yaml deploy.url must start with http:// or https:// and contain no whitespace. Got: $DEPLOY_URL"
    exit 1
  fi
fi

# Wait for CI to reach a terminal state.
# gh pr checks --watch blocks until all checks complete. Exit 0 if all
# passed, non-zero if any failed. --fail-fast aborts early on first failure.
# `--` separates flags from the PR number, a defense-in-depth guard.
if ! gh pr checks --watch --fail-fast -- "$PR" > /dev/null 2>&1; then
  echo "[ship] ✗ PR #$PR — CI failed or merge blocked. Run: gh pr view $PR"
  exit 1
fi

# CI passed. Auto-merge completes shortly after. Poll mergeStateStatus to
# distinguish "still pending" from actually-failed. Give up to ~10 minutes
# total to accommodate busy repos with branch-protection rules.
merged="UNKNOWN"
for _ in $(seq 1 30); do
  read -r state merge_state <<<"$(gh pr view "$PR" --json state,mergeStateStatus --jq '[.state, .mergeStateStatus] | @tsv' 2>/dev/null || echo "UNKNOWN UNKNOWN")"
  if [ "$state" = "MERGED" ]; then
    merged="MERGED"
    break
  fi
  # Terminal bad states: closed without merging, or blocked and not progressing.
  if [ "$state" = "CLOSED" ]; then
    echo "[ship] ✗ PR #$PR — closed without merging. Investigate: gh pr view $PR"
    exit 1
  fi
  if [ "$merge_state" = "DIRTY" ] || [ "$merge_state" = "BLOCKED" ]; then
    echo "[ship] ✗ PR #$PR — merge blocked ($merge_state). Investigate: gh pr view $PR"
    exit 1
  fi
  if [ "$merge_state" = "BEHIND" ]; then
    echo "[ship] ✗ PR #$PR — branch behind base, rebase needed. Run: gh pr checkout $PR && git rebase origin/main"
    exit 1
  fi
  sleep 20
done

if [ "$merged" != "MERGED" ]; then
  echo "[ship] ✗ PR #$PR — CI passed but PR did not merge within 10 min. Investigate: gh pr view $PR"
  exit 1
fi

# No deploy check configured — we're done.
if [ -z "$DEPLOY_URL" ]; then
  echo "[ship] ✓ PR #$PR merged (no deploy check configured)"
  exit 0
fi

# Give the deploy pipeline time to start, then poll for HTTP 2xx.
# Start polling sooner with shorter first interval so fast deploys don't
# wait the full 45s. Total budget ~2.5 min.
sleep 20

status=""
for attempt in 1 2 3 4 5 6 7 8 9; do
  status=$(curl -sI --max-time 10 --proto '=https,http' --max-redirs 3 "$DEPLOY_URL" 2>/dev/null | awk '/^HTTP/ {print $2; exit}')
  if [[ "$status" =~ ^2 ]]; then
    echo "[ship] ✓ PR #$PR merged + deploy healthy ($DEPLOY_URL → HTTP $status)"
    exit 0
  fi
  # Shorter waits early, longer later.
  if [ "$attempt" -lt 3 ]; then sleep 10; else sleep 20; fi
done

echo "[ship] ✗ PR #$PR merged but deploy unreachable ($DEPLOY_URL). Last status: ${status:-no response}. Check logs or revert."
exit 1
