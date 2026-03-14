# Project Structure

## Directory Layout

```
voir/
├── src/
│   ├── extension.ts              # Extension entry point
│   ├── types/                    # TypeScript type definitions
│   │   ├── pillars.ts            # Four pillars types (Profile, Memory, Context, Patterns)
│   │   ├── session.ts            # Session data types
│   │   ├── events.ts             # Event types
│   │   ├── config.ts             # Configuration types
│   │   ├── adapters.ts           # AI tool adapter types (capture + injection)
│   │   ├── injection.ts          # Context injection types per tool
│   │   └── index.ts              # Type exports
│   │
│   ├── core/                     # Framework core (Four Pillars)
│   │   ├── pillars/              # Pillar management
│   │   │   ├── profile.ts        # Profile pillar (identity, preferences, voice)
│   │   │   ├── memory.ts         # Memory pillar (learnings, corrections)
│   │   │   ├── context.ts        # Context pillar (session state)
│   │   │   └── patterns.ts       # Patterns pillar (specs, decisions)
│   │   ├── storage.ts            # Data persistence (~/.voir/)
│   │   ├── workspace.ts          # Workspace detection and management
│   │   └── init.ts               # First-run initialization
│   │
│   ├── capture/                  # LLM session capture
│   │   ├── adapters/             # LLM-specific adapters
│   │   │   ├── base.ts           # Abstract adapter interface
│   │   │   ├── claude.ts         # Claude Code adapter (hooks-based)
│   │   │   ├── cursor.ts         # Cursor adapter (file-based)
│   │   │   ├── windsurf.ts       # Windsurf adapter (file-based)
│   │   │   └── generic.ts        # Generic fallback adapter
│   │   ├── injection/            # Context injection per tool
│   │   │   ├── claude-hooks.ts   # Generate Claude Code hooks
│   │   │   ├── cursor-rules.ts   # Sync to .cursor/rules/
│   │   │   └── windsurf-mem.ts   # Sync to ~/.codeium/windsurf/memories/
│   │   ├── watcher.ts            # File system watchers
│   │   ├── detector.ts           # AI tool detection
│   │   └── session.ts            # Session management
│   │
│   ├── analysis/                 # Effectiveness analysis
│   │   ├── metrics.ts            # Calculate metrics
│   │   ├── effectiveness.ts      # Effectiveness scoring
│   │   ├── patterns.ts           # Pattern detection
│   │   └── trends.ts             # Trend analysis over time
│   │
│   ├── views/                    # VS Code UI
│   │   ├── sidebar/              # Sidebar tree views
│   │   │   ├── SessionsTree.ts   # Session history tree
│   │   │   ├── MemoryTree.ts     # Memory/learnings tree
│   │   │   └── PatternsTree.ts   # Patterns/specs tree
│   │   ├── webview/              # Dashboard webview
│   │   │   ├── DashboardPanel.ts # Panel manager
│   │   │   └── ui/               # Webview UI (HTML/CSS/JS)
│   │   ├── settings/             # Settings UI
│   │   │   └── SettingsPanel.ts  # Settings webview
│   │   └── statusBar.ts          # Status bar items
│   │
│   └── utils/                    # Shared utilities
│       ├── paths.ts              # Path resolution
│       ├── hash.ts               # Workspace hashing
│       ├── parsing.ts            # Data parsing
│       └── formatting.ts         # Display formatting
│
├── test/                         # Test files
│   ├── unit/                     # Unit tests
│   ├── integration/              # Integration tests
│   └── fixtures/                 # Test data
│
├── resources/                    # Extension resources
│   ├── voir-icon.svg             # Activity bar icon
│   └── icons/                    # UI icons
│
├── docs/                         # Documentation
│   └── research/                 # Research docs
│
├── .claude/                      # Claude Code config (for dev)
│   └── specs/                    # Project specs
│
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
├── vitest.config.ts              # Test config
├── README.md                     # Project readme (user-facing)
├── CHANGELOG.md                  # Version history (Keep a Changelog format)
├── CONTRIBUTING.md               # Contributor guidelines
└── LICENSE                       # MIT license
```

## User Data Structure

VOIR creates and manages this data structure (Four Pillars):

```
~/.voir/                              # VOIR data directory
├── config.json                       # Global settings
├── global/                           # PROFILE PILLAR (cross-workspace)
│   ├── profile.md                    # Identity, goals, preferences
│   ├── voice.md                      # Writing style rules
│   ├── learnings.md                  # Cross-workspace learnings
│   └── analytics/                    # Aggregated metrics
│
└── workspaces/
    └── {workspace-hash}/             # Per-workspace data
        ├── brain/                    # MEMORY + CONTEXT PILLARS
        │   ├── memory.json           # Persistent learnings
        │   ├── context.json          # Current session state
        │   └── sessions/             # Session history
        │       └── {id}.jsonl
        ├── specs/                    # PATTERNS PILLAR
        │   ├── stack-config.yaml
        │   ├── coding/
        │   ├── architecture/
        │   └── design/
        └── analytics/                # Computed analysis
            ├── effectiveness.json
            └── patterns.json
```

**Pillar mapping:**
| Pillar | Location | Scope |
|--------|----------|-------|
| Profile | `global/profile.md`, `global/voice.md` | Cross-workspace |
| Memory | `workspaces/{hash}/brain/memory.json` | Per-workspace |
| Context | `workspaces/{hash}/brain/context.json` | Per-workspace |
| Patterns | `workspaces/{hash}/specs/` | Per-workspace |

## Module Responsibilities

### Core (`src/core/`)

The framework's foundation - manages the four pillars.

