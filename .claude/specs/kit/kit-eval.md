---
name: kit-eval
description: >
  How the kit measures its own instructions and skills: the instruction-wording
  walk, the skill-output eval, and the skill-behavior walk, their corpus formats,
  how to add a case, and the CI-vs-local split. Required reading before adding or
  editing a kit-eval harness or corpus.
applies_to:
  - ".claude/scripts/instruction-wording-walk.cjs"
  - ".claude/scripts/skill-output-eval.cjs"
  - ".claude/scripts/skill-behavior-walk.cjs"
  - ".claude/research/instruction-wording-evals/**/*.md"
  - ".claude/research/skill-output-evals/**/*.md"
  - ".claude/research/skill-behavior-evals/**/*.md"
category: kit
related: ["#413", "#303", "#706"]
---

# Kit Eval

The kit ships skills, hooks, and behavior-shaping instructions. Three leverage points moved by feel until they had no measurement: **instruction wording** (does changing how a rule is phrased change compliance?), **skill output quality** (when a skill fires, is the artifact it produces good?), and **skill behavior** (does loading a skill change the model's output at all — the only valid instrument for the lens skills the trigger walk cannot measure). This is the measurement layer for all three. Triggering quality is already covered by `/skill-gate` + `skill-trigger-walk` (`skills.md`); kit-eval is the rest.

This is **System 1, kit-eval** — testing the kit's own skills and instructions. It is distinct from **product-eval** (the customer-facing output-gating suite, #407): different corpora, different consumers. They do not share corpora and must not be conflated.

## Framework: cjs-native on `claude -p --safe-mode`

The harnesses spawn `claude -p ... --output-format json` and grade the result. No Python, no Inspect, no DeepEval. The #303 verdict (2026-04-25) named Inspect + DeepEval, but that predates two facts that decide it the other way: `skill-trigger-walk` proved a cjs `claude -p` harness works where Python eval tooling (`run_eval.py`) returns false negatives in this hook-heavy environment, and the kit is a zero-runtime-dependency Node project. A Python eval framework would add a toolchain and an API-keyed judge for a measurement the existing infra already makes. Boring-check: the cjs harness wins at this scale. If skill-output grading ever needs richer metrics across many skills, revisit DeepEval for that scope alone (#706).

**`--safe-mode` is load-bearing.** It disables the project's settings, hooks, CLAUDE.md, and skills while keeping Auth, model, built-in tools, and permissions working. Without it, the kit's *own* ambient copy of an instruction (e.g. the response-format reminder hook) lands on top of every variant and the A/B measures nothing. With it, the only instruction present is the one injected via `--append-system-prompt`, so the comparison is clean — and OAuth still works, so no API key is needed.

The runs also execute in a neutral, empty temporary working directory. `--safe-mode` keeps the built-in tools, so a run inside this repo could `Read` the real skill or instruction to recover anything the injected prompt left out — which silently contaminates the grade (observed during #413: a truncated rules block led the model to read the live commit skill and pass anyway). An empty cwd forces the response to come from the injected prompt alone.

## Scope A: instruction-wording walk

Measures how reliably a wording of an instruction produces a compliant response, and compares variants head to head — the kit-side "0/2 -> 3/3 via wording" pattern from the Anthropic memory-prompt leak.

Corpus: `.claude/research/instruction-wording-evals/<name>.md`. Sections:

- `## Compliance check` — one backtick-quoted JS regex. A response complies when it matches. Keep it structural and anchored, e.g. `` `^\s*\*\*Lens:\*\*` ``.
- `## Variant: <label>` — one per wording. The body is injected verbatim via `--append-system-prompt`. Need at least two.
- `## Tasks` — quoted bullets. Each is a prompt the instruction should make compliant. Pick mundane prompts a model would not satisfy on its own, so any compliance is attributable to the instruction, not the task.

Run:

```bash
node .claude/scripts/instruction-wording-walk.cjs <name> [--runs N] [--model M] [--json]
```

It reports a compliance fraction per variant over all `tasks x runs` trials. A wide gap (the `response-format` corpus shows 9/9 vs 0/9) is the signal that wording is load-bearing. Compliance is deterministic — no judge, no per-grade cost.

## Scope B: skill-output eval

Grades the artifact an artifact-producing skill yields (a commit message + PR body, an invariants spec, …) against this project's conventions. Hermetic: the skill's rules are injected via `--append-system-prompt` under `--safe-mode`, a fixed scenario asks the model to produce the artifact inside one or more `<<NAME>>…<<END_NAME>>` envelopes the corpus declares, and nothing touches git or gh. The harness is envelope-generic — `commit` emits two faces (`<<COMMIT>>` + `<<PR>>`), `capture-invariants` emits one (`<<SPEC>>`), through the same parser.

Corpus: `.claude/research/skill-output-evals/<skill>.md`. Sections:

- `## Skill rules` — the artifact-production rules, injected as the system prompt. Must define the marker envelope.
- `## Scenario` — the `-p` prompt: a fixed change (diff + issue) to produce the artifact for.
- `## Assertions` — bullets `<target> \`<regex>\` — <name>`, where target is `any` or a declared envelope name (`commit`, `pr`, `spec`, …). Deterministic, regex-graded (multiline).
- `## Judge (target)` — the one subjective criterion (e.g. "does the message accurately describe the change?"). The optional `(target)` names the envelope the judge grades; omit it to grade the whole artifact (`any`). `commit` grades `(commit)`; a single-envelope corpus like `capture-invariants` omits it. Posed to a judge call (Claude, or a local model via `--local`) that returns `{pass, reason}` JSON. Use the judge ONLY where a regex cannot decide; everything regex-decidable belongs in `## Assertions`.
- `## Calibration` (optional) — `### pass:` / `### fail:` cases, each a fixed message with a known verdict, for `--calibrate` (see Local judge backend below). Ignored by the live eval.

Run:

```bash
node .claude/scripts/skill-output-eval.cjs <skill> [--model M] [--local <ollama-model>] [--json]
```

Selective, not universal. A skill earns a Scope B corpus only if its artifact has a fixed shape gradable from a hermetic, fixed-input run. Two do: `commit` (message + PR body) and `capture-invariants` (an invariants spec — the emit contract graded from a pre-supplied brief, since the live interview is not hermetic). Three named earlier do NOT, and are covered elsewhere or not at all: `build` produces context-dependent code with no fixed artifact shape — its value is process discipline (branch from `origin/main`, mark in-progress, phase order), checked by `phase-skill-wiring.test.cjs`, not artifact grading; `sync-stack`'s one gradable artifact IS the `capture-invariants` emit it delegates to, so grading it here would double-cover; `research` needs live external search a `--safe-mode` empty-cwd run cannot exercise, so a hermetic grade would score a hollow report. The judgment-lens skills produce subjective output and are out of scope here — the ones whose trigger fires cold are covered by the trigger walk, and the ones whose trigger is a task-phrase the trigger walk cannot measure are covered by Scope C below.

## Scope C: skill-behavior walk

Measures whether loading a skill changes what the model does — the only valid instrument for the **task-phrase lens skills** the cold trigger walk cannot measure (#498): skills whose should-fire phrase is a task the model just performs ("draft an email"), so it never fires the Skill, yet whose value is a property of the output. An ABLATION: each golden task runs twice under `claude -p --safe-mode` with a shared neutral base prompt — warm (base + the skill's `SKILL.md` body) and cold (base alone) — so the skill body is the only differing variable. Each output is graded for compliance independently, and the signal is the warm−cold compliance-rate delta. `specs/kit/skills.md` Gate Scope is the canonical statement of why this, not the trigger walk, governs these skills.

Corpus: `.claude/research/skill-behavior-evals/<skill>.md`. Sections:

- `## Tasks` — quoted bullets, each a `-p` prompt: a natural task-phrase the skill should improve. Pick prompts the model satisfies on its own cold, so any lift is attributable to the skill.
- `## Complies when` — optional backtick-quoted JS regex (case-insensitive, multiline). A match on the output means it exhibits the behavior.
- `## Violates when` — optional backtick-quoted JS regex. A match means it does NOT — an anti-pattern is present.
- `## Judge` — optional criterion, posed per output, returning `{complies, reason}`. Use the judge ONLY where a regex cannot decide; everything regex-decidable belongs in the two regex sections.
- `## Calibration` (optional) — `### pass:` / `### fail:` fixed outputs with a known verdict, for `--calibrate`. Required to validate any judge backend before trusting it.

A corpus needs at least one task and at least one grader. With both a regex grader and a judge, the output complies only when both agree. The producer always runs on Claude; only the judge takes `--local`.

Run:

```bash
node .claude/scripts/skill-behavior-walk.cjs <skill> [--runs N] [--model M] [--timeout MS] [--local <ollama-model>] [--json] [--out PATH] [--resume]
```

It reports warm and cold compliance rates, their delta, and a pre-registered verdict — KEEP (delta ≥ 0.4), DEAD-WEIGHT (delta ≤ 0.1), or INCONCLUSIVE between — plus a `weak warm` flag when the warm rate itself is below 0.5 (the skill helps but is mediocre even when present). Thresholds and the decision rule are pre-registered in `.claude/research/skill-behavior-eval-protocol-2026-06.md`; the verdict feeds the keep/cut call in #853. The walk exits 0 always — it is a measurement, not a gate. Cost: 2 producer calls plus up to 2 judge calls per task per run, all cold `claude -p`, so it is quota-hostile on Max (#852) — run at low concurrency and estimate sessions first.

### Surviving a long walk (#866)

A long walk run as a background task does not survive the session going idle between turns — the environment reaps stopped background bash tasks. `caffeinate -i` does not help: the cause is not machine sleep (a caffeinated run died too), it is idle-reaping. Three consecutive Scope-C runs were lost this way (#348). The walk is the longest of the three because it grades 5 tasks × runs × 2 conditions; the shorter output and faithfulness walks do not carry `--out`/`--resume`.

Run a long walk defensively, one skill per invocation:

- **`--out PATH` + `--resume`.** `--out` writes the result JSON to `PATH` atomically (temp + rename, so a reap during the write cannot leave a partial file); `--resume` skips a skill whose `PATH` already exists. Re-running the per-skill loop after a reap resumes instead of restarting from scratch:
  ```bash
  for s in lead-with-decision eval-first jobs-to-be-done; do
    node .claude/scripts/skill-behavior-walk.cjs "$s" --runs 3 --local llama3.3:70b --out ".ctx/$s.json" --resume
  done
  ```
- **Keep the session active during the batch**, and size runs to the idle window: `--runs` ≤ 3 per skill tends to survive; `--runs 6` is risky.

## Local judge backend

The Scope B judge runs on `claude -p --safe-mode` by default, or on a local Ollama model with `--local <model>` (#845). `--local` routes ONLY the judge through `hooks/lib/local-llm.cjs` (structured `{pass, reason}` output, temperature 0). The producer call stays on Claude — this eval grades what the *shipped* skill produces on its real model, so routing the producer local would measure local-model artifact quality, a different question.

That split is the routing convention, and it generalizes across the kit's eval harnesses: route `--local` an eval's JUDGE returning a structured verdict, never a PRODUCER call whose model identity is the thing under test. It is why `skill-faithfulness-walk` and `skill-behavior-walk` (which run a judge) take `--local` for that judge while `instruction-wording-walk` and `skill-trigger-walk` do not — they have no judge, only a producer or behavioral call graded by a deterministic regex. `skill-behavior-walk` is the mixed case: its deterministic-only corpora take no `--local`, its judge-bearing corpora do.

A local judge that cannot run — Ollama down, model not pulled, timeout, or output that does not parse — scores the assertion FAIL with the error surfaced, never a silent pass. `--local` is opt-in; the default judge stays `claude -p`, so a downstream without Ollama is unaffected.

**Validate before trusting a local backend.** A judge that matches Claude on one task class need not match on another, so confirm it per corpus. A corpus's `## Calibration` section holds fixed messages with a known verdict; `--calibrate` grades them with the judge alone — the producer held out, so judge variance is not confounded with the producer's non-determinism (the #837 method):

```bash
node .claude/scripts/skill-output-eval.cjs <skill> --calibrate                  # Claude baseline
node .claude/scripts/skill-output-eval.cjs <skill> --calibrate --local qwen3:32b
```

Both must hit 100% sensitivity (bad messages caught) and 100% specificity (good messages passed), and agree, before a local judge is trusted. For `commit`, `qwen3:32b` matches the Claude baseline (2/2 + 2/2, stable across three runs at temperature 0) — the same model the faithfulness gate validated, now confirmed on artifact-quality grading too.

## CI vs local

- **CI (deterministic, free, blocking).** The harness pure-core tests (`instruction-wording-walk.test.cjs`, `skill-output-eval.test.cjs`, `skill-behavior-walk.test.cjs`), the shared-atom lib test (`eval-harness.test.cjs` — the `claudeRun` producer and the tolerant judge parse the walks import from `hooks/lib/eval-harness.cjs` rather than each copying, #859), and the corpus-validation test (`kit-eval-corpora.test.cjs`) run in `npm test`, which CI already invokes. They gate harness logic and corpus well-formedness on every PR with no model call.
- **Local (live, on-demand).** The walks themselves spawn `claude -p`, which needs Claude auth and costs tokens, and model behavior is non-deterministic. On Max those spawns draw from the same 5-hour quota window interactive work needs, so a large batch can lock the operator out (#852) — run one corpus at a time, deliberately. Like `/skill-gate`, they are a pre-merge local step on the PRs that change a skill or a behavior-shaping instruction, not a blocking CI job. Run the relevant walk before merging such a change and paste the result into the PR.

Putting a live `claude -p` eval in blocking CI would couple merges to model availability and token cost and flake on nondeterminism. The deterministic layer is what belongs in CI; the live layer is what belongs in a reviewer's hands.

## The pre-merge reminder

The live walk is advisory, so nothing forces it and an instruction edit can merge unevaluated. `kit-eval-reminder.cjs` closes that gap. It fires on `git push` and `gh pr create`, diffs the change against its base, and prints the exact walk for any changed file a corpus watches. It never blocks and never calls a model — exit 0 always. It is a separate hook from the blocking `check-spec-conformance`, so an advisory nudge never entangles with a hard block.

The mapping is `tests_source`, a frontmatter list of repo-relative globs on every corpus naming the source file(s) the eval watches:

```yaml
---
tests_source:
  - .claude/skills/commit/SKILL.md
---
```

The walk command is derived from the corpus directory and basename, so no registry holds the mapping. The corpus owns what it watches. `kit-eval-corpora.test.cjs` asserts every corpus declares a non-empty `tests_source` whose globs each resolve to a real file, so a renamed or deleted source fails in CI instead of leaving the reminder pointing at nothing.

Skill-trigger evals and `/skill-gate` are a separate gate, not kit-eval, so this reminder does not cover them.

## Adding a case

1. Write the corpus file in the right directory with the sections above, including a `tests_source` frontmatter list naming the source file(s) the eval watches.
2. `node .claude/scripts/<harness>.cjs <name> --json` and confirm it produces a sane grade.
3. `kit-eval-corpora.test.cjs` picks the corpus up automatically and asserts it is well-formed, `tests_source` included — no registration.
4. For an instruction or skill change, run the live walk and record the numbers in the PR. The pre-merge reminder names the walk when a watched source changes.
