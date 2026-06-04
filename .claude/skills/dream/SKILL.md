---
name: dream
description: >
  Consolidate accumulated memories into durable files. Triggers: "dream", "consolidate memory", or auto-invoked by /handoff. Merges duplicates, removes stale entries, converts dates, prunes the index.
---

# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned into durable, well-organized memories so future sessions orient quickly.

## Phase 1 — Orient

Get the lay of the land before changing anything.

```bash
# Find the memory directory for this project
WORKSPACE_KEY=$(git rev-parse --show-toplevel 2>/dev/null | sed 's|/|-|g')
MEMORY_DIR="$HOME/.claude/projects/$WORKSPACE_KEY/memory"
ls -la "$MEMORY_DIR/"
```

- Read `MEMORY.md` to understand the current index
- Skim each existing memory file (read first 10 lines of each) so you improve them rather than creating duplicates
- Note which files are project state (handoffs, context evaluations) vs durable knowledge (feedback, user preferences, references)

## Phase 2 — Gather Recent Signal

Look for things worth updating. Sources in priority order:

1. **Memory files with stale content** — project memories that describe state that's changed. Check against current git log and GitHub issues:
   ```bash
   git log --oneline -20
   gh issue list --state open --json number,title,labels 2>/dev/null | head -30
   ```

2. **Memory files that contradict each other** — two files claiming different things about the same topic

3. **Memory file timestamps** — files not modified in 30+ days may be stale:
   ```bash
   find "$MEMORY_DIR" -name "*.md" -mtime +30 -not -name "MEMORY.md"
   ```

4. **Relative dates** — any mention of "yesterday", "last week", "recently", "Thursday" without an absolute date

Don't exhaustively re-read everything. Focus on what you already suspect matters from the Orient phase.

## Phase 3 — Consolidate

For each thing worth updating, edit or rewrite the memory file. Follow the memory file format from your system prompt (frontmatter with name, description, type + content).

**Do:**
- Merge near-duplicate memories into one file. Keep the better content from each.
- Convert relative dates to absolute dates so they remain interpretable
- Delete contradicted facts at the source — if a memory says "#78 is open" but it's closed, fix the memory
- Update project memories (handoffs, context evaluations) with current state
- Update the `description` field in frontmatter when content changes — it's used to decide relevance

**Don't:**
- Delete feedback memories unless they directly contradict a newer feedback memory
- Create new memories — this phase is about maintaining what exists
- Change the meaning of a memory — if a feedback memory says "don't rush", keep the intent even if you reword it

## Phase 4 — Prune and Index

Update `MEMORY.md` to stay under 200 lines and under 25KB.

- Remove pointers to memories that are stale, wrong, or superseded
- Shorten verbose index entries — each should be one line under 150 characters: `- [Title](file.md) — one-line hook`
- Add pointers to any memories that exist as files but aren't in the index
- Verify every index entry points to a file that actually exists
- Remove orphaned files (files with no index entry and no useful content)

## Phase 5 — Sync to cognee

The memory files are now consolidated. Push them to cognee, the durable cross-project memory graph. The per-project memory files are the live layer; cognee is the long-term layer, and this is the only step that writes to it.

Run the sync helper:

```bash
node .claude/skills/dream/cognee-sync.cjs check "$MEMORY_DIR"
```

The first output line decides the action:

- `EMPTY` — no memory files. Skip to Output.
- `UNCHANGED` — cognee already matches the memory dir. Skip to Output.
- `CHANGED` — three more lines follow: payload file path, content hash, dataset name. Sync now.

On `CHANGED`, full-replace the project's cognee dataset:

1. Call `mcp__cognee-memory__delete_dataset` with the dataset name from line 4. A first sync has nothing to delete, so a `DatabaseNotCreatedError` or a dataset-not-found error is expected here. Continue past it.
2. Call `mcp__cognee-memory__remember` with `data` set to the payload path from line 2 and `dataset_name` set to the dataset name from line 4. Cognee runs the full add + cognify pipeline inline, which takes minutes for a multi-hundred-KB payload.
3. Classify the `remember` outcome by what the call returned, prefix-first:
   - **Response text starts with `Stored permanently in knowledge graph`** — cognee returned a success payload. Cognee only emits this string after the cognify pipeline finishes, so this is itself proof of completion. Go to step 5 and commit the hash.
   - **Response text starts with `Error:`** — cognee returned an error payload from the daemon. This is a real cognee failure, regardless of what substrings appear in the rest of the message. Do NOT commit the hash. Surface the error text in the Output and continue.
   - **No response payload at all** — the harness reports the tool call failed mid-flight: "transport dropped mid-call", "response was lost", connection reset, request timed out at the transport layer, MCP protocol error. Structurally different from any `Error:` payload, which is a response. The daemon is still cognifying. Do NOT commit the hash yet. Go to step 4.
4. Verify cognify completed in the daemon. Poll `mcp__cognee-memory__cognify_status` with `dataset_name` set to the dataset name from line 4. Start the polling clock at the first `cognify_status` call:
   - Wait 10 seconds between calls.
   - Match on substrings of the response text:
     - `DATASET_PROCESSING_COMPLETED` — success. Go to step 5.
     - `DATASET_PROCESSING_ERRORED` — failure. Do NOT commit the hash. Capture the response in the Output, then continue. `Background task errors:` lines can appear on any status, including COMPLETED, so only surface them when the status is ERRORED or empty.
     - `DATASET_PROCESSING_STARTED` — still running. Keep polling.
     - Empty dict, "not found", or no run row yet — `cognify_status` filters strictly on `pipeline_name="cognify_pipeline"`, and `remember()` runs the `add_pipeline` stage first (chunking + embedding), which produces no `cognify_pipeline` row. On a multi-hundred-KB payload, the empty-dict window can last 5+ minutes during the add stage. Treat empty as "still initializing" for the first 5 minutes after polling began. After 5 minutes with still no run row, treat as ERRORED and stop polling.
   - Stop polling at 15 minutes from the first `cognify_status` call. If neither COMPLETED nor ERRORED was observed by then, do NOT commit the hash. Surface `cognify unverified after 15min` in the Output and continue.
5. Record the sync so the next dream can skip an unchanged run:
   ```bash
   node .claude/skills/dream/cognee-sync.cjs commit "$MEMORY_DIR" "<content hash from cognee-sync.cjs check output>"
   ```

Delete before remember. A full-replace stops cognee from accumulating a stale copy of every past memory state.

NEVER commit the hash on a transport drop without first observing `DATASET_PROCESSING_COMPLETED` via `cognify_status`. The MCP transport dropping does not mean the cognify failed. `cognify_status` is the ground truth; the MCP response is not.

NEVER commit the hash when `cognify_status` returns `DATASET_PROCESSING_ERRORED`, when the empty-dict grace expires, or when the 15-minute polling window ends without a COMPLETED. The work didn't finish. The next `/dream` must retry.

ALWAYS commit the hash when `cognify_status` returns `DATASET_PROCESSING_COMPLETED`, even if the original `remember` call dropped the transport. The work is done. The next `/dream` should see `UNCHANGED`.

If the cognee daemon is genuinely down, both `remember` and `cognify_status` will fail. Note it in the Output and continue. The file-memory consolidation already succeeded, and the next dream retries the sync.

## Output

Return a brief summary:
- **Merged:** which memories were combined
- **Updated:** which memories had stale content refreshed
- **Pruned:** which memories or index entries were removed
- **Unchanged:** if memories are already tight, say so
- **Cognee:** synced and dataset rebuilt, unchanged, or skipped with the reason

If nothing changed, that's fine. A clean memory directory doesn't need consolidation.
