# VS Code WebView Technical Capabilities

## Overview

WebViews are VS Code's mechanism for displaying custom HTML content within the editor. They function as isolated iframes that your extension controls, enabling rich visualizations beyond native APIs while requiring careful attention to security, performance, and accessibility.

**Key insight:** WebViews are powerful but expensive. The official guidance is "just because you can, doesn't mean you should." Native VS Code APIs should always be preferred when they can meet the need.

---

## 1. Web Technologies Support

### Supported Frameworks

All major frameworks work in WebViews since they compile to standard HTML/CSS/JS:

| Framework | Status | Notes |
|-----------|--------|-------|
| **React** | Fully supported | Microsoft maintains official samples with Create React App and Vite |
| **Vue** | Fully supported | Official samples available |
| **Svelte** | Fully supported | Compiles to vanilla JS, excellent performance |
| **SolidJS** | Fully supported | Official samples available |
| **Vanilla JS** | Fully supported | Simplest approach, no build step needed |

### Web APIs Available

- Standard DOM manipulation
- CSS3 including variables, flexbox, grid
- Canvas and WebGL
- Web Workers (with limitations - see Gotchas)
- Audio playback (WAV, MP3, Ogg, FLAC)
- Video playback (H.264, VP8)
- localStorage and sessionStorage (within webview context)

### What's NOT Available

- Direct file system access (must use `asWebviewUri`)
- `importScripts` in Workers
- Dynamic `import()` in Workers
- Native Node.js APIs
- Direct VS Code API access (message passing only)

---

## 2. Communication Model

### Architecture

```
┌─────────────────────┐     postMessage()     ┌─────────────────────┐
│    Extension        │ ───────────────────► │     WebView         │
│    (Node.js)        │                       │     (Browser)       │
│                     │ ◄─────────────────── │                     │
└─────────────────────┘     postMessage()     └─────────────────────┘
```

### Extension to WebView

```typescript
// Extension side
panel.webview.postMessage({ type: 'update', data: someData });

// WebView side
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'update') {
    updateUI(message.data);
  }
});
```

### WebView to Extension

```typescript
// WebView side (call ONCE, store reference)
const vscode = acquireVsCodeApi();
vscode.postMessage({ type: 'request', payload: { id: 123 } });

// Extension side
panel.webview.onDidReceiveMessage(message => {
  if (message.type === 'request') {
    handleRequest(message.payload);
  }
});
```

### Critical Rules

1. **`acquireVsCodeApi()` can only be called ONCE per session** - store the returned object
2. **Keep the API object private** - never leak to global scope (security risk)
3. **Messages must be JSON-serializable** - no functions, circular references, etc.
4. **No delivery guarantee** - messages to hidden/destroyed webviews are dropped

### Performance Pattern: vscode-messenger

