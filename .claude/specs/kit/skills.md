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
- Compound skills cap: 250 bytes when the skill spans multiple modes, for example `dispatch`, `design`, and `affordance-audit`. Whether the modes share one trigger set or carry distinct ones, spanning multiple modes is what earns the larger cap. A single-mode lens skill stays at 200.
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

PR review: run `/skill-gate <name>`. It runs the three items above plus a faithfulness check — byte budget, overlap, the trigger walk, and the faithfulness walk — and emits one verdict. The trigger walk fires the installed skill against its golden eval via `.claude/scripts/skill-trigger-walk.cjs`, running each phrase 3× and requiring the skill to fire on every should-fire phrase and stay silent on every should-not-fire phrase. Do not reach for skill-creator's `run_eval.py`: it keys detection on a fabricated temp command name and bails on the first non-Skill tool, so it returns false negatives for any already-installed skill in a hook-heavy project. Run the walk at low concurrency — PAR ≤ 2 with `--timeout` tuned to it — or contention times out a slow-but-real fire into a false miss (#498). And not every miss is a routing defect: a should-fire phrase that is a task the model satisfies directly, like build's "implement the watcher" or lead-with-decision's "draft an email", is never invoked as a Skill, so phase skills and task-phrase lens skills under-fire by construction and need the warm eval (#348), not a description fix. Confirm a miss reproduces at low concurrency before filing it; document residual gaps as follow-up issues. Evidence: `.claude/research/skill-trigger-eval-2026-05.md`. Cost: each phrase fires a cold `claude -p` (phrases × runs per skill, printed at the start of every walk), so a full-suite walk over every skill is hundreds of cold sessions — on Max that draws from the same 5-hour window interactive work needs and can lock you out (#852). Walk deliberately: prefer `/skill-gate` one skill at a time, pass `--max-sessions N` to abort an over-budget run, and `--model haiku` for a cheap pre-screen.

## Gate Scope: what the trigger walk governs

The cold trigger walk is a valid instrument only for **procedure-request skills** — skills whose should-fire phrase names a procedure the model routes to, like "verify the queue", "heuristic pass", or "activation rate". It is invalid for skills whose value is delivered as behavior the model performs directly, because a contextless `claude -p` does the work instead of invoking the Skill. Evidence: #498, `.claude/research/skill-trigger-eval-2026-05.md`. Two classes are carved out, and each has its own valid instrument, so a skill the trigger walk cannot measure is not ungoverned.

**Phase skills — `research`, `define`, `ideate`, `build`, `test` — are exempt from the trigger gate.** Their value is the multi-turn work they govern, and they fire on session framing, the documented workflow plus an in-flight issue, not on description routing. Do not file a should-fire miss against them, and do not raise their golden run count to force a fire. Both are measurement errors, not skill defects. Their validity is checked deterministically by `.claude/scripts/phase-skill-wiring.test.cjs`: each phase skill must exist with a non-empty description and be named in the documented workflow sequence in `.claude/CLAUDE.md`. That gate fails in CI if a phase skill is renamed or dropped without updating the workflow, the teeth the trigger walk cannot provide for them.

**Task-phrase lens skills under-fire cold for the same reason, but stay measurable because their value is a single-output property.** This covers `lead-with-decision`, `eval-first`, `jobs-to-be-done`, `concretize-pass`, and any lens whose trigger is a natural task-phrase like "draft an email" or "what problem does this solve". The Scope C behavior walk measures them: `.claude/scripts/skill-behavior-walk.cjs`, documented in `specs/kit/kit-eval.md`, ablates the skill — injected versus absent — on its own golden task-phrases and reports the compliance-rate delta. A weak cold trigger rate on these is still a real signal: a lens that should inject a frame on a task-phrase and does not is not doing its job. But the keep-or-cut call belongs to the behavior walk's delta, not the trigger walk's fire rate. See #348 and #853.

