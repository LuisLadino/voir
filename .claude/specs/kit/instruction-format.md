---
name: instruction-format
description: >
  How to write instructions that Claude follows reliably. Covers formatting patterns, emphasis words, positioning for context retention, and structure templates for agents, skills, and system prompts.
applies_to:
  - ".claude/skills/**/*.md"
  - ".claude/agents/**/*.md"
category: kit
---

# Instruction Format Guide

How to write instructions that Claude follows reliably. Use this when writing agents, skills, system prompts, or any text meant to direct Claude's behavior.

For skill descriptions specifically, the YAML `description:` field that Claude uses to decide whether to fire, see `.claude/specs/kit/skills.md`. The 200-byte budget and three-part structure are skill-specific and stricter than the general guidance here.

**Source:** Claude Code system prompts (Piebald-AI, version 2.1.71-2.1.75) + Claude Code source analysis (March 2026 npm leak, v2.1.88) + Anthropic documentation + LLM context processing research.

## Eval-Validated Patterns

These patterns have measured impact on Claude's instruction compliance. From Claude Code internal eval results and source analysis.

**Action cues outperform abstract framing.** Headers that trigger on a specific action ("Before recommending from memory") achieve 3/3 compliance in evals. Abstract framing of the same body content ("Trusting what you recall") achieves 0/3 in-place. Use "Before doing X" and "When you encounter X" headers, not "About X" or "Understanding X."

**Numeric anchors outperform qualitative instructions.** "≤25 words between tool calls" reduces output tokens ~1.2% compared to "be concise." When you need length control, give a number, not an adjective.

**Negative constraints outperform positive instructions.** "NEVER claim limitations without checking documentation" is more reliable than "Always check documentation before stating limitations." Claude's training makes it more responsive to boundaries than aspirations.

**Header wording is load-bearing.** Changing only the header while keeping the body identical can swing compliance from 0% to 100%. Headers are not labels — they are the primary signal Claude uses to decide whether a section applies to the current action.

**Specific prohibitions outperform general principles.** Name the exact failure mode you're preventing, not the abstract value you're promoting.

Bad: "Be careful with file operations"
Good: "NEVER use rm -rf on directories outside the project root"

**Bidirectional constraints prevent both failure modes.** Most rules address one direction: don't claim success when things fail. The opposite failure is equally real. Hedging confirmed results, downgrading finished work to "partial," re-verifying things already checked. Strong rules prohibit both directions: "Never claim X when Y" AND "when Y did happen, state it plainly."

**Model counterweight instructions should be marked for removal.** Some instructions counteract specific model weaknesses. These are temporary. When the model improves, the counterweight becomes unnecessary or harmful.

Bad: `- Default to writing no comments in code.`
Good: `- Default to writing no comments in code. # counterweight: Opus 4.6 over-comments. Revisit after model update.`

## Why Format Matters

Claude is trained to follow instructions formatted in specific patterns. Using the same patterns as official system prompts increases adherence.

Position also matters. The "lost in the middle" phenomenon means models attend most to beginning and end of context, least to middle. Instructions that must never drift need system prompt placement.

## Format Patterns

### 1. Identity Statement (First Line)

Always start with who/what the agent is:

```
You are [role]. Your primary responsibility is [what you do].
```

**Example:**
```
You are a file search specialist for Claude Code. You excel at thoroughly navigating and exploring codebases.
```

### 2. Critical Sections

For absolute non-negotiable rules, use triple equals and caps:

```
=== CRITICAL: [SECTION NAME] ===
You are STRICTLY PROHIBITED from:
- [specific thing with example]
- [specific thing with example]
```

**Example:**
```
=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Using redirect operators (>, >>, |) to write to files
```

### 3. Bold Section Headers

Use `**bold**` for section organization:

```
**Your expertise spans three domains:**

**Approach:**

**Guidelines:**
```

### 4. Numbered Lists

For sequential procedures or prioritized items:

```
1. First do this
2. Then do this
3. Finally do this
```

### 5. Bullet Points

For specific rules within sections:

```
- Always prioritize X over Y
- NEVER do Z
- Use A when B
```

### 6. Emphasis Words

Use these specific words for different levels of requirement:

- **STRICTLY PROHIBITED** — Absolute no. Use for hard safety boundaries.
- **EXCLUSIVELY** — Only this, nothing else. Use for restricting scope.
- **NEVER** — Hard rule. Use for things that must not happen.
- **ONLY** — Restricted use. Use for limiting when something applies.
- **MUST** — Required action. Use for non-optional steps.
- **ALWAYS** — Every time. Use for consistent behaviors.

### 7. Closing Directive

End with clear instruction:

```
Complete the user's request by [how to complete it].
```

## What Makes Instructions Stick

**Specific over vague**

Bad: "Be careful with files"
Good: "You are STRICTLY PROHIBITED from creating new files (no Write, touch, or file creation of any kind)"

**Examples of what NOT to do**

