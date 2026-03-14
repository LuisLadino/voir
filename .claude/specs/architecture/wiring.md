# Project Wiring

## What VOIR Is

VOIR is an **LLM-agnostic framework** packaged as a VS Code extension. It:

1. **Creates and manages** the data infrastructure (brain, specs, memory)
2. **Captures** what LLMs are doing during coding sessions
3. **Analyzes** effectiveness and patterns
4. **Visualizes** everything through VS Code UI

VOIR works with any AI coding tool: Claude Code, Copilot, Cursor, Windsurf, etc.

---

## System Architecture

```mermaid
graph TB
    subgraph "AI Tools (LLM-Agnostic)"
        claude["Claude Code"]
        copilot["GitHub Copilot"]
        cursor["Cursor"]
        other["Other AI Tools"]
    end

    subgraph "VOIR Framework"
        capture["Session Capture<br/>Hooks / Watchers"]

        subgraph "Four Pillars"
            profile["Profile<br/>Identity & Voice"]
            memory["Memory<br/>Persistent Learnings"]
            context["Context<br/>Session State"]
            patterns["Patterns<br/>Specs & Decisions"]
        end

        subgraph "Analysis"
            metrics["Metrics Engine"]
            effectiveness["Effectiveness Analysis<br/>(Code + LLM + Human)"]
            quality["Quality Scoring"]
        end

        subgraph "Visualization"
            tree["Tree Views"]
            dashboard["Dashboard"]
            settings["Settings UI"]
        end
    end

    subgraph "Data Storage (~/.voir/)"
        global["global/"]
        brain["brain/"]
        specs["specs/"]
        sessions["sessions/"]
    end

    claude --> capture
    copilot --> capture
    cursor --> capture
    other --> capture

    capture --> memory
    capture --> context
    capture --> patterns
    capture --> sessions

    profile --> global
    memory --> brain
    context --> brain
    patterns --> specs

    profile --> metrics
    memory --> metrics
    context --> metrics
    patterns --> metrics
    sessions --> metrics

    metrics --> effectiveness
    metrics --> quality

    effectiveness --> dashboard
    quality --> dashboard
    profile --> settings
    memory --> tree
    patterns --> tree

    style profile fill:#9ff,stroke:#333
    style memory fill:#f9f,stroke:#333
    style context fill:#f9f,stroke:#333
    style patterns fill:#f9f,stroke:#333
```

---

## Data Architecture

### Storage Location

```
~/.voir/                              # VOIR's data directory
├── config.json                       # Global settings
├── global/                           # Profile pillar (cross-workspace)
│   ├── profile.md                    # Identity, goals, preferences
│   ├── voice.md                      # Writing style rules
│   ├── learnings.md                  # Cross-workspace learnings
│   └── analytics/                    # Aggregated metrics
│
└── workspaces/
    └── {workspace-hash}/             # Per-workspace data
        ├── brain/                    # Memory + Context pillars
        │   ├── memory.json           # Persistent learnings
        │   ├── context.json          # Current session state
        │   └── sessions/             # Session history
        │       └── {session-id}.jsonl
        ├── specs/                    # Patterns pillar
        │   ├── stack-config.yaml     # Tech stack
        │   ├── coding/               # Coding patterns
        │   ├── architecture/         # Architecture decisions
        │   └── design/               # Design system
        └── analytics/
            ├── effectiveness.json    # Effectiveness metrics
            └── patterns.json         # Detected patterns
```

