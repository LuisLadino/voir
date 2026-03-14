# Data Architecture Patterns for AI Coding Assistants

*Research Date: 2026-03-14*

## Executive Summary

This document compares data architecture patterns for AI coding assistants that need persistent context across sessions. The goal: inform migration from the current file-based Antigravity system to a VS Code extension model while maintaining backwards compatibility and privacy.

---

## 1. Current System: Antigravity Brain

### Architecture

```
~/.gemini/antigravity/brain/
├── learnings.md              # Global: persistent learnings (loaded every SessionStart)
├── voice-profile.md          # Global: voice rules for content writing
├── framework-issues.md       # Global: known framework issues
├── {workspace-uuid}/         # Per-workspace data
│   ├── task.md               # Task history (append-only)
│   ├── session_state.json    # Current state for resuming
│   ├── decisions.md          # Design decisions (append-only)
│   ├── patterns.md           # Technical patterns (append-only)
│   ├── research/             # Research findings
│   └── sessions/             # Per-session tracking files
│       └── {session-id}.json # Tool calls, file changes, commands
└── tracking/                 # Centralized session tracking
    └── sessions/             # All sessions regardless of workspace
```

### Data Flow

1. **SessionStart hook** (`session-context.js`):
   - Reads `~/Repositories/Personal/my-brain/CLAUDE.md` for identity
   - Finds workspace session by matching `session_state.json.workspace` to current directory
   - Loads `task.md`, `session_state.json`, `learnings.md`
   - Outputs context to Claude via stdout

2. **During session** (PostToolUse hooks):
   - `tool-tracker.js`: Logs all tool calls to session JSON
   - `track-changes.js`: Logs file modifications
   - `command-log.js`: Logs bash commands with exit status
   - Data written to `brain/tracking/sessions/{session-id}.json`

3. **PreCompact hook** (`pre-compact.js`):
   - Writes `task.md` and `session_state.json` to workspace brain folder
   - Detects corrections, prompts for learnings capture

4. **SessionEnd hook** (`session-end.js`):
   - Writes session summary to brain
   - Updates `session_state.json` for next session

### Strengths

- **Transparent**: Plain text files (Markdown, JSON) are human-readable and editable
- **Portable**: Can be synced via git, Dropbox, or any file sync tool
- **No dependencies**: No database, no server, just filesystem
- **Dual-agent compatible**: Both Claude and Gemini can read/write the same files

### Weaknesses

- **No search**: Sequential file reads, no indexing
- **No encryption**: Sensitive data stored in plain text
- **Workspace coupling**: UUID-based folders require directory matching logic
- **Accumulation**: Files grow unbounded (learnings.md has duplicate entries)
- **File distribution**: Currently requires copying .claude/ to each project via /update-framework

---

## 2. How Other Tools Handle Persistent Memory

### Claude-Mem

**Architecture:**
```
Hooks (fast) → Queue → Worker (slow) → SQLite + ChromaDB
                         ↓
                   Claude API (compression)
```

**Key design decisions:**
- Fast hooks (< 1 second) just queue observations and exit
- Worker processes async (5-30 seconds per observation)
- AI compression: 1k-10k tokens reduced to ~500 tokens
- Dual session IDs: content_session_id (stable) vs memory_session_id (internal)
- Storage: `~/.claude-mem/` with SQLite + vector DB

**Relevant patterns:**
- Separation of hot path (hooks) from cold path (processing)
- AI-assisted compression reduces storage and retrieval costs
- Categorization by type (decision, bugfix, feature, refactor, discovery, change)

### Continue.dev

**Architecture:**
- Model-agnostic: works with local models (Ollama) or cloud (OpenAI, Anthropic)
- Model state NOT persisted across restarts (security by design)
- Context via embedding + re-ranking models
- Configuration in `.continue/` directory

