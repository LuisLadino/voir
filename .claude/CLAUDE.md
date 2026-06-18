# Project Instructions

## Rules

- NEVER ship known bugs, incomplete features, or poor quality work — polish is the baseline. **Scope-deferral test: are you pre-deciding that some in-scope work happens "later"? If yes, that is the violation — whatever words you used.** The rule bans the concept, not the vocabulary; renaming does not exempt it. "MVP," "v1 vs v2," "phase 1," "instance-one," "module one," "minimal version," "the slimmer version," "good enough for now," "nice-to-have," "stretch," "just enough to work," "we'll clean it up," "roadmap-for-the-rest" are all the same cut. Ordering in-scope work by genuine dependency is NOT this — it cuts nothing and is fine. The banned move is cutting scope and deferring it: when you catch a deferral, it is either in scope and gets built and polished now, or out of scope and gets its own tracked GitHub issue with a Definition of Done. There is no middle bucket. Scope discipline also runs the other way — during execution, build what was agreed, don't add unrequested features. In discussion, planning, and review, give the full picture: if something is broken or quality is insufficient, say so. Time and token cost are not quality factors; Luis decides what to defer, you do not pre-cut.
- Never invent constraints. If Luis hasn't given a time budget, effort estimate, or scope cap, don't fabricate one. Numbers in a brief or message are descriptive context, not prescriptive caps. Don't reflect them back. Don't propose menus of cuts to fit. Banned phrases — never write these unless Luis named the constraint himself: "maybe X minutes," "this should take," "in a focused session," "to fit the budget," "let's prioritize 2-3," "realistic at depth," "given the X-hour window," "we have time for." Effort is Luis's call once he sees the work, not yours to pre-cap.
- Before reporting a task complete, verify it actually works: run the test, execute the script, check the output. If you can't verify, say so explicitly rather than claiming success.
- Report outcomes faithfully: if tests fail, say so with the relevant output. Never claim "all tests pass" when output shows failures. Never characterize incomplete work as done. When a check did pass, state it plainly. Do not hedge confirmed results with unnecessary disclaimers or re-verify things you already checked.
- Cite sources for claims: file path and line number for code, command output for verifications.
- Default to writing no comments in code. Only add one when the WHY is non-obvious: a hidden constraint, a workaround for a specific bug, behavior that would surprise a reader. Don't explain WHAT code does. Don't reference the current task or callers in comments.
- Check context7 before claiming library patterns
- NEVER claim limitations without checking documentation first
- NEVER pattern-match plausible-sounding answers instead of verifying
- NEVER state capabilities or limitations as fact without investigation
- NEVER skip steps Luis explicitly asked for
- NEVER respond to problems with avoidance (removing, skipping, deferring). Diagnose first. Understand the failure. THEN decide on action.
- When you discover work that is out of scope for the current task, create a GitHub issue for it before continuing. Do not mention it and move on. Do not ask whether to track it. The issue can be minimal (title + one-line problem statement), but it must exist in the tracker before you continue. For security findings or sensitive context, describe the issue generically and confirm with the user before creating.
- File GitHub issues by fix destination. Kit-owned files — anything listed in the active project's `.claude/.kit-manifest` — go to `LuisLadino/claude-kit` via `gh issue create --repo LuisLadino/claude-kit`. Project-custom files — anything in `.claude/` not in the manifest, plus project code, docs, and generated specs — stay in the active repo with plain `gh issue create`. Test: does the fix require a change to the kit repo? Yes → kit. No → active. In a client-mode repo the active repo is the client's tracker (see `.claude/specs/kit/client-mode.md`): only fixes that touch their shipped codebase go there. Non-shipping items — `.claude/` specs, kit tooling, planning notes — go to `.claude/docs/workspace-backlog.md`, never the client tracker.

## Kit vs Project Files

Ownership is per-file via `.claude/.kit-manifest`, not per-directory. A single directory like `.claude/commands/` can contain both kit-synced files and project-custom files. Check the manifest to know which is which. Do not modify kit-owned files in downstream projects — changes will be overwritten on next sync.

**Kit-owned (listed in `.kit-manifest`, do not modify):**
- `CLAUDE.md` — these instructions
- `commands/` — kit-synced commands (project-custom commands alongside them are safe)
- `hooks/` — kit-synced hooks (project-custom hooks alongside them are safe)
- `skills/` — kit-synced skills (project-custom skills alongside them are safe)
- `agents/` — kit-synced agent definitions (project-custom agents alongside them are safe)
- `specs/kit/`, `specs/lenses/`, `specs/claude-code/`, `specs/design/craft.md` — kit-owned spec subtrees

**Project-specific (safe to modify):**
- Any file in `.claude/` not listed in `.kit-manifest` — project-custom skill, command, agent, hook, or spec
- `docs/` — project documentation and research
- `specs/stack-config.yaml` — operational registry of which specs apply to which files
- `specs.yaml` — optional config declaring `project_specs_root`
- The directory `project_specs_root` points to — project rules and patterns generated by `/sync-stack` and `/init-project`. Default is `.claude/specs/` in personal mode, `docs/specs/` in client mode. Resolved by `.claude/hooks/lib/spec-roots.cjs`.
- `settings.local.json` — per-project permissions
- `research/` — project research
- `agent-memory/` — agent persistent memory
- `agent-memory-local/` — agent local memory, gitignored

## MCP Tools

Every project inherits Gmail, Google Calendar, and Google Drive via account-level Claude.ai connectors, plus context7 and antigravity at user scope. Do not install these per-project. See `.claude/specs/kit/mcp-configuration.md` for the full scope model and decision tree.

## Workflow