For complex communication, the [vscode-messenger](https://www.typefox.io/blog/vs-code-messenger/) library provides:
- Request/response patterns with promises
- Message payload size monitoring
- Timing metrics for bottleneck detection

---

## 3. State Persistence

### Three Approaches (in order of preference)

#### 1. getState/setState (Recommended)

Lightweight, persists across tab switches:

```typescript
// Save state
const vscode = acquireVsCodeApi();
vscode.setState({ selectedTab: 'memory', scrollPosition: 150 });

// Restore state
const previousState = vscode.getState();
if (previousState) {
  restoreUI(previousState);
}
```

**Performance:** Microsoft documentation states this has "much lower performance overhead" than retainContextWhenHidden. Safe to call frequently (even every 100ms).

#### 2. WebviewPanelSerializer (Cross-session persistence)

Survives VS Code restarts:

```typescript
// In extension activation
vscode.window.registerWebviewPanelSerializer('myExtension.panel', {
  async deserializeWebviewPanel(panel, state) {
    // Restore panel from saved state
    panel.webview.html = getHtmlForWebview(panel.webview);
    panel.webview.postMessage({ type: 'restore', state });
  }
});
```

Requires activation event in package.json:
```json
"activationEvents": ["onWebviewPanel:myExtension.panel"]
```

#### 3. retainContextWhenHidden (Last resort)

Keeps JS running when tab is hidden:

```typescript
const panel = vscode.window.createWebviewPanel(
  'myExtension.panel',
  'My Panel',
  vscode.ViewColumn.One,
  { retainContextWhenHidden: true }
);
```

**Warning:** High memory overhead. Use only when timers/animations must continue running.

---

## 4. UI Toolkit Options

### Microsoft Webview UI Toolkit (DEPRECATED)

**Status:** Deprecated January 1, 2025. The underlying FAST Foundation library was deprecated.

**What it provided:**
- VS Code-native looking components
- Automatic theme support
- ARIA compliance and keyboard navigation
- Framework-agnostic web components

### vscode-elements (Community Alternative)

**Current version:** 2.5.1

**Component categories:**
- **Form:** Button, Text Input, Select, Dropdown, Checkbox, Radio
- **Layout:** Split Layout, Scrollable, Collapsible
- **Navigation:** Tree, Tabs, Context Menu
- **Display:** Table, Badge, Progress

**Key features:**
- Built on Lit library
- Matches VS Code design language
- CSS variables for theming
- Can be used with any framework

**Installation:**
```bash
npm install @vscode-elements/elements
```

### Custom Components

For specialized visualizations (charts, graphs, timelines), you'll need custom components since neither toolkit provides these. See Visualization section below.

### Design Tokens

Both toolkits use VS Code's CSS variables for theming:

```css
.my-component {
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  font-family: var(--vscode-editor-font-family);
}
```

---

## 5. Layout Options

### WebView Locations

| Location | API | Use Case |
|----------|-----|----------|
| **Editor Panel** | `createWebviewPanel()` | Full-featured UI, custom visualizations |
| **Sidebar View** | `registerWebviewViewProvider()` | Persistent tools, quick access |
| **Panel View** | `registerWebviewViewProvider()` | Output, logs, auxiliary info |
| **Custom Editor** | `registerCustomEditorProvider()` | File editing with custom UI |

### View Columns

Only 3 editor columns available:
- `ViewColumn.One` (left)
- `ViewColumn.Two` (center)
- `ViewColumn.Three` (right)

No API to programmatically set width. Users resize manually.

### Sidebar Constraints

- **Minimum width:** 220px (VS Code enforced)
- **No programmatic width control**
- Width not preserved across sessions
- Same width for all views in sidebar
- **Critical UX requirement:** WebViews must reflow properly when dragged between containers

### Responsive Design Requirements

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

Design for:
- Narrow sidebar (220px minimum)
- Medium panel (400-600px typical)
- Full editor width (varies widely)

---

## 6. Rich Visualizations

### Charts and Graphs

**D3.js:** Full control, any visualization type
- Works in WebViews with proper CSP
- SVG or Canvas rendering
- Best for custom, interactive visualizations

**Chart.js:** Pre-built chart types
- Canvas rendering (better performance with large data)
- Simpler API than D3
- Good for standard chart types

**Performance benchmarks:**
- Both handle thousands of data points comfortably
- D3 with WebGL/Canvas can handle 3k+ nodes at 30+ fps
- SVG performance degrades with many elements

### Timeline Visualizations

Custom implementation required. Key patterns:
- Horizontal scrolling container
- Fixed-position current time indicator
- Virtualized rendering for large timelines
- Click/drag interaction zones

### Tree/Graph Visualizations

Options:
1. **vscode-elements Tree component** - matches VS Code file explorer
2. **D3 force-directed graphs** - custom network visualizations
3. **ECharts** - pre-built tree and graph types

### Syntax Highlighting

Options:
1. **Prism.js** - lightweight, many themes
2. **highlight.js** - broad language support
3. **Monaco Editor** - full VS Code editor (heavy)
4. **Shiki** - VS Code's actual highlighter (accurate)

```javascript
// Using Prism in WebView
import Prism from 'prismjs';
const highlighted = Prism.highlight(code, Prism.languages.javascript, 'javascript');
```

---

## 7. Theming

### Automatic Theme Classes

VS Code injects body classes:

```css
body.vscode-light { /* light theme styles */ }
body.vscode-dark { /* dark theme styles */ }
body.vscode-high-contrast { /* high contrast styles */ }
```

### CSS Variables

All VS Code theme colors available as CSS variables:

```css
/* Pattern: --vscode-{category}-{property} */
var(--vscode-editor-foreground)
var(--vscode-editor-background)
var(--vscode-button-background)
var(--vscode-button-foreground)
var(--vscode-input-background)
var(--vscode-input-border)
var(--vscode-panel-border)
/* ... hundreds more */
```

### Theme Detection

```javascript
// Check current theme
const isDark = document.body.classList.contains('vscode-dark');

// Watch for changes
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.attributeName === 'class') {
      updateTheme();
    }
  }
});
observer.observe(document.body, { attributes: true });
```

### Specific Theme Targeting

```css
body[data-vscode-theme-id="One Dark Pro"] {
  /* Styles for specific theme */
}
```

---

## 8. Security (CSP)

### Required CSP Header

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           img-src ${webview.cspSource} https:;
           script-src ${webview.cspSource};
           style-src ${webview.cspSource};">
```

### What CSP Blocks

- Inline scripts (`<script>alert()</script>`)
- Inline styles (`style="..."`)
- External resources from disallowed origins
- `eval()` and similar dynamic code execution

### Workarounds

1. **Extract inline scripts to files**
2. **Use nonce for necessary inline scripts:**
   ```html
   <meta http-equiv="Content-Security-Policy"
     content="script-src 'nonce-${nonce}';">
   <script nonce="${nonce}">// code</script>
   ```
3. **Use vscode.cspSource for allowed origins**

### Local Resources

```typescript
// Convert local file URI to webview URI
const scriptUri = webview.asWebviewUri(
  vscode.Uri.joinPath(extensionUri, 'media', 'script.js')
);
```

### Known CSP Issues (VS Code 1.104+)

Bug reported where CSP not applied correctly with React. If experiencing issues, check GitHub issues for workarounds.

---

## 9. Accessibility

### VS Code Requirements

- **Color contrast:** WCAG AA minimum
- **ARIA labels:** All interactive elements
- **Keyboard navigation:** Full functionality without mouse
- **Screen reader support:** Meaningful announcements

### Built-in Support

```css
/* VS Code adds these classes when appropriate */
body.vscode-using-screen-reader { }
body.vscode-reduce-motion { }
```

### Navigation Pattern

- **Tab/Shift+Tab:** Navigate within webview
- **F6/Shift+F6:** Navigate between webview and VS Code UI
- Focus indicators required on all interactive elements

### Implementation Checklist

- [ ] All buttons have accessible names
- [ ] Images have alt text
- [ ] Form inputs have labels
- [ ] Color is not the only indicator
- [ ] Focus visible on all interactive elements
- [ ] Tab order follows visual order
- [ ] ARIA live regions for dynamic content

---

## 10. Performance

### Visibility Optimization

```typescript
panel.onDidChangeViewState(e => {
  if (e.webviewPanel.visible) {
    // Resume updates
    startPolling();
  } else {
    // Pause updates
    stopPolling();
  }
});
```

### Memory Management

1. **Prefer getState/setState over retainContextWhenHidden**
2. **Dispose webviews when not needed**
3. **Lazy load heavy content**
4. **Virtualize long lists**

### Message Batching

```typescript
// Instead of many small messages
for (const item of items) {
  webview.postMessage({ type: 'item', data: item }); // BAD
}

// Batch into single message
webview.postMessage({ type: 'items', data: items }); // GOOD
```

### Web Worker for Heavy Computation

```typescript
// In webview
const worker = new Worker(workerUri);
worker.postMessage({ type: 'compute', data: largeDataset });
worker.onmessage = (e) => updateUI(e.data);
```

---

## 11. Best Extension Examples

### Notable Implementations

| Extension | Webview Usage | Notable Pattern |
|-----------|---------------|-----------------|
| **GitLens** | Commit graph, blame views | Complex interactive visualizations |
| **GitHub Copilot** | Chat sidebar | Real-time streaming UI |
| **CodeTour** | Tour playback | Step-by-step navigation |
| **Thunder Client** | REST client UI | Full application in webview |
| **Draw.io** | Diagram editor | Custom editor integration |

### Patterns to Study

1. **GitLens Commit Graph:** Complex interactive timeline with zoom, pan, filtering
2. **GitHub Copilot Chat:** Streaming text, markdown rendering, code blocks
3. **Thunder Client:** Form-heavy UI with tabs, request/response panels

---

## 12. UX-Enabling Capabilities Summary

### What Makes Great WebView UX Possible

| Capability | Enables |
|------------|---------|
| CSS variables | Seamless theme integration |
| Message passing | Real-time data sync |
| getState/setState | Seamless tab switching |
| D3/Chart.js support | Rich visualizations |
| Web components | Consistent, reusable UI |
| Sidebar views | Always-accessible tools |
| Custom editors | Deep file integration |

### Limitations That Constrain UX

| Limitation | UX Impact |
|------------|-----------|
| 220px min sidebar width | Must design for narrow views |
| No programmatic sizing | Can't auto-fit content |
| Message overhead | Latency in updates |
| CSP restrictions | Complex build requirements |
| No shared state | Each webview isolated |
| Resource cost | Can't have many webviews |

---

## 13. Recommendations for AI Memory Extension

### Sidebar View (Primary)
- Use for always-visible memory status
- Design for 220px minimum width
- Show summary with expand-to-panel option

### Panel View (Secondary)
- Use for detailed exploration
- Timeline, graphs, detailed views
- Can be wider, more interactive

### Editor Panel (Occasional)
- Use for full-context visualizations
- Memory map, relationship graphs
- Don't auto-open (user-initiated)

### Technology Stack Recommendation

| Layer | Recommendation | Reason |
|-------|----------------|--------|
| Framework | **Svelte** | Small bundle, fast, reactive |
| Components | **vscode-elements** | Native look, maintained |
| Visualization | **D3.js** | Flexibility for custom timelines |
| State | **getState/setState** | Lightweight, recommended |
| Theming | **CSS variables** | Automatic theme support |

### Critical UX Decisions

1. **Reflow gracefully** - sidebar to panel dragging must work
2. **Progressive disclosure** - summary first, detail on demand
3. **Respect theme** - never hardcode colors
4. **Keyboard accessible** - full functionality without mouse
5. **Performance aware** - pause updates when hidden

---

## Sources

- [VS Code WebView API](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code WebView UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [vscode-elements](https://github.com/vscode-elements/elements)
- [VS Code Webview UI Toolkit (deprecated)](https://github.com/microsoft/vscode-webview-ui-toolkit)
- [Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)
- [VS Code Accessibility Guidelines](https://github.com/microsoft/vscode/wiki/Accessibility-Guidelines)
- [vscode-messenger](https://www.typefox.io/blog/vs-code-messenger/)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)
