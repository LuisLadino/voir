---
description: Run the Skill Addition Gate for a skill — byte budget, trigger overlap, the golden-eval trigger walk, and a faithful-foregrounding judge — and emit one PASS/FAIL verdict. Use before merging a new or changed skill description.
---

# /skill-gate - Skill Addition Gate

Run the four checks `.claude/specs/kit/skills.md` requires before a skill ships — three mechanical plus a faithful-foregrounding judge — and report one verdict. The trigger walk is the load-bearing mechanical check: it actually fires the installed skill against its golden eval, surviving the two confounds that make skill-creator's `run_eval.py` return false negatives here. The faithfulness walk covers the one drift class no mechanical check can see.

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

PASS if at or under the skill's cap. A compound skill spans multiple modes, for example `dispatch`, `design`, or `affordance-audit`, and gets 250 whether its modes share a trigger set or carry distinct ones; a single-mode lens skill gets 200. Note which cap you applied.

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

## STEP 5: Faithfulness walk

Judge whether the description is a faithfulness VIOLATION — it contradicts the body or misstates its scope, so a reader is misled. This is the contradiction/misstatement subset of the #749 drift that no mechanical check can catch (#749, #837). It does NOT flag a description that is merely less sharp than it could be — under-foregrounding is a writing-quality preference, and forcing a judge to enforce it over-flags clean skills.

```bash
node .claude/scripts/skill-faithfulness-walk.cjs "$SKILL"
```

It reads the description + body and runs an LLM judge N× under `claude -p --safe-mode`, then passes the skill when the faithful-rate is at or above the threshold. The threshold biases against the judge's tendency to over-flag (LLM judges have a low true-negative rate), and is calibrated against `.claude/research/skill-faithfulness-evals/calibration.md` — genuine violations as positives, accurate descriptions (including accurate-but-improvable ones) as negatives. Re-run `--calibrate` if you change the rubric. On FAIL the judge's per-run reasons print, naming the contradiction or scope misstatement.

Like the trigger walk, this is a live `claude -p` step — a pre-merge local check, not blocking CI. Pass `--runs N`, `--threshold R`, `--model <id>`, `--json` as needed. It resolves skills under `.claude/skills/` and commands under `.claude/commands/`, so it gates both.

## STEP 6: Verdict

```
SKILL GATE: <name>

  Byte budget:     [PASS/FAIL]  <n> bytes (cap <cap>)
  Trigger overlap: [PASS/FAIL]  <overlaps or "none">
  Trigger walk:    [PASS/FAIL]  <passed>/<total> phrases
  Faithfulness:    [PASS/FAIL]  faithful <k>/<runs>

VERDICT: [PASS — clears the gate / FAIL — <what to fix>]
```

VERDICT is PASS only when all four pass. On any FAIL, name the specific fix: trim the description to the cap, reassign an overlapping phrase, fix the description so the missed phrase fires (or the leaking phrase stops firing), or rewrite the description to stop contradicting or misstating the body the judge flagged. A walk or faithfulness miss is a real defect, not a harness artifact — both harnesses were built to remove the artifacts. Re-run after the fix. Document any residual gap you choose to defer as a follow-up issue, per `skills.md`.
