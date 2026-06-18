---
description: Run the Skill Addition Gate for a skill — byte budget, trigger overlap, and the golden-eval trigger walk — and emit one PASS/FAIL verdict. Use before merging a new or changed skill description.
---

# /skill-gate - Skill Addition Gate

Run the three mechanical checks `.claude/specs/kit/skills.md` requires before a skill ships, and report one verdict. The trigger walk is the load-bearing check: it actually fires the installed skill against its golden eval, surviving the two confounds that make skill-creator's `run_eval.py` return false negatives here.

Argument: the skill name, e.g. `/skill-gate capture-invariants`. Default to the changed skill in the current diff if no name is given.

Read `.claude/specs/kit/skills.md` first — it owns the caps and the description rubric this command checks against.

## STEP 1: Resolve and pre-check

```bash
SKILL="$1"
SKILL_MD=".claude/skills/$SKILL/SKILL.md"
EVAL=".claude/research/skill-trigger-evals/$SKILL.md"
[ -f "$SKILL_MD" ] || echo "MISSING: $SKILL_MD"
[ -f "$EVAL" ] || echo "MISSING: $EVAL (gate item 2 — every skill ships a golden eval)"
```

If either file is missing, stop and report — the gate cannot run.

## STEP 2: Byte budget

Count the description body and compare to the caps in `skills.md` (default 200, compound 250, hard ceiling 300):

```bash
python3 -c "import re,sys; t=open(sys.argv[1]).read(); m=re.search(r'description:\s*(.*?)(?=\n[\w-]+:|\Z)', re.search(r'^---\n(.*?)\n---', t, re.DOTALL).group(1), re.DOTALL); d=m.group(1).strip(); print(len(re.sub(r'\s+',' ',d[1:].strip()) if d.startswith('>') else d))" .claude/skills/$SKILL/SKILL.md
```

PASS if at or under the skill's cap. A compound skill (distinct trigger sets across modes, like `dispatch`) gets 250; note which cap you applied.

## STEP 3: Trigger overlap

Extract the quoted trigger phrases from the skill's description, then grep each across every other skill. Any phrase that also appears in another skill's description is an overlap — one skill must own it.

```bash
grep -A2 "^description:" .claude/skills/*/SKILL.md | grep -i "<phrase>"
```

PASS if no phrase resolves to more than one skill. Report each overlap as `phrase → skill-a, skill-b` so the author can decide the owner.

## STEP 4: Trigger walk

Fire the skill against its golden eval on the installed kit:

```bash
node .claude/scripts/skill-trigger-walk.cjs "$SKILL"
```

The harness runs each should-fire and should-not-fire phrase 3× and prints `[PASS]/[FAIL] fires/runs` per phrase, then `N/total phrases pass`. Exit 0 means every phrase passed. A should-not-fire phrase reports which skill it `picked=` instead — that is the owning skill, and is correct.

Pass `--model <id>` to pin a model, `--runs N` to change the sample, `--json` for machine output. Default model is the project's configured model, so the walk reflects the routing the project actually runs.

This is the slow step (one `claude -p` per run). Expect a minute or two for a 10-phrase eval at 3 runs.

## STEP 5: Verdict

```
SKILL GATE: <name>

  Byte budget:    [PASS/FAIL]  <n> bytes (cap <cap>)
  Trigger overlap: [PASS/FAIL]  <overlaps or "none">
  Trigger walk:   [PASS/FAIL]  <passed>/<total> phrases

VERDICT: [PASS — clears the gate / FAIL — <what to fix>]
```

VERDICT is PASS only when all three pass. On any FAIL, name the specific fix: trim the description to the cap, reassign an overlapping phrase, or fix the description so the missed phrase fires (or the leaking phrase stops firing). A walk miss is a real routing defect, not a harness artifact — the harness was built to remove the artifacts. Re-run after the fix. Document any residual gap you choose to defer as a follow-up issue, per `skills.md`.
