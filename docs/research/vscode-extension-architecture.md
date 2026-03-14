# VS Code Extension Architecture Research

*Research date: 2026-03-14*
*Purpose: Evaluate VS Code extension development for AI assistant tooling*

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Extension Architecture](#extension-architecture)
3. [Terminal Integration](#terminal-integration)
4. [File System Access](#file-system-access)
5. [Persistent Data Storage](#persistent-data-storage)
6. [External API Communication](#external-api-communication)
7. [Custom Views and Panels](#custom-views-and-panels)
8. [Private Distribution](#private-distribution)
9. [Limitations and Blockers](#limitations-and-blockers)
10. [Recommendations for Our Use Case](#recommendations-for-our-use-case)

---

## Executive Summary

VS Code extensions are powerful but have specific constraints relevant to our hooks-based AI assistant system:

**Can Do:**
- Full file system access via Node.js APIs
- Create/control terminals and send commands
- Store secrets securely (OS keychain)
- Make HTTP requests to external APIs
- Create custom sidebar views and panels
- Watch file changes in workspace
- Detect terminal command execution (with shell integration)

**Cannot Do:**
- Intercept/block terminal commands *before* execution (critical limitation)
- Modify VS Code's DOM/UI directly
- Run in a sandboxed environment (no permission model)
- Auto-update private extensions without custom infrastructure

**Key Finding:** The inability to intercept terminal commands before execution is a significant gap. Our `block-dangerous.js` hook behavior cannot be replicated directly. Alternative: pseudo-terminal that wraps commands.

---

## Extension Architecture

### Multi-Process Model

VS Code uses Chromium's multi-process architecture:

| Process | Responsibility |
|---------|---------------|
| Main Process | Application management, window handling |
| Renderer Process | UI rendering |
| Extension Host | Runs extensions in isolated Node.js process |
| Language Servers | Language-specific features (LSP) |
| Debug Adapters | Debugging functionality |

Extensions run in the **Extension Host process**, which:
- Prevents direct DOM access (stability protection)
- Provides full Node.js runtime (not sandboxed)
- Runs asynchronously from the UI

### Extension Entry Points

```typescript
// package.json activation events
{
  "activationEvents": [
    "onStartupFinished",           // After VS Code startup
    "workspaceContains:**/.claude/", // When workspace has .claude directory
    "onCommand:myExtension.start"   // On specific command
  ]
}
```

### Lifecycle Hooks Available

| Event | Use Case |
|-------|----------|
| `activate()` | Extension loaded - similar to SessionStart |
| `deactivate()` | Extension unloading - similar to SessionEnd |
| `onDidChangeWorkspaceFolders` | Workspace opened/closed |
| `onDidOpenTextDocument` | File opened |
| `onDidSaveTextDocument` | File saved |
| `onDidStartTerminalShellExecution` | Terminal command started |
| `onDidEndTerminalShellExecution` | Terminal command finished |

**Gap:** No `PreToolUse` equivalent - cannot intercept before actions happen.

---

## Terminal Integration

### Available APIs

```typescript
// Create a terminal
const terminal = vscode.window.createTerminal({
  name: 'AI Assistant',
  cwd: workspaceFolder,
  env: { CLAUDE_SESSION: sessionId }
});

// Send commands
terminal.sendText('npm install', true);  // true = press Enter

// Show terminal
terminal.show();

// Listen for terminal events
vscode.window.onDidOpenTerminal(terminal => { ... });
vscode.window.onDidCloseTerminal(terminal => { ... });
```

### Shell Integration (Detection, Not Interception)

Shell integration uses OSC escape sequences to track command execution:

| Sequence | Meaning |
|----------|---------|
| `OSC 633 ; A ST` | Prompt started |
| `OSC 633 ; B ST` | Prompt ended |
| `OSC 633 ; C ST` | Pre-execution (command about to run) |
| `OSC 633 ; D [; exitcode] ST` | Execution finished |
| `OSC 633 ; E ; commandline ST` | Command line text |

**Critical Limitation:** The "C" (pre-execution) marker fires *after* the user presses Enter but *before* output. There is no API to **cancel** the command at this point.

### Pseudo-Terminal Approach (Workaround)

For command interception, create a pseudo-terminal that wraps the shell:

```typescript
const writeEmitter = new vscode.EventEmitter<string>();
const pty: vscode.Pseudoterminal = {
  onDidWrite: writeEmitter.event,
  open: () => { /* spawn shell */ },
  close: () => { /* cleanup */ },
  handleInput: (data: string) => {
    // Here we can intercept before sending to shell
    if (isDangerous(data)) {
      writeEmitter.fire('\r\nBlocked: dangerous command\r\n');
      return;
    }
    // Forward to actual shell
    shellProcess.stdin.write(data);
  }
};

const terminal = vscode.window.createTerminal({
  name: 'Safe Terminal',
  pty
});
```

**Trade-off:** Loses native shell integration features, requires reimplementing shell behavior.

### Remote Environment Consideration

`createTerminal()` from a local extension host creates a local terminal. For SSH/DevContainer scenarios:

```typescript
// Use VS Code's remote-aware command instead
await vscode.commands.executeCommand('workbench.action.terminal.new');
```

---

## File System Access

### Full Node.js Access

Extensions have unrestricted file system access via Node.js:

```typescript
import * as fs from 'fs';
import * as path from 'path';

// Read file
const content = fs.readFileSync(filePath, 'utf8');

// Write file
fs.writeFileSync(filePath, content);

// Watch for changes
fs.watch(directory, (event, filename) => { ... });
```

### VS Code File System API

For workspace-aware operations:

```typescript
// Read file via VS Code API
const doc = await vscode.workspace.openTextDocument(uri);
const content = doc.getText();

// Write file
const edit = new vscode.WorkspaceEdit();
edit.createFile(uri, { contents: Buffer.from(content) });
await vscode.workspace.applyEdit(edit);
```

### FileSystemWatcher

```typescript
const watcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(workspaceFolder, '**/*.{ts,js,json}')
);

watcher.onDidCreate(uri => {
  // File created
});

watcher.onDidChange(uri => {
  // File modified
  // Note: Content may be outdated at event time (known issue)
});

watcher.onDidDelete(uri => {
  // File deleted
});

// Remember to dispose
context.subscriptions.push(watcher);
```

**Known Issues:**
- Event fires before text document is fully updated in some cases
- Network mounts (NFS/SMB) may generate incorrect events
- Folder-level events may not fire consistently

---

## Persistent Data Storage

### Storage Options Comparison

| Storage | Use Case | Location | Synced? |
|---------|----------|----------|---------|
| `globalState` | Cross-workspace settings | SQLite DB | Yes (Settings Sync) |
| `workspaceState` | Per-workspace settings | SQLite DB | No |
| `SecretStorage` | API keys, tokens | OS Keychain | No |
| File-based | Complex data | Workspace/global folder | Optional |

### GlobalState (Memento API)

```typescript
// In activate()
const globalState = context.globalState;

// Store
await globalState.update('lastSessionId', sessionId);
await globalState.update('learnings', learningsArray);

// Retrieve
const lastSession = globalState.get<string>('lastSessionId');
```

### SecretStorage

```typescript
// Store secret
await context.secrets.store('anthropic-api-key', apiKey);

// Retrieve secret
const apiKey = await context.secrets.get('anthropic-api-key');

// Delete secret
await context.secrets.delete('anthropic-api-key');
```

**Platform backends:**
- macOS: Keychain
- Linux: Secret Service API (libsecret)
- Windows: Credential Vault

**Limitation:** Extension fails if OS has no keychain available.

### Custom File Storage

For brain-like persistent storage:

```typescript
// Global storage location (persists across workspaces)
const globalStoragePath = context.globalStorageUri.fsPath;
// e.g., ~/.vscode/extensions/my-extension/globalStorage/

// Workspace storage location
const workspaceStoragePath = context.storageUri?.fsPath;
// e.g., .vscode/my-extension/

// Write to brain
const brainPath = path.join(globalStoragePath, 'brain');
fs.mkdirSync(brainPath, { recursive: true });
fs.writeFileSync(
  path.join(brainPath, 'learnings.md'),
  learningsContent
);
```

---

## External API Communication

### HTTP Requests

Extensions can make unrestricted HTTP requests using Node.js:

```typescript
import fetch from 'node-fetch';

async function callAPI() {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ ... })
  });
  return response.json();
}
```

Or using axios:

```typescript
import axios from 'axios';

const response = await axios.post(endpoint, data, { headers });
```

### WebSocket Connections

For real-time communication:

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('wss://api.example.com/stream');
ws.on('message', (data) => { ... });
ws.on('error', (error) => { ... });
```

**No restrictions:** Extensions can connect to any endpoint, no CORS or sandboxing.

---

## Custom Views and Panels

### View Containers (Sidebar)

```json
// package.json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "ai-assistant",
        "title": "AI Assistant",
        "icon": "media/icon.svg"
      }]
    },
    "views": {
      "ai-assistant": [{
        "id": "ai-session",
        "name": "Session",
        "type": "tree"
      }, {
        "id": "ai-context",
        "name": "Context",
        "type": "webview"
      }]
    }
  }
}
```

### Tree View

```typescript
class SessionProvider implements vscode.TreeDataProvider<SessionItem> {
  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionItem): SessionItem[] {
    if (!element) {
      return this.getRootItems();
    }
    return element.children;
  }
}

vscode.window.registerTreeDataProvider('ai-session', new SessionProvider());
```

### WebView Panel

```typescript
const panel = vscode.window.createWebviewPanel(
  'aiAssistant',
  'AI Assistant',
  vscode.ViewColumn.Beside,
  {
    enableScripts: true,
    retainContextWhenHidden: true
  }
);

panel.webview.html = `
  <!DOCTYPE html>
  <html>
    <body>
      <div id="chat"></div>
      <script>
        const vscode = acquireVsCodeApi();
        // Send message to extension
        vscode.postMessage({ type: 'query', text: '...' });
      </script>
    </body>
  </html>
`;

// Receive messages from webview
panel.webview.onDidReceiveMessage(message => {
  if (message.type === 'query') {
    // Handle query
  }
});
```

### WebView Sidebar View

```typescript
class SidebarProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(message => {
      // Handle messages
    });
  }
}

vscode.window.registerWebviewViewProvider('ai-context', new SidebarProvider());
```

---

## Private Distribution

### VSIX Packaging

```bash
# Install vsce
npm install -g @vscode/vsce

# Package extension
vsce package
# Creates: my-extension-1.0.0.vsix
```

### Installation Methods

1. **Command Line:**
   ```bash
   code --install-extension my-extension-1.0.0.vsix
   ```

2. **VS Code UI:**
   - Extensions view > ... menu > "Install from VSIX..."

3. **Enterprise Pre-install:**
   Place VSIX in `<VS Code install>/bootstrap/extensions/`

### Distribution Options

| Method | Auto-Updates | Effort | Best For |
|--------|--------------|--------|----------|
| Manual VSIX sharing | No | Low | Personal use, small teams |
| Private web server + custom updater | Yes (custom) | High | Enterprise without GitHub Enterprise |
| GitHub Enterprise Private Marketplace | Yes | Medium | GitHub Enterprise customers |
| OpenVSX (self-hosted) | Yes | High | Air-gapped environments |
| ProGet | Yes | Medium | .NET-heavy enterprises |

### Custom Auto-Update Implementation

```typescript
async function checkForUpdates() {
  const currentVersion = vscode.extensions.getExtension('my-extension')?.packageJSON.version;

  const response = await fetch('https://internal.server/extension/version');
  const { latestVersion, downloadUrl } = await response.json();

  if (semver.gt(latestVersion, currentVersion)) {
    const choice = await vscode.window.showInformationMessage(
      `Update available: ${latestVersion}`,
      'Download', 'Later'
    );

    if (choice === 'Download') {
      vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
    }
  }
}

// Check on activation and periodically
setInterval(checkForUpdates, 24 * 60 * 60 * 1000);
```

---

## Limitations and Blockers

### Critical Limitations for Our Use Case

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **No command interception** | Cannot block dangerous commands before execution | Pseudo-terminal wrapper |
| **No DOM access** | Cannot inject UI into editor | WebView panels only |
| **No extension sandboxing** | All extensions have full access | N/A (OS-level trust) |
| **Shell integration optional** | Command detection may fail | Prompt user to enable |

### Security Model Concerns

From the 2026 security research:
- Extensions run with same privileges as VS Code
- No permission prompts (unlike mobile apps)
- Extensions can read any file, open ports, make network requests
- 128M installs affected by vulnerabilities in 4 extensions (2026 report)

### Web Extension Restrictions

If targeting vscode.dev (web-based VS Code):
- No Node.js APIs
- No file system access beyond opened workspace
- Must use `workspace.fs` API only
- No native module loading

### Known API Issues

1. **FileSystemWatcher timing:** Event may fire before file content is updated
2. **Remote terminals:** `createTerminal()` creates local terminal even in remote sessions
3. **Shell integration reliability:** Works differently across shells and configurations

---

## Recommendations for Our Use Case

### Feature Mapping: Hooks to Extension

| Current Hook | Extension Equivalent | Feasibility |
|--------------|---------------------|-------------|
| `SessionStart` | `activate()` | Direct mapping |
| `SessionEnd` | `deactivate()` | Direct mapping |
| `PreToolUse` (Bash) | None | **Requires pseudo-terminal** |
| `PostToolUse` (Edit/Write) | `onDidSaveTextDocument` | Partial (save events only) |
| `UserPromptSubmit` | Custom input box / WebView | Requires UI redesign |
| `PreCompact` | N/A | N/A (VS Code doesn't compact) |

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Tree View   │  │ WebView     │  │ Pseudo-Terminal     │  │
│  │ (Session)   │  │ (Chat UI)   │  │ (Command Safety)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    Extension Host (Node.js)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Brain       │  │ API Client  │  │ FileSystem Watcher  │  │
│  │ Storage     │  │ (Anthropic) │  │ (Track Changes)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Phase 1: Minimal Viable Extension

1. **Context injection:** Load brain files at activation
2. **Session tracking:** Track file changes, terminal commands
3. **Sidebar view:** Show current session state
4. **Secret storage:** Store API keys securely

### Phase 2: Command Safety

1. **Pseudo-terminal:** Wrap shell for command interception
2. **Pattern matching:** Block dangerous commands
3. **User confirmation:** Prompt for risky operations

### Phase 3: Full AI Integration

1. **Chat WebView:** Interactive AI assistant panel
2. **Code actions:** AI-powered suggestions
3. **Custom commands:** Slash commands via Command Palette

---

## Sources

- [VS Code Extension Capabilities Overview](https://code.visualstudio.com/api/extension-capabilities/overview)
- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [VS Code Extension Marketplace Documentation](https://code.visualstudio.com/docs/editor/extension-marketplace)
- [VS Code Enterprise Extension Management](https://code.visualstudio.com/docs/enterprise/extensions)
- [VS Code Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api)
- [Tree View API Guide](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview)
- [Building VS Code Extensions 2026 Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [VS Code Extension Security Vulnerabilities 2026](https://www.buildmvpfast.com/blog/vs-code-extension-security-vulnerabilities-2026)
- [VS Code Extension Sandboxing Discussion](https://github.com/microsoft/vscode/issues/59756)
- [Private VS Code Extensions for Dev Containers](https://www.kenmuse.com/blog/implementing-private-vs-code-extensions-for-dev-containers/)
- [Running a Private VS Code Extension Marketplace](https://coder.com/blog/running-a-private-vs-code-extension-marketplace)
- [SecretStorage in VS Code Extensions](https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco)
- [VS Code Extension Storage Options](https://www.eliostruyf.com/devhack-code-extension-storage-options/)
- [How to Make API Calls in VS Code Extensions](https://medium.com/@angelinatsuboi/how-to-make-api-calls-in-your-vs-code-extension-60dbaf7cf448)
- [Roo Code Shell Integration Documentation](https://docs.roocode.com/features/shell-integration)