| File | Responsibility |
|------|----------------|
| `pillars/profile.ts` | Identity, preferences, goals, voice (global) |
| `pillars/memory.ts` | CRUD for learnings, corrections (per-workspace) |
| `pillars/context.ts` | Session state, current task (per-workspace) |
| `pillars/patterns.ts` | Specs, decisions, coding patterns (per-workspace) |
| `storage.ts` | Read/write to `~/.voir/`, file operations |
| `workspace.ts` | Workspace detection, hash generation |
| `init.ts` | First-run setup, create data structure |

### Capture (`src/capture/`)

LLM-agnostic session capture AND context injection.

| File | Responsibility |
|------|----------------|
| `adapters/base.ts` | Abstract adapter interface (capture + injection) |
| `adapters/claude.ts` | Claude Code adapter (hooks-based) |
| `adapters/cursor.ts` | Cursor adapter (file-based) |
| `adapters/windsurf.ts` | Windsurf adapter (file-based) |
| `adapters/generic.ts` | Fallback for unknown tools |
| `injection/claude-hooks.ts` | Generate hooks that inject VOIR context |
| `injection/cursor-rules.ts` | Sync VOIR data to .cursor/rules/ |
| `injection/windsurf-mem.ts` | Sync VOIR data to ~/.codeium/memories/ |
| `watcher.ts` | File system watchers for log files |
| `detector.ts` | Detect which AI tools are installed |
| `session.ts` | Session lifecycle management |

### Analysis (`src/analysis/`)

Effectiveness analysis - pure functions, no dependencies.

| File | Responsibility |
|------|----------------|
| `metrics.ts` | Calculate session metrics |
| `effectiveness.ts` | Score effectiveness (is AI helping?) |
| `patterns.ts` | Detect successful/failing patterns |
| `trends.ts` | Track improvement over time |

### Views (`src/views/`)

VS Code UI integration.

| File | Responsibility |
|------|----------------|
| `sidebar/SessionsTree.ts` | Browse session history |
| `sidebar/MemoryTree.ts` | View/edit learnings |
| `sidebar/PatternsTree.ts` | View/edit specs |
| `webview/DashboardPanel.ts` | Rich analytics dashboard |
| `settings/SettingsPanel.ts` | Configure VOIR |
| `statusBar.ts` | Quick status indicators |

## Module Boundaries

| Module | Can Import | Cannot Import |
|--------|------------|---------------|
| `types/` | Nothing | - |
| `utils/` | `types/` | VS Code API |
| `core/` | `types/`, `utils/` | VS Code API |
| `capture/` | `types/`, `utils/`, `core/` | VS Code API (except watcher) |
| `analysis/` | `types/` | Everything else |
| `views/` | Everything | - |

### Rationale

- `core/` is framework foundation - no VS Code dependency for portability
- `analysis/` has zero dependencies for testability
- `capture/` uses Node.js fs where possible, VS Code only for watchers
- `views/` is the integration layer, can access everything

## Naming Conventions

### Files
- TypeScript: `camelCase.ts` (e.g., `sessionStore.ts`)
- Tests: `*.test.ts` (e.g., `memory.test.ts`)
- Components: `PascalCase.ts` (e.g., `DashboardPanel.ts`)

### Classes
- PascalCase: `MemoryPillar`, `SessionCapture`, `DashboardPanel`
- Tree providers: `*Tree` (e.g., `SessionsTree`)
- Panels: `*Panel` (e.g., `DashboardPanel`)

### Functions
- camelCase: `loadMemory`, `calculateEffectiveness`
- Handlers: `handle*` (e.g., `handleSessionStart`)
- Getters: `get*` (e.g., `getWorkspaceHash`)

### Types/Interfaces
- PascalCase: `Memory`, `Session`, `EffectivenessScore`
- Configs: `*Config` (e.g., `VoirConfig`)

## Extension Manifest

Key contribution points in `package.json`:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "voir",
        "title": "VOIR",
        "icon": "resources/voir-icon.svg"
      }]
    },
    "views": {
      "voir": [
        { "id": "voir.sessions", "name": "Sessions" },
        { "id": "voir.memory", "name": "Memory" },
        { "id": "voir.patterns", "name": "Patterns" }
      ]
    },
    "commands": [
      { "command": "voir.showDashboard", "title": "VOIR: Show Dashboard" },
      { "command": "voir.showSettings", "title": "VOIR: Settings" },
      { "command": "voir.initialize", "title": "VOIR: Initialize Workspace" },
      { "command": "voir.refresh", "title": "VOIR: Refresh" }
    ]
  }
}
```

## Project Governance

### Documentation Layers

| Document | Audience | Purpose |
|----------|----------|---------|
| `README.md` | Users | What VOIR is, how to install, basic usage |
| `CONTRIBUTING.md` | Contributors | How to set up dev environment, code style, PR process |
| `CHANGELOG.md` | Everyone | What changed in each version |
| `.claude/specs/` | Maintainers | Architecture decisions, technical specs |
| `docs/research/` | Maintainers | Research backing decisions |

### Versioning

VOIR follows [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH
  │     │     └── Bug fixes, no API changes
  │     └──────── New features, backwards compatible
  └────────────── Breaking changes
```

Pre-1.0 (`0.x.y`): API may change between minor versions.

### Changelog Maintenance

Use [Keep a Changelog](https://keepachangelog.com/) format:

- **Added** - New features
- **Changed** - Changes in existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Vulnerability fixes

Update `[Unreleased]` section with each PR. Cut releases by moving unreleased items to a versioned section.

### Release Process

1. Update version in `package.json`
2. Move `[Unreleased]` items to new version section in CHANGELOG
3. Create git tag: `git tag v0.1.0`
4. Push tag: `git push origin v0.1.0`
5. GitHub Actions builds and publishes to VS Code Marketplace
