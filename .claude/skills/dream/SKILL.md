---
name: dream
description: >
  Memory consolidation. Synthesizes accumulated memories into durable,
  well-organized files. Merges duplicates, removes stale entries, converts
  relative dates, prunes the index. Run manually or triggered by /handoff.
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

## Output

Return a brief summary:
- **Merged:** which memories were combined
- **Updated:** which memories had stale content refreshed
- **Pruned:** which memories or index entries were removed
- **Unchanged:** if memories are already tight, say so

If nothing changed, that's fine. A clean memory directory doesn't need consolidation.
