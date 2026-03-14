# Research Synthesis: Research-Backed Architecture Decisions

*How the research informs VOIR's implementation*

---

## Summary: What the Research Says

### Memory Systems

| System | Key Insight | Relevance to VOIR |
|--------|-------------|-------------------|
| **Mem0** | Vector + graph storage, automatic tagging, bi-temporal | Too complex for local-first; useful for team aggregation later |
| **Zep** | Actor-relations, community summaries, temporal tracking | Good patterns for "who said what when" |
| **LangMem** | Namespaced isolation (user, session, agent) | **Adopt**: Clear namespace model for pillars |
| **Letta** | Self-editing memory, agent-controlled | Interesting but requires LLM in the loop |
| **ContextForge** | Markdown files, git-backed, Cursor-specific | **Most aligned**: Plain files, portable, transparent |

**Key pattern:** Namespace-based isolation with semantic + episodic memory types.

### Observability Systems

| System | Key Insight | Relevance to VOIR |
|--------|-------------|-------------------|
| **LangSmith** | LangChain-native, SaaS-only, callbacks | Good dashboards, but locked to ecosystem |
| **Langfuse** | Self-hostable, ClickHouse analytics, MIT license | **Model for local analytics** |
| **Helicone** | Proxy-based, 50-80ms overhead | Not applicable (we use hooks) |
| **Phoenix** | OpenTelemetry native, Apache 2.0 | Good tracing patterns |

**Key pattern:** ClickHouse-style analytics on local data; OpenTelemetry conventions for spans.

### Instrumentation

| Approach | Latency | Code Changes | Data Control | VOIR Applicability |
|----------|---------|--------------|--------------|-------------------|
| SDK Decorators | Minimal | Required | High | Not applicable |
| Proxy | 50-80ms | URL change | Medium | Not applicable |
| **Hooks** | ~0ms | Config only | High | **Primary approach** |
| OTel Auto | Minimal | Bootstrap | High | Future consideration |

**Key insight:** Hook-based capture is zero-latency and provides complete tool I/O data. This is VOIR's primary data source for Claude Code.

### Evaluation Methods

| Method | Speed | Subjectivity | When to Use |
|--------|-------|--------------|-------------|
| Code-based metrics | Fast | Deterministic | Latency, token counts, error rates |
| LLM-as-judge | Slow | High | Subjective quality, helpfulness |
| Human annotation | Slowest | Ground truth | Training evaluation, edge cases |

**Key insight:** Combine all three. Code metrics for dashboard, LLM-as-judge for effectiveness scoring, user feedback for calibration.

### Competitive Landscape

**The memory gap has closed:**
- GitHub Copilot launched memory (March 2026)
- Windsurf has built-in Memories
- Cursor has third-party solutions (ContextForge, Basic Memory)

**VOIR's differentiators:**
1. **Portability** - Works across AI tools (not locked to one)
2. **Transparency** - Plain files users can read/edit
3. **Extensibility** - Hook system for custom tracking
4. **Cross-tool** - Unified layer for the 2.3 tools average developers use

---

## Research → Architecture Mapping

### Decision 1: Three Pillars Data Model

**Research basis:**
- LangMem's namespace isolation (user/session/agent scopes)
- ContextForge's markdown-based approach
- Letta's semantic + episodic memory distinction

**Implementation:**

| Pillar | Research Pattern | VOIR Implementation |
|--------|------------------|---------------------|
| **Memory** | LangMem user namespace + semantic type | `memory.json` - accumulated learnings |
| **Context** | LangMem session namespace + episodic type | `context.json` - current state |
| **Patterns** | ContextForge's spec files | `specs/` - decisions, coding patterns |

**Research gap:** None of the reviewed systems handle "personal profile" as a distinct concept. VOIR should add a fourth pillar or include it in Memory.

### Decision 2: Storage Architecture

**Research basis:**
- VS Code storage options: globalState (synced), globalStorageUri (files), SecretStorage
- Langfuse architecture: ClickHouse for analytics, Postgres for metadata
- ContextForge: Plain markdown in git-tracked directories

**Recommendation:**

```
~/.voir/                          # globalStorageUri-style
├── config.json                   # Global settings
├── global/
│   ├── profile.md                # Personal profile (NEW)
│   ├── learnings.md              # Cross-workspace learnings
│   └── voice.md                  # Writing preferences
└── workspaces/{hash}/
    ├── brain/
    │   ├── memory.json           # Structured for queries
    │   └── context.json          # Current state
    ├── specs/                    # Plain markdown (git-friendly)
    ├── sessions/                 # Per-session JSONL (analytics)
    └── analytics/
        └── effectiveness.json    # Computed metrics
```

**Why files over SQLite initially:**
- ContextForge proves markdown works for memory
- Users can read/edit directly
- Git-friendly (version control)
- SQLite can be added later for complex queries

**Migration path:** Start with files, add SQLite for analytics if needed.

