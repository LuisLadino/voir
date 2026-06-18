---
name: skills
description: >
  How to write skill descriptions that survive the budget and fire reliably. Defines the byte budget, the required description structure, the golden-trigger eval format, and the gate any new skill must pass before it ships.
applies_to:
  - ".claude/skills/**/SKILL.md"
category: kit
---

# Skill Description Rubric

Skill descriptions are the only thing Claude sees when deciding whether to fire a skill. The description budget is shared across all installed skills, so every byte beyond the trigger signal is dead weight that pushes other skills out of context.

## Byte Budget

- Default cap: 200 bytes for the description body, the text inside `description: >`.
- Compound skills cap: 250 bytes when the skill spans multiple modes with distinct trigger sets, for example `dispatch` and `design`.
- Hard ceiling: 300 bytes. Anything above is a bug.

Count bytes of the description body, not the YAML wrapping. Use:

```bash
python3 -c "import re,sys; t=open(sys.argv[1]).read(); m=re.search(r'description:\s*(.*?)(?=\n[\w-]+:|\Z)', re.search(r'^---\n(.*?)\n---', t, re.DOTALL).group(1), re.DOTALL); d=m.group(1).strip(); print(len(re.sub(r'\s+',' ',d[1:].strip()) if d.startswith('>') else d))" path/to/SKILL.md
```

## Required Structure

Every description body must contain three elements in order:

1. **Action-cue opener.** One sentence naming the action or decision moment, not the topic. "Before claiming a change caused an outcome" beats "Causal reasoning helper."
2. **Trigger phrase list.** 3-6 user-phrasing snippets in quotes, separated by commas. Phrases must be ones a real session uses, for example "the data shows", "ever since we", "let's commit". Avoid abstract nouns like "causal reasoning" or "design quality".
3. **Outcome line.** One clause naming what the skill produces. "Forces explicit confounder enumeration before causal claim."

### Example

```yaml
description: >
  Name the counterfactual before any causal claim. Triggers: "this caused", "because we shipped", "ever since we", "correlates with", "proves that". Forces explicit confounder enumeration.
```

186 bytes. Action cue, five concrete trigger phrases, outcome line.

## Trigger Discrimination

Trigger phrases across skills must not overlap. If two skills compete for the same phrase, decide which one owns it and remove it from the other.

Worked example: "the data shows" could fire `look-at-your-data`, `name-the-metric`, or `define-the-sample`. Decision: it owns `name-the-metric` because the definition check is the first move. `define-the-sample` owns "most users", "typical session". `look-at-your-data` owns "tune the prompt", "hallucinating".

When adding a new skill, grep the existing trigger phrases to confirm no overlap:

```bash
grep -A 1 "^description:" .claude/skills/*/SKILL.md | grep -i "your-phrase"
```

## Golden-Trigger Eval Set

Every skill must ship with a golden eval set: 3-5 phrases that MUST fire it, 3-5 that MUST NOT.

Store eval sets in `.claude/research/skill-trigger-evals/<skill-name>.md`:

```markdown
# skill-name trigger eval

## Should fire
- "the user phrase 1"
- "the user phrase 2"
- "the user phrase 3"

## Should not fire
- "phrase that sounds adjacent but is owned by another skill"
- "phrase that is on-topic but doesn't need this skill"
- "phrase that is a false friend"

## Owns triggers
- "phrase 1" (vs adjacent skill X)
- "phrase 2" (vs adjacent skill Y)
```

Write should-fire phrases in the form the skill actually fires on. For an action skill, that is a command, not a query. "capture this project's architectural invariants" fires reliably; "what are the architectural invariants of this project?" reads as a request to *list* what already exists and routes to the skill only ~1/3 of the time. A phrase that hovers near a 50% fire rate is not a flaky harness — it is a mis-classified test case, and it flips PASS/FAIL between runs of 3. Fix the phrase to match how the skill is really invoked; do not raise the run count to paper over a borderline phrase. The walk verdict is also model-specific — the harness prints the model it used, and a phrase can fire on one model and not another.

## Skill Addition Gate

A new skill PR must include:

1. Description body ≤200 bytes following the three-part structure.
2. Golden eval file at `.claude/research/skill-trigger-evals/<name>.md`.
3. Statement of overlap analysis: which existing skills share trigger space, and why this skill is distinct.

PR review: run `/skill-gate <name>`. It runs all three items above — byte budget, overlap, and the trigger walk — and emits one verdict. The walk fires the installed skill against its golden eval via `.claude/scripts/skill-trigger-walk.cjs`, running each phrase 3× and requiring the skill to fire on every should-fire phrase and stay silent on every should-not-fire phrase. Do not reach for skill-creator's `run_eval.py`: it keys detection on a fabricated temp command name and bails on the first non-Skill tool, so it returns false negatives for any already-installed skill in a hook-heavy project. A walk miss is a real routing defect, not a harness artifact. Document residual gaps as follow-up issues.

## Stub Scaffolds

`/init-project` Step 6.7 scaffolds a stub for each project-specific skill it identifies. A stub is pre-gate. It ships with `disable-model-invocation: true` so its placeholder description stays out of the routing budget, plus a checklist of the gate items above. A stub is not a shipped skill. It clears the gate only when its author writes a real ≤200-byte three-part description, adds the golden eval, removes `disable-model-invocation`, and clears `/skill-gate <name>`.

## Validation

After any description change:

1. Open Claude Code, observe the available-skills list in the system reminder.
2. Confirm no kit skill loads without description.
3. For changed skills, run `/skill-gate <name>` to walk the golden eval against the installed kit.

A drop with the description visible but never firing is the same failure mode as a drop without the description. Both make the skill invisible.
