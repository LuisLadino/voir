# Architecture Decisions

## Tech Stack Direction

- **Language:** TypeScript
- **Framework:** VS Code Extension API
- **UI Framework:** Webview with VS Code Webview UI Toolkit + custom components
- **Bundler:** esbuild (VS Code standard)
- **Testing:** Vitest + VS Code Extension Testing
- **Deployment:** VS Code Marketplace + Open VSX

## Architecture Pattern

**Framework + Observability**

VOIR is both a framework AND an observability tool:
1. **Framework** - Creates and manages persistent data (three pillars)
2. **Capture** - Records sessions from any AI coding tool
3. **Analysis** - Computes effectiveness metrics
4. **Visualization** - Multiple view types (tree, dashboard, settings)

---

## Key Decisions

### Decision 1: VS Code Extension (not standalone app)

**Context:** Multiple form factors were considered: standalone desktop app, CLI tool, VS Code extension, browser extension.

**Options considered:**
1. Standalone Electron app - Maximum flexibility, but isolated from IDE
2. CLI tool - Lightweight, but no visual interface
3. VS Code extension - Integrated into developer workflow, rich UI
4. Browser extension - For web-based AI tools only

**Decision:** VS Code extension

**Rationale:**
- Developers work in VS Code (and forks like Cursor, Windsurf, Antigravity)
- Rich UI capabilities via webview
- Natural path to marketplace distribution
- Can capture AI tool activity from within IDE
- Works across VS Code forks