### Decision 3: Capture Architecture

**Research basis:**
- Claude Code hooks: ~0ms latency, complete tool I/O
- Architecture-instrumentation research: Hooks are config-only, high data control
- VS Code Language Model API: Emerging for Copilot-like tools

**Implementation:**

| AI Tool | Capture Method | Data Available |
|---------|---------------|----------------|
| Claude Code | Hooks (PostToolUse, SessionStart, etc.) | All tool calls, session lifecycle |
| GitHub Copilot | VS Code Language Model API (when available) | Completions, suggestions |
| Cursor | File watchers on Cursor's data directories | Limited |
| Generic | Activity monitoring + user annotation | Minimal |

**What we CAN capture (Claude Code):**
- All tool calls (file ops, bash, web searches)
- Skill/command invocations
- MCP tool usage
- Success/failure status
- Session duration

**What we CANNOT capture:**
- Raw LLM prompts/responses (not exposed in hooks)
- Token usage (not in PostToolUse data)
- Internal Claude reasoning

**Research gap:** No clean way to capture from Cursor/Windsurf. Start Claude Code-first, add others via adapters.

### Decision 4: Effectiveness Analysis

**Research basis:**
- Architecture-data-evaluation research: Code + LLM + Human evaluation
- Braintrust: Connects all stages (dataset → scoring → monitoring → CI enforcement)
- DeepEval: Agent-specific metrics (tool correctness, plan adherence)

**Implementation:**

| Metric Type | Example | How Computed |
|-------------|---------|--------------|
| **Quantitative** | Session duration, tool calls, errors | Code-based (from session data) |
| **Qualitative** | "Was this helpful?" | LLM-as-judge on session transcript |
| **User feedback** | Thumbs up/down on sessions | User annotation |

**Effectiveness questions (from original research):**
1. "Is AI helping me?" → Effectiveness score trend
2. "What's working?" → Pattern detection on successful sessions
3. "What's failing?" → Error clustering, common failure modes
4. "Am I improving?" → Trend analysis over time

**Agent-specific metrics (from DeepEval):**
- Tool correctness (did it call the right tools?)
- Argument correctness (did it pass the right params?)
- Step efficiency (did it take the optimal path?)

### Decision 5: Personal Profile

**Research basis:**
- Luis's session context pattern (methodology, learnings, preferences)
- No competitor implements this well
- Antigravity's brain structure (identity + workspace-specific data)

**What profile should include:**

| Category | Examples | Storage Location |
|----------|----------|------------------|
| **Identity** | Name, role, goals | `~/.voir/global/profile.md` |
| **Preferences** | Communication style, detail level | `~/.voir/global/profile.md` |
| **Voice** | Writing rules, no em dashes | `~/.voir/global/voice.md` |
| **Learnings** | Corrections, patterns | `~/.voir/global/learnings.md` |

**Why this matters:** This is what makes AI an effective partner. It's the "context engineering" that Luis's framework provides.

### Decision 6: VS Code Extension Architecture

**Research basis:**
- Technical-implementation-path: Plugin-based for Claude Code, extension for visual
- VS Code extension patterns: Tree views, webviews, file system watchers

**Implementation:**

| Component | VS Code Concept | Purpose |
|-----------|----------------|---------|
| Activity bar icon | viewsContainers | Access point for VOIR |
| Sessions tree | TreeDataProvider | Browse session history |
| Memory tree | TreeDataProvider | View/edit learnings |
| Patterns tree | TreeDataProvider | View/edit specs |
| Dashboard | WebviewPanel | Analytics visualization |
| Settings | WebviewPanel | Configuration UI |
| Status bar | StatusBarItem | Quick indicators |

**File watchers for reactivity:**
- Watch `~/.voir/` for data changes
- Update views when hooks write new data

### Decision 7: LLM-Agnostic Adapter Pattern

**Research basis:**
- Architecture-instrumentation: Different tools need different capture methods
- Viability-synthesis: Cross-tool support is a differentiator

**Interface:**

```typescript
interface AIToolAdapter {
  name: string;

  // Detection
  detect(): Promise<boolean>;

  // Lifecycle
  startCapture(): void;
  stopCapture(): void;

  // Data access
  getSessions(): Promise<Session[]>;
  getActiveSession(): Session | null;

  // Capability flags
  capabilities: {
    canCaptureToolCalls: boolean;
    canCapturePrompts: boolean;
    canCaptureTokens: boolean;
  };
}
```

**Initial adapters:**
1. `ClaudeCodeAdapter` - Primary, uses hooks
2. `GenericAdapter` - Fallback, user annotation only

**Future adapters:**
- `CopilotAdapter` - VS Code Language Model API
- `CursorAdapter` - File watchers
- `WindsurfAdapter` - TBD

---

## Context Injection Patterns (Research Gap Filled)

How do AI coding tools inject persistent context into prompts?