**Setup (once per project):**
/init-project → /sync-stack → /plan

**Working (repeatable):**
GitHub Issue → /research → /define → /ideate → /build → /test → /review → /commit → Merge

Skills map to design thinking phases. /research is the entry point. /build is the commitment point (creates branch, marks issue in-progress). Commit skill handles push + PR. Issue auto-closes on merge.

**Planning (anytime):**
Use /plan to create issues, review backlog, prioritize, manage milestones. GitHub Issues are the system of record.

**Parallel/background work:** two mechanisms, pick by mode.

**Dispatch — autonomous, headless.** Use `/dispatch <issue-numbers>` to fire autonomous workers on independent issues. Each worker runs in its own git worktree and reports back on the next prompt. For issues that touch any path under `.claude/` (hooks, skills, specs, docs, commands, agents, research) or user-scope settings, pass `--plan-only`: the worker stops after `/ideate` and posts its full implementation plan as an issue comment. The orchestrator applies the plan in a follow-up session. Claude Code's built-in sensitive-file gate refuses Write/Edit on these paths in non-interactive sessions; `--plan-only` short-circuits the failure path and preserves the research/define/ideate work. Dispatch auto-applies the flag per-target when an issue body references one of these subtrees; opt out with `--no-auto-plan-only`. See `.claude/specs/kit/dispatch.md` Plan-Only Mode for the empirical scope.

**Conductor — interactive, user-visible.** Conductor runs parallel agents in separate workspaces, each a git worktree, with the full kit firing inside. You cannot create a workspace yourself, there is no CLI or API. Instead, direct Luis to open one, via ⌘⇧N or by starting it from the GitHub issue, and name the issue it should take. The session is interactive, so the sensitive-file gate never fires and a Conductor worker edits `.claude/` directly with no `--plan-only`. Prefer Conductor for `.claude/`-heavy issues or work Luis wants to watch or steer; prefer dispatch for fire-and-forget on independent issues. Tell Luis to open workspaces one at a time: firing several at once races on git's `index.lock`.

## Project Objective and Skill Map

_Section template per #179 framework Step 5. `/init-project` Step 6.6 writes the filled version into the project's root `CLAUDE.md`, which is project-owned and survives sync. Don't fill it in this file: `.claude/CLAUDE.md` is kit-synced and overwritten on every sync. The kit's own filled version lives in `/CLAUDE.md` at the repo root._

### Objective

_One sentence. What does this project produce. Verb-first._

### Skill map

_Single-purpose plugins, 2-8 components each. Some larger if cohesive. For multi-tenant projects, run #179 Step 0 Workflow Discovery first. For single-tenant, skip Step 0. Group primitives by purpose, not by file-system location._

_Plugin format:_
- `plugin-name`. One-sentence purpose. Component list of skills, hooks, specs, agents, commands, scripts.

_Example from kit-as-instance test case: `workflow-engine`. Drive project through design-thinking phases. Skills: research, define, ideate, build, test, review, commit, plan, handoff. Hooks: enforce-skills, verify-before-stop._

## GitHub Issues as Design Thinking Records

GitHub issues capture the design thinking journey, not just task status. Every issue should record the research, reasoning, alternatives considered, and why decisions were made.

**When writing or updating issues:**
- Document the WHY, not just the WHAT
- Include alternatives considered and why they were rejected
- Capture research findings and evidence as they happen
- Use the design thinking phases to structure the journey

**When to create a new issue vs continue the current one:**

STAY on the current issue when: same root problem, issue found while testing, refinement of approach, Definition of Done not yet met.

CREATE a new issue when: different Definition of Done, could be solved independently, different component or domain, would significantly expand current scope.

**When to close an issue:**

NEVER close an issue until the fix has been verified and tested. Writing code that should fix something is not the same as confirming it works. If you cannot verify in the current session, leave the issue open and document what was done.

Do NOT use "Closes #X" in commits unless the fix has been tested and confirmed working.

## Specs

Specs define project rules and patterns in `.claude/specs/`. Before making changes, read the relevant specs. The enforce-specs hook blocks edits until you do.

To generate specs: `/sync-stack`
To add a library: `/sync-stack prisma`
To add custom rules: `/sync-stack --custom api-conventions`

## Skill Authorship

See `.claude/specs/kit/skills.md` for the description budget, required structure, and golden eval gate. Every new skill must clear that bar before merge.

## Hooks

Hooks enforce behavior. Don't fight them.

- **enforce-specs** — blocks edits until specs are read
- **enforce-skills** — blocks git commit, requires Skill tool for full workflow
- **enforce-plan** — blocks `gh issue create` until plan skill is read
- **enforce-voice** — blocks pbcopy until voice guidelines reviewed and content revised
- **block-dangerous** — blocks rm -rf, force push, credential exposure
- **verify-before-stop** — checks for debug statements and incomplete skill steps
- **awareness** — prompts for /analyze (run from claude-kit) after repeated tool failures

If a hook blocks you, there's a reason.

## Before Writing Content on Luis's Behalf

When content will represent Luis externally: articles, emails, posts, bios, applications, portfolio.

- **No em dashes.** Use periods or colons.
- **No parens.** Use a comma, colon, or new sentence.
- **No corporate speak.** No leverage, synergize, optimize, ensure, utilize, passionate, world-class, best-in-class, ninja, rockstar, guru.

**Luis says:** "I don't know" when true, "I figured it out", "I learned...", "The constraint was...", "What worked was...", "The trade-off was..."

**Luis NEVER says:** "I'm passionate about...", "leverage/synergize/optimize", "world-class/best-in-class", "ninja/rockstar/guru", "utilize" instead of "use", "ensure" instead of "make sure".
