# VS Code Extension Specs

Source: https://code.visualstudio.com/api

## Extension Lifecycle

### Activation

Extensions activate based on `activationEvents` in `package.json`. VOIR activates when:
- Workspace contains `.claude/` directory
- User invokes a `voir.*` command

```typescript
export function activate(context: vscode.ExtensionContext): void {
  // Register commands
  const cmd = vscode.commands.registerCommand('voir.showDashboard', () => {
    // Handler
  });

  // Add to subscriptions for proper cleanup
  context.subscriptions.push(cmd);
}
```

### Deactivation

Clean up resources in `deactivate()`:

```typescript
export function deactivate(): void {
  // Cleanup (panels, watchers, etc.)
}
```

## Commands

### Registration

Register commands in `activate()`, declare in `package.json`:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "voir.showDashboard",
        "title": "VOIR: Show Dashboard"
      }
    ]
  }
}
```

### Command Naming

Use `voir.` prefix for all commands:
- `voir.showDashboard`
- `voir.refresh`
- `voir.openSession`

## Tree Views

### TreeDataProvider

Implement `vscode.TreeDataProvider<T>` for sidebar views:

```typescript
export class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionItem): Thenable<SessionItem[]> {
    if (!element) {
      return this.getSessions();
    }
    return this.getSessionDetails(element);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
```

### TreeItem

Create tree items with proper icons and commands:

```typescript
class SessionItem extends vscode.TreeItem {
  constructor(
    public readonly session: Session,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(session.id, collapsibleState);

    this.tooltip = `Session: ${session.id}`;
    this.description = formatDuration(session);
    this.iconPath = new vscode.ThemeIcon('history');
    this.contextValue = 'session';
    this.command = {
      command: 'voir.openSession',
      title: 'Open Session',
      arguments: [session]
    };
  }
}
```

### Registration

Register tree providers in `activate()`:

```typescript
const sessionProvider = new SessionTreeProvider();
vscode.window.registerTreeDataProvider('voir.sessions', sessionProvider);
```

## Webviews

### Creating Panels

Use `createWebviewPanel()` for rich UI:

```typescript
const panel = vscode.window.createWebviewPanel(
  'voirDashboard',        // viewType
  'VOIR Dashboard',       // title
  vscode.ViewColumn.One,  // column
  {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(context.extensionUri, 'dist'),
      vscode.Uri.joinPath(context.extensionUri, 'resources')
    ]
  }
);
```

### HTML Content

Set HTML with proper security headers:

```typescript
panel.webview.html = getWebviewContent(panel.webview, extensionUri);

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css')
  );
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>VOIR Dashboard</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

### Message Passing

Extension to webview:

```typescript
panel.webview.postMessage({ command: 'updateData', data: sessions });
```

Webview to extension:

```typescript
// In webview script
const vscode = acquireVsCodeApi();
vscode.postMessage({ command: 'refresh' });

// In extension
panel.webview.onDidReceiveMessage(
  message => {
    switch (message.command) {
      case 'refresh':
        this.refreshData();
        break;
    }
  },
  undefined,
  context.subscriptions
);
```

### State Persistence

Use `getState()` and `setState()` in webview:

```javascript
// Save state
vscode.setState({ currentSession: sessionId });

// Restore state
const state = vscode.getState();
if (state?.currentSession) {
  loadSession(state.currentSession);
}
```

## File System

### Reading Files

Use VS Code's file system API:

```typescript
const uri = vscode.Uri.file(path);
const content = await vscode.workspace.fs.readFile(uri);
const text = Buffer.from(content).toString('utf8');
```

### Watching Files

Create file system watchers for live updates:

```typescript
const watcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(workspaceFolder, '.claude/**/*.json')
);

watcher.onDidChange(uri => this.refresh());
watcher.onDidCreate(uri => this.refresh());
watcher.onDidDelete(uri => this.refresh());

context.subscriptions.push(watcher);
```

## Status Bar

Add status bar items for quick info:

```typescript
const statusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,
  100
);
statusBarItem.text = '$(eye) VOIR';
statusBarItem.tooltip = 'Click to open VOIR Dashboard';
statusBarItem.command = 'voir.showDashboard';
statusBarItem.show();

context.subscriptions.push(statusBarItem);
```

## Anti-Patterns

### Don't Block the Extension Host

Use async operations for file I/O:

```typescript
// Bad - blocks extension host
const content = fs.readFileSync(path);

// Good - async
const content = await vscode.workspace.fs.readFile(uri);
```

### Always Dispose Resources

Add everything to `context.subscriptions`:

```typescript
// Good - will be disposed on deactivation
context.subscriptions.push(watcher, statusBar, treeProvider);

// Bad - memory leak
vscode.workspace.createFileSystemWatcher(...); // not tracked
```

### Don't Hardcode Paths

Use `vscode.Uri.joinPath()` for cross-platform paths:

```typescript
// Bad
const path = extensionPath + '/resources/icon.svg';

// Good
const path = vscode.Uri.joinPath(extensionUri, 'resources', 'icon.svg');
```
