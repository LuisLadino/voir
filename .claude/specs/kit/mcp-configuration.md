---
name: mcp-configuration
description: >
  How MCP — Model Context Protocol — servers are configured across Claude
  Code projects. Three inheritance layers, when to use each, and what every
  project gets automatically.
applies_to: []
category: kit
source: https://code.claude.com/docs/en/mcp.md
---

# MCP Configuration

How Claude Code projects get access to tools beyond the built-in set.

## Three inheritance layers

Every Claude Code session resolves tools from three layers, in order of breadth:

**Layer 1 — Account-level Claude.ai connectors.** Shared across every device and every project tied to your Claude.ai account. Authorized once at `claude.ai/settings/connectors`. Surface in `/mcp` automatically as `mcp__claude_ai_*` tools.

- Gmail
- Google Calendar
- Google Drive

**Layer 2 — User-scope MCPs.** Defined in `~/.claude.json` root under `mcpServers`. Cross-project, private to your machine, not shared with teammates.

- `context7` — library docs + code search
- `antigravity` — image generation, browser automation, knowledge search

**Layer 3 — Project-specific sources.** Two variants:

- `.mcp.json` at repo root — version-controlled, shared with collaborators. Use when a team needs a specific MCP per-project. Minimal format:
  ```json
  {
    "mcpServers": {
      "server-name": {
        "command": "npx",
        "args": ["-y", "@some/mcp-server"]
      }
    }
  }
  ```
- `~/.claude.json` → `projects["<path>"].mcpServers` — per-project, private. Claude Code writes these automatically when you install an MCP from within a session.

**Trust and permissions.** Layer 3 MCPs prompt for trust on first invocation in a project. Claude Code records the decision in the project entry's trust fields. Layer 1 and Layer 2 inherit account- and machine-level trust respectively. No per-project dialog.

Plus CLI tools on `$PATH` such as `gh`, `git`, and `node`. Not MCPs, but accessible via Bash in every session.

## What every project has automatically

Without any per-project setup, every session inherits:

- **Layer 1:** Gmail, Google Calendar, Google Drive. Subject to the state machine below.
- **Layer 2:** context7, antigravity
- **System PATH:** `gh`, `git`, `node`, standard UNIX tools

Do not install Layer 1 connectors per-project. They are authorized once on the account and then surface in each Claude Code session through that session's own discovery step.

## Layer 1 connector state machine

Per-session, each Claude.ai connector shows up in `/mcp` in one of three states:

| State | Meaning | Fix |
|---|---|---|
| **Missing entirely** | Connector not listed in `/mcp` at all. Claude Code's discovery did not run or did not finish in this session. Often correlates with `lastGracefulShutdown: false` on the project's entry in `~/.claude.json`. | Quit the Claude Code session fully, relaunch, re-run `/mcp`. |
| **`needs authentication`** | Listed but greyed out. Account-level authorization exists, but this machine's Claude Code instance has not completed the OAuth handshake for this connector yet. | In `/mcp`, select the connector, approve in the browser. One-time per machine. |
| **`connected`** | Listed and green. Ready to call. | None. |

