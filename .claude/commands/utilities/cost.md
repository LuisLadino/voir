---
description: Show Claude Code token cost rollups by project, month, or session. Wraps ccusage. Use for "what did I spend", "cost this month", or "which project costs most".
---

# /cost - Token Cost Rollups

Show how much Claude Code is costing, broken down by project. Reads JSONL transcripts at `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl` via [ccusage](https://github.com/ryoppippi/ccusage). Pricing data auto-pulls from LiteLLM at runtime, so the table reflects current model prices without manual maintenance.

```
/cost                        # This month, by project. Default with no args.
/cost ytd                    # Year-to-date, by project
/cost month YYYY-MM          # Specific month, by project
/cost daily                  # Last 30 days, daily breakdown by project
/cost session                # Recent sessions, by session
/cost total                  # YTD total, no breakdown
```

## When Luis runs /cost

Always invoke ccusage with `--json` so the output is structured. Avoids ANSI-color truncation and unreadable terminal tables.

The JSON shape: top-level `projects` keyed by encoded directory path, with daily entries containing `totalCost`, `totalTokens`, `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `modelBreakdowns`. Plus a `totals` block.

### Pinned ccusage version

Use `ccusage@18.0.11`, not `ccusage@latest`. Pinning prevents supply-chain risk from automatic upgrades. Update the pin deliberately after reading the changelog. The pin appears in every invocation below.

### Validate user input before substituting into shell

Before substituting any user-supplied argument into a bash command, validate it. Reject and abort if the format does not match exactly.

- `month YYYY-MM`: must match `^20\d{2}-(0[1-9]|1[0-2])$`. Reject with "Invalid month. Format YYYY-MM, e.g. 2026-04." and stop.
- Project name filter: must match `^[a-zA-Z0-9_-]+$`. Reject anything containing whitespace, quotes, semicolons, or shell metacharacters.

NEVER interpolate raw user text into a bash command. Compute the safe value in your reasoning, then pass the digit-only or alphanumeric-only result.

### Date math is portable, not BSD-only

`date -v1d` is BSD-only and silently fails on Linux. Use Python for date math instead. It works on macOS and Linux.

First-of-this-month:
```bash
python3 -c "from datetime import date; print(date.today().replace(day=1).strftime('%Y%m%d'))"
```

30-days-ago:
```bash
python3 -c "from datetime import date, timedelta; print((date.today() - timedelta(days=30)).strftime('%Y%m%d'))"
```

First and last day of a validated `YYYY-MM`:
```bash
python3 -c "
import sys
from datetime import date
from calendar import monthrange
y, m = map(int, sys.argv[1].split('-'))
last = monthrange(y, m)[1]
print(f'{y:04d}{m:02d}01', f'{y:04d}{m:02d}{last:02d}')
" 2026-04
```

### Default with no args. This month by project.

Compute first-of-month into `SINCE`, then run:
```bash
SINCE=$(python3 -c "from datetime import date; print(date.today().replace(day=1).strftime('%Y%m%d'))")
npx -y ccusage@18.0.11 daily --instances --since "$SINCE" --json
```

Parse the JSON. For each project, sum `totalCost` and `totalTokens` across all daily entries. Translate encoded keys to readable names per the Principles section below. Present a table with Project, Tokens, Cost columns. Sort descending by Cost. Include a Total row at the bottom.

If ccusage returns a JSON list `[]` instead of an object with a `projects` key, the date range has no data. Respond with "No usage data for that range" and stop.

### `/cost ytd` — year-to-date by project

```bash
npx -y ccusage@18.0.11 daily --instances --since 20260101 --json
```

Same parse and format as default, year-to-date.

### `/cost month YYYY-MM` — specific month

After validation, compute SINCE and UNTIL:
```bash
read SINCE UNTIL <<< $(python3 -c "
import sys
from datetime import date
from calendar import monthrange
y, m = map(int, sys.argv[1].split('-'))
last = monthrange(y, m)[1]
print(f'{y:04d}{m:02d}01', f'{y:04d}{m:02d}{last:02d}')
" "$VALIDATED_MONTH")
npx -y ccusage@18.0.11 daily --instances --since "$SINCE" --until "$UNTIL" --json
```

Same parse and format.

### `/cost daily` — last 30 days

```bash
SINCE=$(python3 -c "from datetime import date, timedelta; print((date.today() - timedelta(days=30)).strftime('%Y%m%d'))")
npx -y ccusage@18.0.11 daily --instances --since "$SINCE" --json
```

For the daily view, show per-day rows grouped by project. Don't aggregate across days. Use a date column.

### `/cost session` — recent sessions

```bash
npx -y ccusage@18.0.11 session --json
```

Show recent sessions with their cost. Sort descending by date.

### `/cost total` — YTD total only

```bash
npx -y ccusage@18.0.11 monthly --json
```

Sum `totalCost` across all entries. Report just the year-to-date number.

### When ccusage fails

ccusage can fail for several reasons. Detect the failure mode and respond accordingly. NEVER claim success when output shows failure.

- **Non-zero exit code:** Print stderr verbatim. Stop. Do not produce a fake table.
- **`npx` not available:** Try `bunx ccusage@18.0.11` as fallback. If neither works, instruct Luis to install Node or Bun.
- **JSON parse failure:** Show the first 500 characters of raw output and say "ccusage returned non-JSON output, possibly an error message." Stop.
- **`~/.claude/projects/` missing:** Tell Luis "No Claude Code transcripts found at `~/.claude/projects/`. Either Claude Code has never run on this machine, or the path is non-standard."
- **Network unreachable for LiteLLM price fetch:** ccusage falls back to cached prices. Note in output: "Pricing data may be stale, LiteLLM unreachable."
- **Pricing fetch returns malformed data:** ccusage may compute wrong dollar figures. If totals seem off by orders of magnitude, suspect this and recommend offline mode (`--offline`) or comparison against Anthropic Console.

## What This Command Does NOT Do

- **Real-time alerts.** Out of scope per #392 DoD.
- **Per-skill or per-issue breakdowns.** Per-project is the unit.
- **Multi-tenant attribution for thread 2.** Tracked as #393 and #394.
- **ROI-per-hour quantification.** That belongs to the `roi-per-hour` skill.

## Principles

- **Reconcile with Anthropic Console.** Output should match Anthropic's billing total. Surface any discrepancy greater than $1 or 5% (whichever is larger).
- **Show real numbers.** No rounding. No truncation. No omission.
- **Translate encoded paths dynamically.** ccusage encodes absolute project paths by replacing `/` with `-`. To recover a readable name, compute the encoded form of `$HOME/Repositories/Personal/` and `$HOME/Repositories/Work/` at runtime, then strip those prefixes from each project key. What remains is the project name. If a path doesn't match a known parent dir, leave it as-is and note the unexpected location. Do not hardcode user-specific path components.
- **Fold dispatch worktrees into their parent.** Encoded paths matching `<parent>--claude-worktrees-dispatch-<sha>` are dispatch worker subdirectories of `<parent>`. Sum their costs into the parent project, do not list them separately. The parent attribution is what Luis cares about.
- **Sort by cost descending.** Highest-cost project first.
- **Total line at the bottom.** Always include the rollup.

## Trust Dependencies

- **ccusage** at the pinned version. Read the changelog before bumping the pin.
- **LiteLLM price-table** auto-fetched at runtime. If LiteLLM's repo is compromised or the network MITM'd, prices become attacker-controlled. Production harm is bounded to wrong dollar figures, not RCE. The reconciliation principle catches material drift.
- **`~/.claude/projects/`** is the authoritative data source. ccusage reads it but does not write to it.

## Substrate-Decision-Triggers Queries

`.claude/specs/architecture/substrate-decision-triggers.md` Layer 3 and 4 reference cost data this command produces. When Luis asks substrate-decision questions like "is cost per inquiry trending up", run `/cost daily` over the relevant window. Pull `totalCost` per day, compute a 7-day rolling average, compare current week to prior week. These are derived metrics, not raw rollups, so they don't get pre-baked into this command.

## Examples

**User:** `/cost`
→ Show this month's spend by project, sorted by cost descending, with a Total line.

**User:** `/cost ytd`
→ Show year-to-date spend by project across 2026.

**User:** `/cost month 2026-04`
→ Validate format. Show April 2026 spend by project.

**User:** `/cost daily`
→ Show ccusage's native daily breakdown for the last 30 days.

**User:** `what did claude-kit cost this month`
→ Run `/cost` and read out just the claude-kit row.

**User:** `which project is costing the most`
→ Run `/cost` and report the top entry with the dollar amount.

**User:** `compare this month to last month`
→ Run `/cost` for this month and `/cost month YYYY-MM` for last month. Present side by side.

## Adding A New Project

Nothing to add. ccusage discovers projects from `~/.claude/projects/` automatically. Any new project Luis works in shows up in `/cost` output as soon as the first Claude Code session writes a JSONL transcript there.
