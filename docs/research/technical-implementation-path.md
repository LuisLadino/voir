# Technical Implementation Path: Claude Dev Framework to VS Code Extension

## Executive Summary

This document analyzes the feasibility and approach for converting the claude-dev-framework into a VS Code extension. The key insight: **Claude Code already has an official VS Code extension and a plugin system**. Rather than building a competing extension, the optimal path is to **package the framework as a Claude Code plugin**.

---

## Part 1: Current System Analysis

### Components to Port

The framework consists of four main subsystems:

#### 1. Hooks (`.claude/hooks/`)

| Hook File | Event | Purpose |
|-----------|-------|---------|
| `block-dangerous.cjs` | PreToolUse | Block rm -rf, force push, credential exposure |
| `inject-context.cjs` | UserPromptSubmit | Auto-route commands, inject voice profile |
| `tool-tracker.cjs` | PostToolUse | Universal tool call tracking |
| `tool-failure.cjs` | PostToolUseFailure | Track failed tool calls |
| `track-changes.cjs` | PostToolUse (Edit/Write) | Log file modifications |
| `command-log.cjs` | PostToolUse (Bash) | Log bash commands |
| `detect-pivot.cjs` | PostToolUse (Bash) | Detect dependency changes |
| `awareness.cjs` | UserPromptSubmit | System health checks, prompt for /reflect |
| `session-init.cjs` | SessionStart | Initialize tracking, detect project changes |
| `session-end.cjs` | SessionEnd | Write session summary |
| `verify-before-stop.cjs` | Stop | Check for debug statements |
| `subagent-tracker.cjs` | SubagentStart/Stop | Track subagent lifecycle |

**Implementation pattern:** All hooks use stdin JSON input, process data, write to brain files, output via stdout/stderr.

#### 2. Commands (`.claude/commands/`)

| Category | Commands |
|----------|----------|
| Development | `/commit`, `/pr`, `/start-task`, `/add-feature`, `/process-tasks` |
| Project Management | `/init-project`, `/sync-stack`, `/generate-project-specs`, `/update-framework` |
| Specs | `/verify`, `/audit`, `/add-spec` |
| Utilities | `/checkpoint`, `/learn`, `/reflect`, `/analyze` |

**Implementation pattern:** Markdown files with YAML frontmatter (description) and body instructions for Claude.

#### 3. Specs (`.claude/specs/`)

- `stack-config.yaml` - Project tech stack definition
- `config/` - Version control, testing, deployment, environment
- `coding/` - Generated per framework (Next.js, React, etc.)
- `architecture/` - Project structure
- `design/` - Design system (for UI projects)

**Implementation pattern:** YAML config + Markdown spec files loaded by commands.

#### 4. Brain Integration

| File | Purpose |
|------|---------|
| `learnings.md` | Persistent learnings (global) |
| `voice-profile.md` | Voice rules for content writing |
| `{uuid}/task.md` | Per-workspace task history |
| `{uuid}/session_state.json` | Current state for resuming |
| `{uuid}/decisions.md` | Design decisions |
| `{uuid}/patterns.md` | Technical patterns |
| `{uuid}/sessions/` | Per-session tracking files |

**Implementation pattern:** Read at SessionStart, write via hooks/commands, persistent across sessions.

---

## Part 2: Integration Options

### Option A: Build Standalone VS Code Extension (NOT RECOMMENDED)

This would mean building a separate extension that duplicates Claude Code's functionality.

**Problems:**
- Claude Code already has an official VS Code extension with 2M+ installs
- Would need to replicate conversation handling, tool execution, file operations
- Maintenance burden: two systems to keep in sync
- User friction: choosing between two tools

**Verdict:** This path solves a problem that doesn't exist.

### Option B: Claude Code Plugin (RECOMMENDED)

Package the framework as a Claude Code plugin that works in both CLI and VS Code.