```
NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit
```

**Explain WHY when helpful**

```
You do NOT have access to file editing tools - attempting to edit files will fail.
```

**Concrete actions, not abstract values**

Bad: "Research thoroughly"
Good: "Use WebFetch to fetch the appropriate docs map"

**Conditional guidance**

```
Use Read when you know the specific file path.
Use WebSearch if docs don't cover the topic.
```

## Structure Template

```markdown
You are [identity]. Your primary responsibility is [core function].

=== CRITICAL: [NON-NEGOTIABLE SECTION] ===
You are STRICTLY PROHIBITED from:
- [specific prohibition with example]
- [specific prohibition with example]

**[Section Name]:**
- [guideline]
- [guideline]

**Approach:**
1. [first step]
2. [second step]
3. [third step]

**Guidelines:**
- Always [do this]
- NEVER [do that]
- When [condition], [action]

Complete [task description] by [how to do it].
```

## Where Instructions Go

Different types of instructions go in different places based on how reliably they need to be followed:

- **System prompt** (`--append-system-prompt`) — Non-negotiable behaviors that need system-message placement. Primacy effect gives beginning of context the most attention. Launcher-dependent: does not load under Conductor or GUI launchers that bypass the shell rc, so core identity and any must-load-everywhere rule belong in `~/.claude/CLAUDE.md` instead. Full caveat: `.claude/docs/prompt-format-guide.md`.
- **CLAUDE.md** — Project-specific behavioral constraints. Loaded per-project, reread every turn, never cached. Use the Tier 1 inclusion filter from the self-documentation spec.
- **Hook injection** — Dynamic context, current task state, per-prompt reminders. Changes per-session or per-prompt.
- **Skills/Agents** — Task-specific procedures. Loaded on demand when activated.

**The "Lost in the Middle" pattern:**
- Beginning: 80-90% accuracy
- Middle: 40-60% accuracy
- End: 75-85% accuracy

Put critical instructions at the beginning or end of context, not buried in the middle. The system prompt and the top of CLAUDE.md sit near the beginning; a closing directive sits at the end. Under a launcher where the system prompt does not load, the top of CLAUDE.md is the only beginning slot.

## Token Budget Awareness

The full Claude Code system prompt is 2,300-3,600 tokens (1-2% of context). Tool definitions add 14-17K tokens. Every instruction section has a cost.

When writing instruction content:
- Know the cost tier of where your content lives (see self-documentation spec)
- Tier 1 content (CLAUDE.md) costs tokens on every prompt. Ruthlessly filter
- Dynamic sections that change between turns break prompt cache. Mark them explicitly

**DANGEROUS_ naming convention:** For functions, sections, or variables that break the prompt cache or have non-obvious cost, prefix with `DANGEROUS_` and require a reason comment:

```typescript
// Good: forces documentation of WHY cache-breaking is needed
DANGEROUS_uncachedSystemPromptSection(
  'mcp_instructions',
  () => getMcpInstructions(),
  'MCP servers connect/disconnect between turns'
)
```

When adding new sections that break prompt cache, use this convention. Not yet in use in kit code.

## Anti-Patterns

**Using documentation format instead of instruction format**

Bad:
```markdown
## Non-Negotiable Behaviors
The following behaviors are expected...
```

Good:
```markdown
=== CRITICAL: NON-NEGOTIABLE BEHAVIORS ===
You are STRICTLY PROHIBITED from:
```

**Abstract values without actions**

Bad: "Be ethical"
Good: "Don't provide instructions for illegal activities like hacking, theft, or fraud"

**Assuming context will be remembered**

In long conversations, instructions in the middle get "lost." If something keeps drifting, move it to system prompt level.

## Examples from Claude Code

### Explore Agent

```markdown
You are a file search specialist for Claude Code. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Running ANY commands that change system state

Your strengths:
- Rapidly finding files using glob patterns
- Searching code with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Read when you know the specific file path
- Use Bash ONLY for read-only operations (ls, git status, git log)
- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit
- Return file paths as absolute paths in your final response

Complete the user's search request efficiently and report your findings clearly.
```

### Claude Guide Agent

```markdown
You are the Claude guide agent. Your primary responsibility is helping users understand and use Claude Code effectively.

**Your expertise spans three domains:**

1. **Claude Code** (the CLI tool): Installation, configuration, hooks, skills, MCP servers.
2. **Claude Agent SDK**: Framework for building custom AI agents.
3. **Claude API**: Direct model interaction, tool use, integrations.

**Approach:**
1. Determine which domain the user's question falls into
2. Use WebFetch to fetch the appropriate docs map
3. Identify the most relevant documentation URLs
4. Provide clear, actionable guidance based on official documentation

**Guidelines:**
- Always prioritize official documentation over assumptions
- Keep responses concise and actionable
- Include specific examples when helpful
- Reference exact documentation URLs

Complete the user's request by providing accurate, documentation-based guidance.
```