**Consequences:**
- Tied to VS Code ecosystem (but that's where developers are)
- UI constrained by webview capabilities
- Works on any VS Code fork

---

### Decision 2: VOIR IS the Framework

**Context:** Should VOIR observe existing data or create its own?

**Options considered:**
1. Observer only - Read data created by other tools (Claude's ~/.claude/, etc.)
2. Framework only - Create data structure, no observation
3. Framework + Observer - Create own data AND capture from AI tools

**Decision:** Framework + Observer (VOIR IS the framework)

**Rationale:**
- Users don't have existing framework infrastructure
- VOIR needs to create the three pillars (memory, context, patterns)
- Also needs to capture what AI tools are doing
- Provides complete solution, not dependent on other tools

**Consequences:**
- Larger scope - VOIR creates and manages data
- First-run experience needed (initialize data structure)
- VOIR is the source of truth for user's AI workflow data

---

### Decision 3: LLM-Agnostic Design

**Context:** Which AI tools should VOIR support?

**Options considered:**
1. Claude Code only - Deep integration, narrower audience
2. Single tool first, others later - Incremental approach
3. LLM-agnostic from start - Adapter pattern, broader audience

**Decision:** LLM-agnostic from start

**Research basis:**
- Viability synthesis: Developers use 2.3 AI tools on average
- Copilot memory is GitHub-locked, Windsurf is Windsurf-locked
- "Portable, transparent memory layer that works across AI tools" is the differentiator
- Architecture-instrumentation: Different tools need different capture methods

**Rationale:**
- Users often use multiple AI tools
- Market is fragmented (Claude, Copilot, Cursor, etc.)
- Adapter pattern allows adding tools without architecture changes
- Broader value proposition

**Consequences:**
- Need generic capture interface
- Per-tool adapters for specific integrations
- Some tools will have richer data than others
- Generic fallback for unknown tools

---

### Decision 4: Four Pillars Data Model

**Context:** How should persistent data be structured?

**Options considered:**
1. Flat files - Simple, but unstructured
2. Database - Powerful queries, but adds complexity
3. Structured files - JSON/Markdown in organized directories

**Decision:** Four pillars in structured files

**Research basis:**
- LangMem's namespace isolation (user/session/agent scopes)
- ContextForge's markdown-based, git-backed approach
- Letta's semantic + episodic memory distinction
- claude-dev-framework's personal context patterns (profile, learnings, voice)

**Rationale:**
- **Profile** (identity, preferences, goals, voice) - Who you are and how you work
- **Memory** (learnings, corrections) - Persists across sessions
- **Context** (session state, current task) - What's happening now
- **Patterns** (specs, decisions) - How code should be written
- Plain files (JSON, Markdown) are transparent and editable
- No database dependency

**Consequences:**
- Users can read/edit their data directly
- Version control friendly
- No complex queries (but we compute analytics separately)
- Need to manage file organization

---

### Decision 5: Local-First Architecture

**Context:** Where does data live and get processed?

**Options considered:**
1. Cloud-based - Data sent to server
2. Local-only - All data on user's machine
3. Hybrid - Local with optional cloud sync

**Decision:** Local-only (with future hybrid potential)

**Rationale:**
- Privacy is critical for code/AI conversation data
- No infrastructure costs
- Works offline
- Simpler architecture
- Users control their data

**Consequences:**
- No cross-device sync initially
- No team features without future cloud component
- All processing happens locally

---

### Decision 6: Data Location (~/.voir/)

**Context:** Where should VOIR store its data?

**Options considered:**
1. Per-workspace only - Data in each project's `.voir/`
2. Global only - All data in `~/.voir/`
3. Hybrid - Global + per-workspace data

**Decision:** Hybrid with global home directory

```
~/.voir/
├── config.json          # Global settings
├── global/              # Cross-workspace data
└── workspaces/          # Per-workspace data
    └── {hash}/
```

**Rationale:**
- Global settings apply everywhere
- Some learnings cross workspaces
- Per-workspace data is project-specific
- Home directory is standard for user data

**Consequences:**
- Need workspace hashing strategy
- Some data duplicated (or referenced) across workspaces
- Clear separation of concerns

---

### Decision 7: Hybrid Visualization Approach

**Context:** How should data be displayed?

**Options considered:**
1. Tree/hierarchy only - Like DevTools
2. Timeline only - Sequence of events
3. Dashboard only - Summary metrics
4. Hybrid - Multiple views

**Decision:** Hybrid (tree views + dashboard + settings)

**Rationale:**
- Different tasks need different views
- Tree views for browsing (sessions, memory, patterns)
- Dashboard for analytics and effectiveness
- Settings for configuration
- VS Code supports all these natively

**Consequences:**
- More UI work upfront
- Consistent data model serves all views
- Rich user experience

---

### Decision 8: VS Code Native Visual Style

**Context:** What should the UI look like?

**Options considered:**
1. Fully custom design
2. VS Code native
3. Technical/APM aesthetic
4. Minimal/modern

**Decision:** VS Code native, technical where appropriate

**Rationale:**
- Extension should feel like part of VS Code
- Webview UI Toolkit provides consistent components
- Automatic theme support (light/dark)
- Data-dense views where needed

**Consequences:**
- Limited by VS Code design language
- Easier to implement
- Feels professional and integrated

---

### Decision 9: Adapter Pattern for AI Tools

**Context:** How to support multiple AI tools?

**Options considered:**
1. Hardcoded integrations
2. Plugin system
3. Adapter pattern

**Decision:** Adapter pattern

**Research basis:**
- Architecture-instrumentation: Hook-based (~0ms) for Claude Code, VS Code Language Model API for Copilot, file watchers for Cursor
- Each tool exposes different data (some have prompts, some don't)
- OpenTelemetry patterns: Common interface with provider-specific implementations

**Rationale:**
- Common interface for all AI tools
- Per-tool adapters handle specifics
- Easy to add new tools
- Fallback generic adapter for unknown tools

**Consequences:**
- Need to define stable adapter interface
- Some tools have richer data than others
- Can prioritize adapters based on user demand

```typescript
interface AIToolAdapter {
  name: string;
  detect(): Promise<boolean>;
  startCapture(): void;
  stopCapture(): void;
  getSessions(): Promise<Session[]>;
  getActiveSession(): Session | null;
  capabilities: {
    canCaptureToolCalls: boolean;
    canCapturePrompts: boolean;
    canCaptureTokens: boolean;
  };
}
```

---

### Decision 10: Effectiveness Analysis

**Context:** How to measure if AI is helping?

**Options considered:**
1. Simple metrics (tokens, time)
2. Outcome tracking (task success)
3. Pattern analysis (what works)
4. Comprehensive scoring

**Decision:** Comprehensive effectiveness analysis using Code + LLM + Human evaluation

**Research basis:**
- Braintrust: Combines code-based metrics (fast, deterministic) with LLM-as-judge (subjective criteria)
- DeepEval: Agent-specific metrics (tool correctness, argument correctness, step efficiency, plan adherence)
- Architecture-data-evaluation: Quality-aware alerting catches issues that threshold-based alerting misses
- Human annotation provides ground truth calibration

**Rationale:**
- Core value proposition is "Is AI helping me?"
- Need multiple signals to answer this
- Metrics alone aren't enough
- Pattern detection shows what works

**Implementation:**

| Metric Type | Examples | Computation |
|-------------|----------|-------------|
| **Quantitative** | Session duration, tool calls, error rate | Code-based (from session data) |
| **Qualitative** | Helpfulness, task completion | LLM-as-judge on session |
| **User feedback** | Thumbs up/down, annotations | User input |

**Consequences:**
- Significant analysis logic needed
- Need to define effectiveness criteria
- May require user input (did this help?)
- Results shown in dashboard

---

### Decision 11: Context Injection Strategy

**Context:** How does VOIR inject persistent context into AI prompts?

**Options considered:**
1. Direct prompt injection (VOIR calls LLM directly)
2. File-based injection (write files that tools read)
3. Tool-native injection (use each tool's mechanism)
4. Hybrid approach

**Decision:** Tool-native injection with VOIR as source of truth

**Research basis:**
- Cursor: `.cursor/rules/` files, workspace indexing, @-mentions
- Windsurf: `~/.codeium/windsurf/memories/`, Rules, M-Query retrieval
- Claude Code: CLAUDE.md auto-loading, SessionStart/UserPromptSubmit hooks
- Each tool has its own injection mechanism - don't fight it, use it

**Rationale:**
- VOIR manages the canonical data (four pillars)
- Per-tool adapters handle injection using native mechanisms
- No need to intercept or proxy LLM calls
- Works with how users already use each tool

**Implementation:**

| AI Tool | Injection Method | VOIR's Role |
|---------|------------------|-------------|
| **Claude Code** | Hooks (SessionStart, UserPromptSubmit) | Write hook scripts that read VOIR data |
| **Cursor** | .cursor/rules/, Memories setting | Sync VOIR data to Cursor's expected locations |
| **Windsurf** | ~/.codeium/windsurf/memories/, Rules | Sync VOIR data to Windsurf's expected locations |
| **Generic** | Manual copy or config file | Provide export/copy functionality |

**Adapter interface extension:**

```typescript
interface AIToolAdapter {
  // ... existing methods ...

  // Injection capabilities
  injection: {
    supportsAutoInjection: boolean;
    injectionMethod: 'hooks' | 'files' | 'config' | 'manual';
    injectionTargets: string[];  // File paths or hook names
  };

  // Sync VOIR data to tool's native format
  syncProfile(profile: Profile): Promise<void>;
  syncMemory(memory: Memory): Promise<void>;
  syncPatterns(patterns: Patterns): Promise<void>;
}
```

**Consequences:**
- Need to understand each tool's injection format
- Some tools have richer injection than others
- VOIR data must be transformable to each format
- Claude Code has most control (hooks), others are file-based