**Benefits:**
- Uses existing Claude Code infrastructure
- Works in terminal AND VS Code seamlessly
- Plugin system designed for exactly this use case
- Single codebase serves both interfaces
- Easy distribution via `/plugin marketplace`

**Plugin structure:**
```
claude-dev-framework-plugin/
├── .claude-plugin/
│   └── plugin.json       # Plugin metadata
├── commands/             # All slash commands
│   ├── development/
│   ├── project-management/
│   ├── specs/
│   └── utilities/
├── hooks/                # All hooks (identical to current)
│   ├── safety/
│   ├── tracking/
│   ├── quality/
│   └── context/
├── skills/               # (if needed)
├── .mcp.json             # MCP server config (if needed)
└── README.md
```

### Option C: Hybrid (Enhance Claude Code Extension)

Build a companion VS Code extension that enhances Claude Code with GUI features:
- Visual dashboard for brain files
- Session history viewer
- Spec file editor with validation
- Framework update notifications

**Benefits:**
- Adds value without replacing Claude Code
- GUI for things that work better visually
- Could use VS Code webview for rich UI

**Implementation:** Standard VS Code extension that reads/writes to brain files but doesn't handle Claude conversations.

---

## Part 3: VS Code Extension Technical Details (if needed)

If Option C (hybrid) is pursued, here's how VS Code extension concepts map to framework needs:

### Activation Events

```json
{
  "activationEvents": [
    "workspaceContains:.claude/",
    "onCommand:claudeDevFramework.*",
    "onView:claudeDevFramework.dashboard"
  ]
}
```

### Commands

VS Code commands map to framework commands:

```typescript
// package.json contribution
{
  "commands": [
    {
      "command": "claudeDevFramework.showDashboard",
      "title": "Claude Dev: Show Dashboard"
    },
    {
      "command": "claudeDevFramework.viewSessions",
      "title": "Claude Dev: View Session History"
    },
    {
      "command": "claudeDevFramework.editSpecs",
      "title": "Claude Dev: Edit Specs"
    }
  ]
}

// extension.ts
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeDevFramework.showDashboard', () => {
      DashboardPanel.createOrShow(context.extensionUri);
    })
  );
}
```

### File System Events

Monitor brain files and spec changes:

```typescript
// Watch for brain file changes
const brainWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(brainPath, '**/*.{json,md}')
);

brainWatcher.onDidChange(uri => {
  // Refresh dashboard
});

// Watch for spec changes
const specWatcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(workspaceRoot, '.claude/specs/**/*')
);
```

### Webview for Dashboard

```typescript
class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._update();

    // Listen for messages from webview
    this._panel.webview.onDidReceiveMessage(message => {
      switch (message.command) {
        case 'openFile':
          vscode.workspace.openTextDocument(message.path);
          break;
      }
    });
  }

  private _update() {
    const brain = this._loadBrainData();
    this._panel.webview.html = this._getHtml(brain);
  }
}
```

### TreeView for Session History

```typescript
class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionItem[] {
    return this._loadSessions().map(session =>
      new SessionItem(session.id, session.summary, session.timestamp)
    );
  }
}

// Register in activate()
vscode.window.registerTreeDataProvider('claudeDevFramework.sessions', provider);
```

---

## Part 4: Recommended Implementation Path

### Phase 1: Convert to Claude Code Plugin (MVP)

**Goal:** Package existing framework as a Claude Code plugin.

**Steps:**
1. Create plugin structure with `.claude-plugin/plugin.json`
2. Move commands to plugin `commands/` directory
3. Move hooks to plugin `hooks/` directory
4. Test in both CLI and VS Code
5. Publish to plugin marketplace

**Effort:** 1-2 days

**plugin.json example:**
```json
{
  "name": "claude-dev-framework",
  "version": "1.0.0",
  "description": "Development framework with context persistence, specs, and brain integration",
  "author": "Luis Ladino",
  "commands": ["commands/"],
  "hooks": ["hooks/"],
  "requires": {
    "claude-code": ">=2.0.0"
  }
}
```