**Design rationale:**
- **Profile in global/**: Identity applies across all workspaces
- **Memory in workspace/brain/**: Learnings are project-specific (but can merge to global)
- **Context in workspace/brain/**: Session state is always workspace-specific
- **Patterns in workspace/specs/**: Coding patterns are project-specific

### The Four Pillars

| Pillar | What It Stores | Purpose |
|--------|----------------|---------|
| **Profile** | Identity, preferences, goals, voice | Who you are and how you work |
| **Memory** | Learnings, corrections, accumulated knowledge | What the system has learned about you |
| **Context** | Session state, current task, workspace info | What's happening now |
| **Patterns** | Specs, decisions, technical choices | How code should be written |

**Research basis:** LangMem namespace isolation, ContextForge markdown approach, claude-dev-framework personal context patterns.

### Data Flow

```mermaid
sequenceDiagram
    participant User
    participant LLM as AI Tool (any)
    participant VOIR
    participant Storage as ~/.voir/

    User->>LLM: Works with AI
    LLM->>VOIR: Session events captured
    VOIR->>Storage: Store in three pillars
    VOIR->>VOIR: Analyze effectiveness
    VOIR->>User: Visualize in VS Code

    Note over VOIR,Storage: VOIR creates and manages all data
    Note over LLM,VOIR: Works with any AI coding tool
```

---

## LLM Integration (Agnostic)

VOIR both captures data FROM and injects context INTO AI tools.

### Capture (Data In)

| AI Tool | How VOIR Captures |
|---------|-------------------|
| Claude Code | Hooks (PostToolUse, SessionStart, etc.) |
| Cursor | File watchers on Cursor data directories |
| Windsurf | File watchers on ~/.codeium/ |
| Other tools | Generic file/activity monitoring |

### Injection (Context Out)

| AI Tool | How VOIR Injects |
|---------|------------------|
| Claude Code | Hooks (SessionStart, UserPromptSubmit) |
| Cursor | Sync to `.cursor/rules/`, let Cursor's indexer pick it up |
| Windsurf | Sync to `~/.codeium/windsurf/memories/` |
| Other tools | Export/copy functionality |

**Key insight:** VOIR manages the source of truth (four pillars). Per-tool adapters handle injection using each tool's native mechanism.

### Capture Strategy (Data In)

```mermaid
graph LR
    subgraph "Capture Methods"
        hooks["Hook Integration<br/>(Claude Code)"]
        watchers["File Watchers<br/>(Log files)"]
        api["VS Code API<br/>(Extension events)"]
        generic["Activity Monitor<br/>(Fallback)"]
    end

    subgraph "Unified Data"
        session["Session Object"]
    end

    hooks --> session
    watchers --> session
    api --> session
    generic --> session
```

### Injection Strategy (Context Out)

```mermaid
graph LR
    subgraph "VOIR (Source of Truth)"
        profile["Profile"]
        memory["Memory"]
        patterns["Patterns"]
    end

    subgraph "Tool-Native Injection"
        claude_hooks["Claude Code<br/>Hooks"]
        cursor_rules["Cursor<br/>.cursor/rules/"]
        windsurf_mem["Windsurf<br/>~/.codeium/memories/"]
    end

    subgraph "AI Tools"
        claude["Claude Code"]
        cursor["Cursor"]
        windsurf["Windsurf"]
    end

    profile --> claude_hooks
    memory --> claude_hooks
    patterns --> claude_hooks
    claude_hooks --> claude

    profile --> cursor_rules
    memory --> cursor_rules
    patterns --> cursor_rules
    cursor_rules --> cursor

    profile --> windsurf_mem
    memory --> windsurf_mem
    patterns --> windsurf_mem
    windsurf_mem --> windsurf
```

**How it works:**
1. VOIR stores the canonical data (four pillars)
2. When user activates an AI tool, VOIR syncs relevant data to that tool's expected location
3. Each tool uses its native injection mechanism (hooks, rules, memories)
4. User gets consistent context across all tools

---

## Visualization Layer

### What Users See

| View | Purpose | Data Source |
|------|---------|-------------|
| **Sessions Tree** | Browse session history | sessions/ |
| **Memory View** | See/edit learnings | brain/memory.json |
| **Patterns View** | Manage specs | specs/ |
| **Dashboard** | Analytics, effectiveness | analytics/ |
| **Settings** | Configure VOIR | config.json |

### Effectiveness Analysis

The qualitative analysis answers:

- **"Is this helping me?"** → Effectiveness score over time
- **"What's working?"** → Successful pattern detection
- **"What's failing?"** → Error pattern analysis
- **"Am I improving?"** → Trend analysis

```mermaid
graph TB
    subgraph "Raw Data"
        sessions["Session History"]
        outcomes["Task Outcomes"]
        patterns["Pattern Usage"]
    end

    subgraph "Analysis"
        effectiveness["Effectiveness Score"]
        trends["Trend Analysis"]
        recommendations["Recommendations"]
    end

    subgraph "Visualization"
        charts["Charts & Metrics"]
        insights["Insights Panel"]
        alerts["Improvement Alerts"]
    end

    sessions --> effectiveness
    outcomes --> effectiveness
    patterns --> trends

    effectiveness --> charts
    trends --> insights
    effectiveness --> recommendations
    recommendations --> alerts
```

---

## Module Architecture

```
src/
├── extension.ts                 # Entry point
├── types/                       # Type definitions
│
├── core/                        # Framework core
│   ├── pillars/                 # Three pillars management
│   │   ├── memory.ts            # Memory pillar
│   │   ├── context.ts           # Context pillar
│   │   └── patterns.ts          # Patterns pillar
│   ├── storage.ts               # Data persistence
│   └── init.ts                  # First-run setup
│
├── capture/                     # LLM session capture
│   ├── adapters/                # LLM-specific adapters
│   │   ├── claude.ts            # Claude Code adapter
│   │   ├── copilot.ts           # Copilot adapter
│   │   └── generic.ts           # Generic fallback
│   ├── watcher.ts               # File system watchers
│   └── session.ts               # Session management
│
├── analysis/                    # Effectiveness analysis
│   ├── metrics.ts               # Compute metrics
│   ├── effectiveness.ts         # Effectiveness scoring
│   ├── patterns.ts              # Pattern detection
│   └── trends.ts                # Trend analysis
│
├── views/                       # VS Code UI
│   ├── sidebar/                 # Tree views
│   ├── webview/                 # Dashboard
│   └── settings/                # Settings UI
│
└── utils/                       # Utilities
```

### Module Boundaries

| Module | Responsibility | Dependencies |
|--------|----------------|--------------|
| `core/` | Three pillars, storage | types |
| `capture/` | LLM integration | core, types |
| `analysis/` | Effectiveness metrics | core, types |
| `views/` | VS Code UI | core, capture, analysis |

---

## Build Pipeline

```mermaid
graph LR
    subgraph "Source"
        ts["src/**/*.ts"]
    end

    subgraph "Build"
        esbuild["esbuild"]
        tsc["tsc --noEmit"]
    end

    subgraph "Output"
        dist["dist/extension.js"]
    end

    subgraph "Package"
        vsix[".vsix file"]
    end

    ts --> esbuild
    ts --> tsc
    esbuild --> dist
    dist --> vsix
```

---

## First-Run Experience

When user installs VOIR:

1. **Create data directory** → `~/.voir/`
2. **Detect workspace** → Hash current workspace path
3. **Initialize pillars** → Create empty memory, context, patterns
4. **Detect AI tools** → Find Claude Code, Copilot, etc.
5. **Start capture** → Begin monitoring sessions
6. **Show welcome** → Guide user through setup

```mermaid
sequenceDiagram
    participant User
    participant VOIR
    participant FileSystem

    User->>VOIR: Install extension
    VOIR->>FileSystem: Create ~/.voir/
    VOIR->>VOIR: Detect AI tools
    VOIR->>FileSystem: Initialize workspace data
    VOIR->>User: Welcome & setup wizard
    VOIR->>VOIR: Start session capture
    VOIR->>User: Ready to use
```