**Key design decisions:**
- Local-first: code never leaves machine
- Air-gapped operation possible
- Ephemeral memory (sessions don't persist by default)

### Cursor

**Architecture:**
- VS Code fork with native AI integration
- 500MB codebase indexing
- `.cursor/rules/*.mdc` for project-specific rules
- Supports custom API endpoints (can use local Ollama)

**Key design decisions:**
- Agent mode for multi-file edits
- Inline context from current file + surrounding code

### Cody (Sourcegraph)

**Architecture:**
- 1M token context window
- Multi-repo search via Sourcegraph backend
- MCP support for tool integration

**Key design decisions:**
- Enterprise focus: works across entire organization's code
- Graph-based code understanding

### ContextForge

**Architecture:**
- MCP-based persistent memory layer
- Works with Claude Desktop, Claude Code, Cursor
- Project-specific memory stored locally

**Key design decisions:**
- Uses Model Context Protocol for standardization
- Memory persists between sessions
- Project-scoped (not global)

### Mem0 / Zep / Supermemory

**Commercial memory services:**

| Product | Approach | Storage | Price |
|---------|----------|---------|-------|
| Mem0 | Vector + graph | Cloud | Free-$249/mo |
| Zep | Temporal knowledge graphs | Cloud | Enterprise |
| Supermemory | MCP plugin, LongMemEval benchmark leader | Local + Cloud | Free-$399/mo |

---

## 3. Extension-Compatible Data Architecture

### VS Code Storage Options

**1. workspaceState**
- Scope: Per-workspace
- Type: Key-value (JSON-serializable)
- Location: `~/Library/Application Support/Code/User/workspaceStorage/`
- Sync: Not synced across machines
- Best for: Project-specific settings, recent files, UI state

**2. globalState**
- Scope: All workspaces
- Type: Key-value (JSON-serializable)
- Location: `~/Library/Application Support/Code/User/globalStorage/state.vscdb` (SQLite)
- Sync: Can sync specific keys via `setKeysForSync()`
- Best for: User preferences, cross-project settings

**3. globalStorageUri**
- Scope: All workspaces
- Type: File system (read/write)
- Location: Extension-specific directory
- Sync: Not synced
- Best for: Large files, databases, models

**4. storageUri**
- Scope: Per-workspace
- Type: File system (read/write)
- Location: Workspace-specific directory
- Sync: Not synced
- Best for: Project-specific large files

**5. SecretStorage**
- Scope: Global (per machine)
- Type: Encrypted key-value
- Location: Platform keychain (macOS Keychain, Windows Credential Manager, Linux Keyring)
- Sync: Never synced (by design)
- Best for: API keys, tokens, passwords

### Recommended Architecture for Extension

```
VS Code Extension Data Architecture
====================================

globalState (synced keys)
├── user.identity              # Name, background, values
├── user.preferences           # How to work with them
├── assistant.learnings        # Persistent learnings (what works, what doesn't)
└── assistant.voice            # Writing style rules

globalStorageUri (local files)
├── brain.sqlite               # All structured data
│   ├── sessions table         # Session history
│   ├── tasks table            # Task history
│   ├── decisions table        # Design decisions
│   └── patterns table         # Technical patterns
├── embeddings/                # Vector embeddings (if using local search)
└── backups/                   # Periodic backups

workspaceState (per-project)
├── workspace.id               # UUID for this workspace
├── workspace.lastSession      # Quick resume data
└── workspace.recentFiles      # Recently touched files

storageUri (per-project files)
└── project-context.md         # Project-specific notes (exportable)

SecretStorage
├── api.anthropic              # Claude API key
├── api.openai                 # OpenAI key (if used)
└── sync.encryption_key        # Key for encrypted cloud sync
```

### Encryption Strategy

**For local storage:**
- SecretStorage for API keys and tokens (uses OS keychain)
- SQLite with SQLCipher for encrypted database
- Encryption key stored in SecretStorage

**For cloud sync:**
- End-to-end encryption with keys generated and stored locally
- Only ciphertext transmitted
- Optional: Use existing sync (iCloud, Dropbox) with encrypted files

### Backup and Portability

**Export format (JSON Lines):**
```jsonl
{"type":"identity","data":{"name":"Luis","background":"..."}}
{"type":"learning","timestamp":"2026-03-14","content":"..."}
{"type":"session","workspace":"uuid","summary":"..."}
{"type":"decision","workspace":"uuid","decision":"...","rationale":"..."}
```

**Import process:**
1. Parse JSONL
2. Merge with existing data (conflict resolution by timestamp)
3. Re-index for search

---

## 4. Migration Path

### Phase 1: Compatibility Layer (Low Risk)

**Goal:** Extension reads/writes to existing brain files.

```javascript
// Extension reads from existing brain
const brainPath = path.join(os.homedir(), '.gemini/antigravity/brain');
const learnings = fs.readFileSync(path.join(brainPath, 'learnings.md'), 'utf8');

// Write using same format
fs.writeFileSync(path.join(brainPath, 'learnings.md'), updatedLearnings);
```

**Benefits:**
- Hooks continue working
- Both CLI and extension use same data
- Zero data migration

**Drawbacks:**
- No search improvement
- No encryption
- Still file-based

### Phase 2: Dual Storage (Medium Risk)

**Goal:** Extension uses native storage, syncs with brain files.

```javascript
// Write to extension storage
await context.globalState.update('learnings', parsedLearnings);

// Also write to brain (backwards compat)
const brainPath = path.join(os.homedir(), '.gemini/antigravity/brain');
fs.writeFileSync(path.join(brainPath, 'learnings.md'), formatAsMarkdown(parsedLearnings));
```

**Benefits:**
- Extension gets proper storage (globalState, SQLite)
- CLI/hooks still work
- Gradual migration

**Drawbacks:**
- Two sources of truth
- Sync complexity
- Potential drift

### Phase 3: Extension Primary (Higher Risk)

**Goal:** Extension is source of truth, brain files become export/backup.

```javascript
// Extension is primary
const learnings = await context.globalState.get('learnings');

// Export to brain on demand (or on session end)
if (shouldExport) {
  exportToBrainFiles(learnings);
}
```

**Benefits:**
- Native VS Code storage
- SQLite for structured queries
- SecretStorage for secrets
- Proper search (FTS5, vector)

**Drawbacks:**
- Hooks need rewriting (use extension API instead of file reads)
- CLI-only usage needs alternative path

### Phase 4: Native Extension (Full Migration)

**Goal:** Remove brain file dependency entirely.

**Data migration:**
```javascript
// One-time migration
async function migrateBrainToExtension(context) {
  const brainPath = path.join(os.homedir(), '.gemini/antigravity/brain');

  // Migrate learnings
  const learnings = fs.readFileSync(path.join(brainPath, 'learnings.md'), 'utf8');
  await context.globalState.update('learnings', parseLearnings(learnings));

  // Migrate per-workspace data
  const workspaces = fs.readdirSync(brainPath).filter(isUUID);
  for (const uuid of workspaces) {
    const state = JSON.parse(fs.readFileSync(path.join(brainPath, uuid, 'session_state.json')));
    await migrateWorkspaceData(context, uuid, state);
  }
}
```

**Backwards compatibility:**
- Keep export functionality for brain files
- Allow CLI mode with direct file access (degraded experience)
- Version tracking for data format evolution

---

## 5. Data Format Evolution

### Current Format

**session_state.json:**
```json
{
  "type": "pre-compact-auto",
  "timestamp": "2026-03-14T01:43:47.205Z",
  "workspace": "/Users/luisladino/...",
  "trigger": "auto",
  "accomplished": ["...", "..."],
  "files_modified": ["...", "..."],
  "decisions": ["...", "..."],
  "open_issues": ["...", "..."],
  "patterns": ["...", "..."]
}
```

### Proposed Extension Format

**session record (SQLite):**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  trigger TEXT,
  summary TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE session_items (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'accomplished', 'decision', 'pattern', 'issue'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  action TEXT NOT NULL, -- 'modified', 'created', 'deleted'
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

### Version Migration

```javascript
const CURRENT_VERSION = 2;

async function checkAndMigrate(context) {
  const version = context.globalState.get('data_version') || 1;

  if (version < CURRENT_VERSION) {
    await runMigrations(version, CURRENT_VERSION);
    await context.globalState.update('data_version', CURRENT_VERSION);
  }
}

const migrations = {
  1: async () => {
    // v1 -> v2: Add workspace_id to sessions
  },
  2: async () => {
    // v2 -> v3: ...
  }
};
```

---

## 6. Recommendations

### Short-term (1-2 weeks)

1. **Keep current file-based system** for CLI usage
2. **Build extension with Phase 1** (read/write brain files)
3. **Add ag_knowledge_search indexing** (SQLite FTS5) without changing storage

### Medium-term (1-2 months)

1. **Implement Phase 2** (dual storage)
2. **Add SecretStorage** for API keys
3. **Build export/import** for portability
4. **Add encrypted sync** for multi-machine use

### Long-term (3+ months)

1. **Complete Phase 3** (extension primary)
2. **Deprecate direct brain file writes** from hooks
3. **Extension API** for hooks to communicate with extension
4. **Vector search** for semantic retrieval

### Key Design Principles

1. **Local-first**: Data stays on machine by default
2. **Privacy-respecting**: Encryption for sensitive data, no telemetry
3. **Portable**: Export/import for backup and machine migration
4. **Backwards compatible**: CLI mode continues working
5. **Transparent**: Users can see and edit their data

---

## Sources

- [VS Code Extension Storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)
- [VS Code Global State Explained](https://mattreduce.com/posts/vscode-global-state/)
- [VS Code Extension Storage Options](https://www.eliostruyf.com/devhack-code-extension-storage-options/)
- [VS Code SecretStorage](https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco)
- [Continue.dev GitHub](https://github.com/continuedev/continue)
- [ContextForge MCP Integration](https://contextforge.dev/blog/contextforge-now-supports-cursor-ide-persistent-ai-memory-everywhere)
- [MCP Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)
- [Claude-Mem Architecture](https://deepwiki.com/thedotmack/claude-mem)
- [Offline-First Frontend Apps](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)
- [SQLite vs IndexedDB](https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html)
- [Hybrid AI Architecture](https://blogs.perficient.com/2026/01/28/hybrid-ai-empowering-on-device-models-with-cloud-synced-skills/)
- [Privacy-First AI Assistant](https://www.alibaba.com/product-insights/how-to-build-a-private-ai-assistant-that-syncs-across-devices-using-only-end-to-end-encrypted-local-storage.html)