Account-level authorization at [`claude.ai/settings/connectors`](https://claude.ai/settings/connectors) is a separate prerequisite. If the connector is not enabled there, no local state fixes it.

The top-level `claudeAiMcpEverConnected` array in `~/.claude.json` records which connectors have ever completed the handshake on this machine. Useful as a sanity check when a connector behaves unexpectedly.

**Gate order when debugging a missing or broken connector:**

1. Is the connector enabled at `claude.ai/settings/connectors`? If no, fix there first.
2. Is it listed in top-level `claudeAiMcpEverConnected` in `~/.claude.json`? If no, the handshake has never succeeded on this machine.
3. Is the current project's entry in `~/.claude.json` showing `lastGracefulShutdown: false`? If yes, a clean restart usually resurfaces missing connectors.
4. Still missing after restart? Open `/mcp` and attempt a manual reconnect on each missing entry.

## Decision tree

**Before installing a new MCP, ask:**

1. Is it available as an account-level Claude.ai connector? → already on; nothing to do.
2. Will you use it in most of your projects? → Layer 2, user-scope at the root of `~/.claude.json`.
3. Is it project-specific AND shared with teammates? → Layer 3 as `.mcp.json` at repo root.
4. Is it project-specific AND only yours? → Layer 3 in the `~/.claude.json` project entry. Claude Code writes this for you when you install from a session.
5. None of the above? → don't install; the tool probably isn't the right fit.

## MCP wrapper runtime

Claude Code's in-process MCP client is one-shot per session. When a server's stdio process closes, CC records the disconnect and drops its tools. It does not auto-reattach. The OS may respawn the subprocess, and `claude mcp list` may show green, but the in-session tool list stays empty until CC restarts.

- NEVER kill a live MCP subprocess mid-session. Recovery requires a full CC restart.
- Code changes to a wrapper take effect only on the next CC launch. No hot-reload.
- To iterate without restarting CC, spawn the wrapper from a shell and test it via JSON-RPC over stdio directly. Integrate through CC only once the wrapper is stable.

Applies to every MCP server CC spawns as a subprocess — kit-owned wrappers in `scripts/mcp-servers/`, community servers installed via `claude mcp add`, and project-scope entries in `.mcp.json`.

### Wrapper stderr capture

Claude Code captures stderr from every MCP wrapper subprocess it spawns. Wrapper stderr is:

- Visible to operators via `claude mcp list` status output and the `/mcp` debug pane.
- Available in CC's internal MCP logs for post-mortem inspection.
- **Not** streamed to the user's terminal during an active session.

Consequence: benign warnings or telemetry emitted by embedded libraries, for example mem0's PostHog timeout when outbound connectivity is absent, are invisible in normal use. Silencing them at the wrapper level is cosmetic, not functional.

**When to silence anyway:**

- The output is confused with a real failure on `claude mcp list --status` or the `/mcp` pane.
- The signal-to-noise ratio during operator debugging degrades enough to slow diagnosis.
- A privacy requirement mandates suppressing outbound telemetry at the source, regardless of user visibility.

**When not to silence:**

- The output is benign and only visible to operators who deliberately inspect MCP state.
- The library's opt-out flag is unstable or undocumented, and gating it creates a maintenance burden.

**Contrast with CLI scripts in the same repo:** CLI scripts under `scripts/mcp-servers/` that run attached to the user's terminal, such as `migrate-from-omega.cjs`, have user-visible stderr. Library noise surfaces directly in the user's output stream. `migrate-from-omega.cjs` sets `process.env.MEM0_TELEMETRY = 'false'` before `require('mem0ai/oss')` for this reason; see `scripts/mcp-servers/migrate-from-omega.cjs:17-21` and issue #262. The same library inside `scripts/mcp-servers/mem0.cjs` does not set the flag because its stderr is captured by Claude Code and the noise is not user-visible. Issue #270 records that scope decision.

## Wrapper score semantics: mem0 search

The mem0 wrapper at `scripts/mcp-servers/mem0.cjs` passes `threshold` through to `memory.search`. Scores are semantic similarity in [0, 1] from the configured embedder. Current stack uses `nomic-embed-text` via Ollama.

**SDK defaults:**

- Default `threshold` when omitted: 0.1, per `mem0ai/oss` at `index.js:6598`.
- Valid range: 0 to 1 inclusive. SDK throws for out-of-range input at `index.js:5857-5866`.
- The wrapper Zod schema enforces the same range at the MCP boundary for earlier failure.

**Empirical distribution on the 31-memory post-migration corpus:**

Signal and decoys overlap on this corpus. True hits observed 0.527 to 0.783. Abstention decoy top-1 observed at 0.598. No universal threshold cleanly separates hits from decoys. See issue #265 for the full Q1-Q7 run and #266 for the re-verification.

**When to set `threshold`:**

- Consumer tolerates missing a low-confidence true hit: pass a higher threshold such as 0.6 to filter noise.
- Consumer needs recall over precision: omit, or pass a low value such as 0.1.
- Abstention logic lives in the consumer, not the wrapper. Read `score` from each result and decide per-use-case.

**How to interpret `score`:**

The wrapper returns `{ results: [{ id, memory, score, metadata, ... }] }`. `score` is post-threshold semantic similarity. A consuming agent that needs "answer or abstain" behavior must inspect scores before treating top-1 as an answer.

**Anti-pattern:** Hardcoding a mem0 `threshold` above 0.1 at the wrapper. Empirical data on the current corpus shows true hits score as low as 0.527 and decoys reach 0.598. A universal threshold filters real hits or admits decoys. Keep `threshold` a pass-through and push abstention policy to the consumer.

## Anti-patterns

**Installing account-connector services per-project.** Gmail, Calendar, Drive, etc. are Layer 1. Per-project installation duplicates what's already global and creates drift.

**Assuming Layer 1 connectors always surface.** A connector missing from `/mcp` can be a session discovery failure, not a config problem. Before reinstalling or reconfiguring anything, follow the gate order in the state machine section above.

**Duplicating user-scope MCPs as project-scope.** `context7` and `antigravity` are already user-scope. Adding them to a project entry is noise.

**Leaving dead project entries in `~/.claude.json`.** When a project directory is deleted, Claude Code does not auto-prune the entry. These accumulate as noise over time. Periodic cleanup pattern: find entries whose path no longer exists on disk, remove them.

**Editing `~/.claude.json` while Claude Code is running.** Use atomic write — temp file plus rename — to avoid truncation races. Claude Code may be writing to the same file from another session.

## Verifying the current state

Layer 1 connectors are visible by running `/mcp` inside a Claude Code session. They surface as `mcp__claude_ai_*` tools. Enablement is configured at `claude.ai/settings/connectors`, not in any local file.

To inspect Layer 1 handshake state from shell:

```bash
cat ~/.claude.json | node -e "
let d='';process.stdin.on('data',c=>c&&(d+=c));
process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  console.log('claudeAiMcpEverConnected:', j.claudeAiMcpEverConnected);
  console.log('oauthAccount email:', j.oauthAccount?.emailAddress);
});
"
```

`claudeAiMcpEverConnected` lists connectors that have ever completed the OAuth handshake on this machine. If a connector is expected but missing from the array, the handshake has never succeeded and `/mcp` will show it as `needs authentication` or missing entirely.

Layers 2 and 3 live in `~/.claude.json`:

```bash
# User-scope MCPs (Layer 2)
cat ~/.claude.json | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const j=JSON.parse(d);
    console.log('user-scope:', Object.keys(j.mcpServers||{}));
  });
"

# Per-project MCPs (Layer 3, only projects with explicit entries)
cat ~/.claude.json | node -e "
  let d='';process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    const j=JSON.parse(d);
    for (const [p,v] of Object.entries(j.projects||{})) {
      const mcps = Object.keys(v.mcpServers||{});
      if (mcps.length) console.log(p, mcps);
    }
  });
"
```

## References

- Claude.ai connectors setup: https://claude.ai/settings/connectors