### Cursor

| Method | Mechanism | When Used |
|--------|-----------|-----------|
| **Workspace indexing** | Semantic index of entire codebase | Auto-retrieval on every prompt |
| **@-mentions** | Explicit injection (`@file`, `@codebase`, `@Docs`) | User-triggered |
| **Rules files** | `.cursor/rules/` in MDC format | Prepended to all prompts in project |
| **Memories** | Settings → Generate Memories | Retrieved when relevant |

**Key insight:** Dynamic context discovery - include only what's relevant. Less context = less confusion.

### Windsurf

| Method | Mechanism | When Used |
|--------|-----------|-----------|
| **Auto-generated Memories** | Cascade detects useful context, stores in `~/.codeium/windsurf/memories/` | Retrieved when relevant |
| **Manual Memories** | User prompts "create a memory of..." | Retrieved when relevant |
| **Rules** | Version-controlled in repo | Always included |
| **@-commands** | `@codebase`, `@file`, etc. | User-triggered |

**Windsurf's injection pipeline:**
1. Load relevant Memories from previous sessions
2. Read open files (active file weighted highest)
3. Run codebase retrieval (M-Query) for semantically relevant snippets
4. Read recent actions (file edits, terminal commands, navigation)
5. Assemble final prompt - merge, weight, trim to context window

### Claude Code

| Method | Mechanism | When Used |
|--------|-----------|-----------|
| **CLAUDE.md** | Auto-loaded from `.claude/CLAUDE.md` | Every prompt |
| **SessionStart hook** | Inject context at session start | Once per session |
| **UserPromptSubmit hook** | Inject context before each prompt | Every prompt |
| **PreToolUse hook** | Inject context before tool execution | Per tool call |

**Key insight:** Claude Code has no built-in RAG. Hooks provide the injection points - you control what gets injected.

### Comparison Matrix

| Capability | Cursor | Windsurf | Claude Code |
|------------|--------|----------|-------------|
| Auto-indexing | Yes | Yes | No |
| Semantic retrieval | Yes (workspace index) | Yes (M-Query) | No |
| User-triggered injection | @-mentions | @-commands | @-mentions (limited) |
| Project rules | .cursor/rules/ | AGENTS.md, Rules | CLAUDE.md |
| Memory persistence | Local | Local (~/.codeium/) | Via hooks only |
| Injection hooks | No | No | Yes (full control) |

### Implications for VOIR

**VOIR's injection strategy by tool:**

| AI Tool | VOIR's Role | Injection Method |
|---------|-------------|------------------|
| **Claude Code** | Full control via hooks | SessionStart (profile), UserPromptSubmit (memory, context) |
| **Cursor** | Provide source files | Write to .cursor/rules/, let Cursor inject |
| **Windsurf** | Provide source files | Write to ~/.codeium/windsurf/memories/, let Windsurf inject |
| **Generic** | Limited | Suggest copy-paste, or write to tool's config location |

**Key architectural decision:** VOIR manages the source of truth (four pillars). Per-tool adapters handle injection using each tool's native mechanism.

---

## Gaps and Open Questions

### Research Gaps

1. ~~**Context injection patterns**~~ - ✓ RESOLVED (see section above)

2. **No research on compliance/specs enforcement**
   - How do teams enforce coding standards with AI?
   - Luis's framework uses PreToolUse hooks to block edits until specs read
   - **Action:** Research compliance patterns in AI tooling

3. **Limited research on cross-tool memory**
   - How to unify memory across different AI tools?
   - Data format compatibility, sync strategies
   - **Action:** Define common memory schema

### Implementation Open Questions

1. **Profile management UI**
   - How do users edit their profile?
   - Settings panel? Dedicated view? Plain file editing?

2. **Effectiveness scoring algorithm**
   - What makes a session "effective"?
   - User feedback weight vs automated metrics

3. **Workspace hash strategy**
   - How to identify workspaces uniquely?
   - Git remote? Path hash? User-defined?

---

## Summary: Research-Backed Decisions

| Decision | Research Basis | Confidence |
|----------|---------------|------------|
| Three Pillars (Memory/Context/Patterns) | LangMem namespaces, ContextForge files | High |
| File-based storage initially | ContextForge, VS Code globalStorageUri | High |
| Hook-based capture for Claude Code | Architecture-instrumentation research | High |
| Code + LLM + Human evaluation | Braintrust, DeepEval patterns | High |
| Personal Profile pillar | Luis's framework, no competitor does this | Medium |
| LLM-agnostic adapters | Architecture-instrumentation, viability-synthesis | Medium |
| SQLite for analytics later | Langfuse architecture, migration paths | Low (future) |

---

## Next Steps

1. **Update architecture decisions** with research basis
2. **Add Profile pillar** to project-brief.md
3. **Research context injection** patterns
4. **Research compliance enforcement** patterns
5. **Define workspace hashing** strategy
