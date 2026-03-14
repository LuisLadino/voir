# Design System

## Visual Direction

**VS Code Native** - The extension should feel like a natural part of VS Code, using its design language and interaction patterns. For data-dense views (traces, timelines), lean into technical/APM aesthetics while maintaining VS Code consistency.

Core principles:
- **Integrated** - Looks and feels like VS Code, not a foreign embedded app
- **Data-dense where appropriate** - Observability needs information density
- **Scannable** - Users should find what they need quickly
- **Theme-aware** - Works in light, dark, and high-contrast themes

## Colors

### Use VS Code CSS Variables

The extension uses VS Code's CSS custom properties for automatic theme support:

```css
/* Backgrounds */
--vscode-editor-background
--vscode-sideBar-background
--vscode-panel-background

/* Text */
--vscode-editor-foreground
--vscode-descriptionForeground
--vscode-disabledForeground

/* Borders */
--vscode-panel-border
--vscode-widget-border

/* Interactive */
--vscode-button-background
--vscode-button-foreground
--vscode-button-hoverBackground

/* Focus */
--vscode-focusBorder

/* Lists */
--vscode-list-hoverBackground
--vscode-list-activeSelectionBackground
--vscode-list-activeSelectionForeground
```

### Semantic Colors

For observability-specific meanings, use VS Code's semantic variables:

```css
/* Status indicators */
--vscode-testing-iconPassed      /* Success / completed */
--vscode-testing-iconFailed      /* Error / failed */
--vscode-testing-iconQueued      /* Pending / in progress */

/* Severity */
--vscode-editorWarning-foreground
--vscode-editorError-foreground
--vscode-editorInfo-foreground

/* Git-style diffs (for file changes) */
--vscode-gitDecoration-addedResourceForeground
--vscode-gitDecoration-modifiedResourceForeground
--vscode-gitDecoration-deletedResourceForeground
```

### Chart/Visualization Colors

For charts and data visualization, define a consistent palette that works in both light and dark themes:

```css
:root {
  /* Primary data series */
  --voir-chart-primary: var(--vscode-charts-blue);
  --voir-chart-secondary: var(--vscode-charts-green);
  --voir-chart-tertiary: var(--vscode-charts-orange);

  /* Token usage */
  --voir-tokens-input: var(--vscode-charts-blue);
  --voir-tokens-output: var(--vscode-charts-purple);

  /* Tool types */
  --voir-tool-bash: var(--vscode-charts-orange);
  --voir-tool-edit: var(--vscode-charts-green);
  --voir-tool-read: var(--vscode-charts-blue);
  --voir-tool-write: var(--vscode-charts-purple);
}
```

## Typography

### Use VS Code Fonts

```css
/* Code/monospace */
font-family: var(--vscode-editor-font-family);
font-size: var(--vscode-editor-font-size);

/* UI text */
font-family: var(--vscode-font-family);
font-size: var(--vscode-font-size);
```

### Scale

- **Headers in webview:** Use VS Code heading styles or scale from base font size
- **Body text:** Use --vscode-font-size (typically 13px)
- **Small/secondary:** 0.9em or --vscode-descriptionForeground
- **Code snippets:** --vscode-editor-font-family with --vscode-editor-font-size

### Line Height

- Default: 1.4 for readability
- Dense (tables, lists): 1.2
- Code: Match VS Code editor line height

## Components

### VS Code Webview UI Toolkit

Use [@vscode/webview-ui-toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit) for native components:

- `<vscode-button>` - Primary and secondary actions
- `<vscode-dropdown>` - Selections
- `<vscode-text-field>` - Search, filters
- `<vscode-checkbox>` - Toggles
- `<vscode-data-grid>` - Tables
- `<vscode-panels>` - Tab navigation
- `<vscode-badge>` - Counts, status

### Custom Components (when needed)

#### Timeline
- Horizontal scroll with fixed left axis
- Events as points on timeline, expandable
- Zoom controls for time scale
- Current time indicator

#### Trace Tree
- Expandable hierarchy (like browser DevTools)
- Icons indicating event type
- Duration/timing annotations
- Click to expand details

#### Metric Cards
- Compact summary card format
- Icon + value + label
- Trend indicator (optional)
- Click for details

#### Session List Item
- Timestamp + duration
- Token count (input/output)
- Tool call count
- Status indicator (complete/in-progress)
- Truncated summary

### Spacing

Use VS Code's implicit spacing or define consistent units:

```css
--voir-spacing-xs: 4px;
--voir-spacing-sm: 8px;
--voir-spacing-md: 12px;
--voir-spacing-lg: 16px;
--voir-spacing-xl: 24px;
```

Apply:
- Card padding: `--voir-spacing-md`
- Between cards: `--voir-spacing-sm`
- Section margins: `--voir-spacing-lg`
- Tight lists: `--voir-spacing-xs`

### Borders

Match VS Code styling:
- Border color: `var(--vscode-panel-border)`
- Border radius: 0 (VS Code is sharp corners) OR 4px for cards
- Border width: 1px

## Icons

Use VS Code's Codicons for consistency:
- Session: `$(history)`
- Tool call: `$(tools)`
- File: `$(file)`
- Folder: `$(folder)`
- Success: `$(check)`
- Error: `$(error)`
- Warning: `$(warning)`
- Refresh: `$(refresh)`
- Filter: `$(filter)`
- Expand: `$(chevron-right)`
- Collapse: `$(chevron-down)`

For custom icons (activity bar), follow VS Code icon guidelines:
- 24x24 SVG
- Single color (filled by theme)
- Clean, simple shapes

## Motion

### Transitions

Subtle and purposeful:
- Duration: 150ms for micro-interactions, 250ms for panel transitions
- Easing: ease-out for entrances, ease-in for exits
- Properties to animate: opacity, transform (not dimensions)

```css
.voir-panel {
  transition: opacity 150ms ease-out;
}

.voir-expandable {
  transition: max-height 200ms ease-out;
}
```

### Loading States

- Use VS Code's built-in loading indicators where available
- For custom loaders, use subtle animations
- Avoid spinners for quick operations (<200ms)

### Avoid

- Bouncing/playful animations
- Delays that slow down the interface
- Animations that can't be prefers-reduced-motion disabled

## Responsive Behavior

### Panel Widths

- Minimum webview width: 320px
- Optimal width: 600-800px
- Sidebar panels: fixed width per VS Code

### Overflow

- Tables: horizontal scroll
- Long text: truncate with ellipsis, tooltip on hover
- Lists: vertical scroll with virtualization for large sets

### Breakpoints (webview)

```css
/* Compact (sidebar-like) */
@media (max-width: 400px) { }

/* Normal */
@media (min-width: 401px) and (max-width: 800px) { }

/* Wide */
@media (min-width: 801px) { }
```

## Accessibility

### Baseline: WCAG AA

- Color contrast: minimum 4.5:1 for text (handled by VS Code theme variables)
- Focus indicators: use --vscode-focusBorder
- Keyboard navigation: all interactive elements reachable
- Screen reader: semantic HTML, ARIA labels where needed

### Specific Requirements

- Status indicators: don't rely on color alone (add icons/text)
- Charts: provide text alternative or data table view
- Interactive elements: visible focus states
- Motion: respect prefers-reduced-motion
