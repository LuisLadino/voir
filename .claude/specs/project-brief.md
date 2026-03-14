# VOIR - Visual Observability for Intelligent Runtimes

## Product Context

**This is a professional open source product, not an MVP or side project.**

Quality bar:
- Polished enough that developers recommend it to others
- Research-backed architecture decisions
- Documentation and governance from day one
- Portfolio piece demonstrating AI product thinking

VOIR is **not just memory/context** - it's a complete observability solution:

| Capability | User Value |
|------------|------------|
| **Four Pillars** | AI that knows you and your project |
| **Session Capture** | See what the LLM actually did |
| **Visualization** | Understand behavior through UI |
| **Effectiveness Analysis** | Know if AI is helping |
| **Compliance/Governance** | AI follows your rules and standards |
| **Cross-tool Support** | One system across all AI tools |

All of these matter equally. Don't tunnel on any single aspect.

---

## Problem

Developers using AI coding assistants lack two things:

1. **A framework for working with AI effectively** - No structured way to persist context, learnings, and patterns across sessions. Every conversation starts from scratch.

2. **Visibility into AI behavior** - No insight into why AI responds the way it does, what's working, what's failing, and whether AI is actually helping.

Current state:
- AI assistants show basic usage stats (messages sent, tokens used)
- No persistent memory that survives across sessions
- No structured way to capture learnings and patterns
- No insight into *why* responses worked or failed
- No effectiveness tracking or improvement suggestions

## What VOIR Is

**VOIR is an LLM-agnostic framework** packaged as a VS Code extension.

It provides:
1. **The Framework** - Creates and manages persistent data (memory, context, patterns)
2. **Session Capture** - Records what happens during AI coding sessions
3. **Effectiveness Analysis** - Answers "Is this actually helping me?"
4. **Visualization** - See and manage everything through VS Code UI

VOIR works with **any AI coding tool**: Claude Code, Copilot, Cursor, Windsurf, etc.

## The Four Pillars

VOIR manages four categories of persistent data:

| Pillar | What It Stores | Purpose |
|--------|----------------|---------|
| **Profile** | Identity, preferences, goals, voice | Who you are and how you work |
| **Memory** | Learnings, corrections, accumulated knowledge | What the system has learned about you |
| **Context** | Session state, current task, workspace info | What's happening now |
| **Patterns** | Specs, decisions, technical choices | How code should be written |

This data persists across sessions and accumulates over time, making AI interactions increasingly effective.

**Research basis:** LangMem's namespace isolation (user/session/agent scopes), ContextForge's markdown-based approach, and patterns from claude-dev-framework for personal context engineering.

## Users

**Primary:** Developers using AI coding assistants (Claude Code, Copilot, Cursor, Continue.dev)

Characteristics:
- Technically sophisticated - comfortable with VS Code, CLI, local tooling
- Power users who want deeper insight into their AI interactions
- Frustrated by AI's lack of memory, context limitations, unclear value
- Privacy-conscious - prefer local-first tooling

User needs:
- **Persistent memory** - AI that remembers across sessions
- **Structured context** - Specs, patterns, decisions that guide AI behavior
- **Effectiveness tracking** - Is AI actually helping? What's working?
- **Session understanding** - Why did AI respond this way?
- **Pattern learning** - What prompting approaches work best?

**Secondary:** AI/LLM Researchers studying model behavior

- Behavioral observation across sessions
- Regression tracking across model versions
- Structured data for human-AI collaboration research

## Solution

**VS Code Extension** that is both a framework AND an observability tool.

### Framework Capabilities
- **Initialize** data structure on install (`~/.voir/`)
- **Manage** the three pillars (memory, context, patterns)
- **Capture** sessions from any AI coding tool
- **Persist** learnings across sessions and workspaces

### Observability Capabilities
- **Visualize** sessions, tool calls, file changes
- **Analyze** effectiveness - what's working, what's not
- **Detect** patterns - successful approaches, failure modes
- **Track** trends - improvement over time

### Key Differentiators
- **LLM-agnostic** - Works with any AI coding tool
- **Local-first** - All data stays on user's machine
- **Transparent** - Plain files (JSON, Markdown) users can read/edit
- **Framework + Observability** - Not just viewing, but managing

## Success Criteria

### Portfolio/Learning Goals
- Demonstrates AI product thinking and technical depth
- Shows understanding of context engineering and observability
- Builds skills in VS Code extension development

### Distribution Goals
- Published to VS Code marketplace and Open VSX
- Open source with meaningful community engagement
- Useful enough that developers recommend it to others

### Technical Goals
- Extension initializes data structure on first run
- Session capture works across AI tools
- Three pillars persist and accumulate correctly
- Effectiveness analysis produces actionable insights
- Visualization is performant and intuitive

### User Outcomes
- Users have persistent memory across AI sessions
- Users understand their AI interactions better
- Users identify what's working and what's not
- Users improve their effectiveness over time

## Quality Approach

**Quality First** - High polish from the start.

Rationale:
- Portfolio piece needs to impress
- Developer tools market has high UX expectations
- VS Code users expect native-quality experiences
- First impressions matter for OSS adoption

Implications:
- Good test coverage
- Consistent, polished UI
- Accessibility considered (WCAG AA baseline)
- Documentation from day one
- Thoughtful error handling