A carved-out skill still ships through `/skill-gate` for byte budget, overlap, and faithfulness. Only the trigger-walk step is replaced, by the instrument named above.

## Faithfulness check

Byte budget, overlap, and the trigger walk all pass a description that fires correctly but *describes the wrong behavior*. The faithfulness walk (`/skill-gate` STEP 5, `.claude/scripts/skill-faithfulness-walk.cjs`, #837) is the one check that catches that — a faithfulness VIOLATION: a description that contradicts the body or misstates its scope, so a reader is misled about what the skill is for. No mechanical check can decide it; only a judgment can.

It reads the description + body and runs an LLM judge N× under `claude -p --safe-mode` in an empty cwd (so it grades only the injected text, never the live file), then passes the skill when the faithful-rate is at or above the threshold. The default threshold is 0.5 — a strict majority of runs must call it unfaithful to flag — and it biases against the judge's tendency to over-flag, since LLM judges have a low true-negative rate. Run N× because a single judge call varies run to run; the gate uses 3.

**What it flags, and what it must not.** A VIOLATION is a contradiction (the description claims the skill does something the body shows it does not, or works the opposite way) or a scope misstatement (it claims more, less, or different ground than the body has). An accurate-but-generic description that under-foregrounds the distinctive core is NOT a violation — flagging it would be a writing-quality judgment, the preference-laden call that drives the over-flagging. The rubric is framed comparative-factual, not as a quality grade, to dodge the self-preference bias of Claude judging Claude-written prose.

**Calibration is the gate's gate.** The judge ships validated against `.claude/research/skill-faithfulness-evals/calibration.md`: synthetic violations (a real body paired with a contradicting description) as positives, accurate descriptions as negatives. The negatives include all five #749 cases, which the #837 calibration established are accurate-but-improvable, not violations — a gate that flagged them would be enforcing style. Re-run `--calibrate` after any rubric change; if it cannot both catch every violation and pass every faithful case, the rubric or threshold is wrong, not the skills. Like the trigger walk, the live judge is a pre-merge local check, not blocking CI; its pure core is unit-tested in CI.

**Local backend (`--local`).** The judge can run on a local model instead of Claude: `skill-faithfulness-walk.cjs <skill> --local <ollama-model>` routes it through Ollama's structured-output API via the shared `hooks/lib/local-llm.cjs` primitive (#845, the kit's first local-as-tool slice). The default stays `claude -p`; `--local` is opt-in, for bulk or cost-sensitive eval where a local judge is good enough. It **fails closed**: if Ollama is down, the model is not pulled, or a call times out, the run errors or counts the verdict as not-faithful — never a silent pass. The judge is a comprehension task, so pick a reasoning/instruct model, not a code-gen one. Validated default: **`qwen3:32b` matched the Claude baseline on the calibration corpus (5/5 violations flagged, 8/8 faithful passed)** at 32B and no timeouts; `llama3.3:70b` was worse (over-flagged an accurate description) and timed out under the 120s default, so bigger is not better here. Before trusting `--local` on a real gate, run `--calibrate --local <model>` on your corpus and confirm it still hits the split.

## Stub Scaffolds

`/init-project` Step 6.7 scaffolds a stub for each project-specific skill it identifies. A stub is pre-gate. It ships with `disable-model-invocation: true` so its placeholder description stays out of the routing budget, plus a checklist of the gate items above. A stub is not a shipped skill. It clears the gate only when its author writes a real ≤200-byte three-part description, adds the golden eval, removes `disable-model-invocation`, and clears `/skill-gate <name>`.

## Validation

After any description change:

1. Open Claude Code, observe the available-skills list in the system reminder.
2. Confirm no kit skill loads without description.
3. For changed skills, run `/skill-gate <name>` to walk the golden eval against the installed kit.

A drop with the description visible but never firing is the same failure mode as a drop without the description. Both make the skill invisible.