### Phase 2: Brain Dashboard Extension (Optional Enhancement)

**Goal:** Add visual tools that Claude Code doesn't provide.

**Features:**
- View/search session history
- Edit learnings.md with preview
- Spec file validation
- Brain file explorer

**Effort:** 1-2 weeks

**Project structure:**
```
claude-dev-framework-vscode/
├── src/
│   ├── extension.ts
│   ├── dashboard/
│   │   ├── DashboardPanel.ts
│   │   └── webview/
│   ├── providers/
│   │   ├── SessionTreeProvider.ts
│   │   └── BrainFileProvider.ts
│   └── utils/
│       └── brainFiles.ts
├── package.json
├── tsconfig.json
└── esbuild.config.js
```

### Phase 3: Advanced Features (Future)

- Real-time session visualization
- AI-powered spec suggestions
- Cross-project brain search
- Team sync features

---

## Part 5: Technical Requirements

### For Plugin (Phase 1)

- Node.js (already required by hooks)
- Claude Code 2.0+ with plugin support
- Existing hooks work as-is

### For VS Code Extension (Phase 2)

- TypeScript 5.x
- VS Code API 1.105+
- esbuild for bundling
- webview-ui-toolkit for dashboard

### Testing

**Plugin testing:**
```bash
# Install locally
claude plugin add .

# Test commands
/commit
/start-task

# Verify hooks fire
cat ~/.gemini/antigravity/brain/tracking/sessions/*.json
```

**Extension testing:**
- Press F5 in VS Code to launch Extension Development Host
- Run commands from Command Palette
- Set breakpoints in TypeScript

---

## Part 6: Decision Matrix

| Criteria | Plugin Only | Plugin + Extension | Standalone Extension |
|----------|-------------|--------------------|--------------------|
| Development effort | Low | Medium | High |
| Maintenance burden | Low | Medium | High |
| Works in terminal | Yes | Yes | No |
| Works in VS Code | Yes | Yes | Yes |
| Visual dashboard | No | Yes | Yes |
| Distribution | Plugin marketplace | Both marketplaces | VS Code marketplace |
| Risk | Low | Low | High (duplicates work) |

**Recommendation:** Start with Plugin Only (Phase 1). Add Extension if visual tools prove valuable (Phase 2).

---

## Part 7: MVP Definition

### Minimum Viable Plugin

**Must have:**
- All existing commands work via `/command-name`
- All hooks fire at correct events
- Brain file read/write works
- Installation via `/plugin marketplace add`

**Nice to have:**
- Plugin configuration options
- Version update notifications
- Optional hooks (disable individually)

### Success Criteria

1. Framework installs in <1 minute
2. All existing workflows function identically
3. Works in both CLI and VS Code
4. No manual configuration required

---

## References

- [Claude Code Plugins README](https://github.com/anthropics/claude-code/blob/main/plugins/README.md)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [VS Code Extension API](https://code.visualstudio.com/api/references/vscode-api)
- [VS Code Extension Development 2026 Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [Claude Code for VS Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)
- [Awesome Claude Code Plugins](https://github.com/ccplugins/awesome-claude-code-plugins)

---

## Appendix: Current Hook Implementation Patterns

All hooks follow this pattern (compatible with plugin system):

```javascript
#!/usr/bin/env node

// Read JSON from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const data = JSON.parse(input);
  handleHook(data);
});

function handleHook(data) {
  const { tool_name, tool_input, session_id } = data;

  // Process...

  // Output (optional)
  if (additionalContext) {
    console.log(JSON.stringify({ additionalContext }));
  }

  // Exit codes: 0 = continue, 2 = deny (PreToolUse)
  process.exit(0);
}
```

This pattern is already plugin-compatible. No changes needed for Phase 1.
