# VS Code Extension UX Patterns Research

## For: AI Coding Assistant with Persistent Memory Visualization

Research conducted: 2026-03-14

---

## What Makes Users Love an Extension

Users love extensions that:

1. **Reduce context switching** - Keep developers in their coding environment
2. **Feel invisible when not needed** - Non-intrusive by default, powerful when invoked
3. **Provide just-in-time information** - Show relevant data at the moment it's needed
4. **Respect customization** - Let users adjust or disable features that don't fit their workflow
5. **Integrate seamlessly** - Look and feel like native VS Code, not a foreign application

The best extensions feel like they shipped with VS Code. They use native UI patterns, respect themes, and follow keyboard conventions.

---

## Official VS Code UX Guidelines

### Core Principles

1. **Extensions have no DOM access** - You cannot apply custom CSS or add arbitrary HTML. Work within VS Code's UI framework.

2. **Lazy loading is mandatory** - Extensions activate on specific events, not at startup. A well-designed extension defers work until needed.

3. **Webviews are last resort** - Use native Tree Views, Quick Picks, and Status Bar items first. Only use webviews when native APIs are inadequate.

4. **Theme integration is required** - All UI elements must respect the user's color theme using CSS tokens.

### The Container Model

VS Code UI divides into containers (large sections) and items (elements within containers):

- **Activity Bar** - Icon buttons for switching view containers
- **Primary Sidebar** - Main content area (Explorer, Search, Source Control)
- **Secondary Sidebar** - Additional panel (can be toggled)
- **Editor Area** - Where code lives
- **Panel** - Bottom area (Terminal, Problems, Output)
- **Status Bar** - Information strip at the bottom

---

## Sidebar Patterns

### When to Use Tree Views

Use Tree Views for:
- Hierarchical data (file trees, outline views)
- Flat lists of items
- Data that needs icons, labels, and context menus
- Native VS Code look and feel

Best practices:
- Use descriptive labels with context
- Use product icons to distinguish item types
- Keep nesting depth reasonable (2-3 levels ideal)
- Support keyboard navigation
- Add context menu actions for common operations

### When to Use Webview Views (in Sidebar)

Use Webview Views for:
- Complex custom UI that Tree Views cannot handle
- Rich visualizations (charts, graphs, diagrams)
- Interactive elements beyond click/expand
- Custom forms or editors

Critical rules:
- Use sparingly - webviews are resource-heavy
- Must support all themes via CSS tokens
- Must be keyboard accessible
- Never show promotions, upgrade upsells, or sponsor content
- Never duplicate existing VS Code features

### View Container Best Practices

- Add your views to existing containers when appropriate (Source Control, Explorer)
- Create a new Activity Bar icon only if your extension deserves its own workspace
- Use Welcome Views for empty states with helpful guidance
- Toolbar actions should be contextual to the selected item

---

## Panel Patterns

### Bottom Panel (Default Location)

The Panel is for:
- Output logs and terminal
- Problems and diagnostics
- Debug information
- Any view that benefits from horizontal width

When to use:
- Content that complements the editor without blocking it
- Output that users reference while coding
- Views that need more horizontal space than vertical

### Panel vs Sidebar Decision

| Use Panel | Use Sidebar |
|-----------|-------------|
| Reference content (logs, output) | Navigation content (tree views) |
| Horizontal layout preferred | Vertical layout preferred |
| Secondary to current editing task | Primary interaction point |

### Webviews in Panel

Particularly useful when:
- Custom content doesn't resize well in sidebars
- You need to render visualizations
- Content requires editor-like behavior

---

## Notification Patterns

### Notification Types

| Type | API | Use When |
|------|-----|----------|
| Information | `showInformationMessage()` | Confirming actions, non-critical updates |
| Warning | `showWarningMessage()` | Potential issues requiring attention |
| Error | `showErrorMessage()` | Something went wrong |
| Progress | `withProgress()` | Long-running operations |

### Best Practices

1. **Be sparing** - Users develop notification fatigue quickly
2. **Provide actions** - Give users buttons to act, not just dismiss
3. **Use progress for background work** - Show a Status Bar spinner for quiet progress, escalate to notification only when user attention needed
4. **Keep messages concise** - Get to the point immediately

### Progress Notification Rules

- Use for indeterminate timeframes (environment setup, indexing)
- Show progress in context when possible (within a view)
- Progress notifications are global - use Status Bar for discreet progress
- Allow cancellation when possible
- Update progress frequently to show activity

---

## Status Bar Patterns

### Placement Rules

| Left Side | Right Side |
|-----------|------------|
| Workspace-level info (branch, sync status) | Contextual info (language, encoding) |
| Global status (problems, warnings) | File-specific info (line/column) |
| Sync/collaboration status | Feedback buttons |

### Best Practices

1. **Limit items** - Space is shared with other extensions
2. **Keep text short** - Use icons when possible
3. **Use ThemeColor** - Respect user's theme
4. **Make it actionable** - Click should do something useful
5. **Show discreet progress here** - Loading icon with spin animation

### For AI/Memory Extensions

Status bar is ideal for:
- Connection status to AI service
- Memory/context usage indicator
- Quick toggle for features
- "Working..." indicator during AI operations

---

## Command Palette Integration

### Naming Conventions

Do:
- Use clear, descriptive names
- Group related commands with a category prefix (e.g., "Memory: Clear Session")
- Add keyboard shortcuts for frequent actions

Don't:
- Overwrite existing keyboard shortcuts
- Use emojis in command names
- Create commands that only work in specific contexts without proper `when` clauses

### Command Visibility

- Use `menus.commandPalette` contribution to hide context-specific commands
- Commands should be discoverable when relevant, hidden when not
- Category prefix groups commands in palette (e.g., "Git: Commit", "Git: Push")

### Keyboard Shortcuts

- Prefer chord patterns for extension commands (Ctrl+K followed by another key)
- Test on all platforms (Windows, macOS, Linux)
- Don't conflict with common VS Code shortcuts

---

## Quick Pick and Input Box Patterns

### When to Use Quick Picks

Perfect for:
- Selecting from a list of options
- Filtering content
- Simple configuration choices
- Multi-step workflows (limited steps)

### Best Practices

1. **Keep lists concise** - Relevant to current context
2. **Clear labels** - Use description and detail for extra info
3. **Group with separators** - Clear sections for different categories
4. **Provide placeholder text** - Guide users on what to do
5. **Support filtering** - For longer lists

### Anti-Patterns

- Don't use for wizard-like multi-step flows
- Don't create excessively long lists
- Don't require users to remember previous selections

---

## Walkthrough and Onboarding Patterns

### When to Use Walkthroughs

- Onboarding new users to your extension
- Introducing major features after updates
- Guiding users through initial setup

### Best Practices

1. **Use helpful images** - Add visual context to steps
2. **Support all themes** - Use SVGs with theme colors
3. **Provide actions** - Each step should have a clickable action
4. **Keep it short** - 3-5 steps maximum
5. **Don't block** - Users should be able to skip or return later

### Don't

- Auto-open on every window
- Show on every update
- Include marketing or upsells

---

## Color and Icon Conventions

### Theme Integration

All custom UI must use VS Code's theme colors:
- `icon.foreground` - Default icon color
- `foreground` - Default text color
- `focusBorder` - Focus indicators
- Use ThemeColor API for Status Bar items

### Icon Guidelines

- Use Codicons (VS Code's icon font) when possible
- Custom icons should be single-color glyphs
- Support both light and dark themes
- Use consistent icon sizing

### Color Contrast Requirements

| Context | Minimum Ratio | Target Ratio |
|---------|---------------|--------------|
| High Contrast themes | 4.5:1 | 7:1 |
| Editor (other themes) | 3:1 | 4.5:1 |
| Non-editor (other themes) | 4.5:1 | 4.5:1 |

---

## Accessibility Requirements

### Keyboard Navigation

- Every interactive element must be keyboard accessible
- No mouse-only functionality
- Focus movement should follow visual layout
- Use arrow keys to reduce tab stops (like ActionBar pattern)

### Screen Reader Support

- Test with NVDA (Windows), VoiceOver (macOS), Orca (Linux)
- Set informative `aria-label` on focusable elements
- Put critical information first in labels
- Use `aria.alert()` for announcements when focus-based isn't possible

### ARIA Labels

Format: "Important info first, secondary info second, path/context last"

Example: `"session.json, modified, ~/brain/workspace/"`

### Links and Controls

- Use native HTML elements when possible
- Apply `text-decoration: var(--text-link-decoration)` for links
- Associate labels with all form controls

---

## Best-in-Class Extension Analysis

### GitLens - Why Users Love It

1. **Just-in-time information** - Inline blame annotations show who changed code without leaving context
2. **Visual encoding** - Heatmaps show code age at a glance
3. **Progressive disclosure** - Hover for more detail, click for full history
4. **Deeply customizable** - Every feature can be adjusted or disabled
5. **Native feel** - Uses VS Code's Tree Views, hovers, and decorations
6. **Non-intrusive defaults** - Information is subtle until you need it

Key patterns:
- Inline decorations (end of line annotations)
- Hover popovers with rich context
- Custom Tree Views for history navigation
- Command palette commands grouped under "GitLens:"

### Thunder Client - Why Users Love It

1. **Native feel** - "Feels like it shipped with VS Code"
2. **Simplistic interface** - Intuitive without needing documentation
3. **Local-first** - 100% local storage, fast performance
4. **GUI over scripts** - Scriptless testing reduces complexity
5. **Lightweight** - Doesn't slow down VS Code

Key patterns:
- Webview for complex API request/response UI
- Activity Bar icon for dedicated workspace
- Collections in Tree View for organization
- Local file storage for data persistence

### GitHub Pull Requests - Why Users Love It

1. **Eliminates context switching** - Review PRs without leaving editor
2. **Full code context** - Navigate code while reviewing, unlike web interface
3. **In-editor commenting** - Review experience matches editing experience
4. **Smart productivity** - Create issues from TODOs, hover cards for mentions
5. **Customizable queries** - Filter using GitHub's familiar syntax

Key patterns:
- Tree View for PR/Issue lists
- Webview for PR detail view
- Inline comments in editor
- Diff views in editor tabs
- Status Bar for current PR status

---

## Anti-Patterns to Avoid

### UX Anti-Patterns

1. **Webview abuse** - Using webviews for what Tree Views could handle
2. **Notification spam** - Too many alerts, no user control
3. **Modal interruptions** - Blocking user workflow
4. **Auto-activation** - Starting on every VS Code window
5. **Update popups** - Showing what's new on every update
6. **Promotion content** - Ads, upsells, sponsor banners

### Technical Anti-Patterns

1. **Blocking main thread** - Synchronous operations that freeze UI
2. **Missing `when` clauses** - Commands showing when irrelevant
3. **Theme ignorance** - Hardcoded colors that break in dark/light themes
4. **Keyboard shortcuts conflicts** - Overriding common VS Code keys
5. **Extension host crashes** - Poor error handling that brings down all extensions

### Memory/AI Extension Specific

1. **Silent context compression** - Users don't know what's being remembered
2. **No visibility into state** - Can't see what memory contains
3. **Re-explaining required** - Forcing users to re-provide context
4. **Opaque decisions** - AI acts without explaining reasoning

---

## Patterns for AI/Memory Visualization

### Memory Bank UX (from Kilo Code research)

Users want:
- **Transparency** - See context window size on each request
- **Full prompt visibility** - Know exactly what's being sent
- **Persistence visibility** - Know what's being remembered across sessions
- **Control** - Ability to clear, edit, or review stored context

### Recommended Patterns for Memory Extension

1. **Status Bar indicator** - Show memory usage (e.g., "3.2k/8k tokens")
2. **Tree View for memory items** - Browse stored context, decisions, patterns
3. **Quick Pick for memory actions** - Clear session, export, import
4. **Hover previews** - See memory item content without navigating
5. **Inline decorations** - Mark code that AI has context about
6. **Progress notifications** - Show when syncing or processing memory

### Visualization Ideas

- Timeline view of session history
- Context graph showing related memories
- Diff view for memory changes
- Search across stored context
- Tags/categories for memory items

---

## Summary: What Makes Users Love an Extension

1. **Native integration** - Uses VS Code patterns, respects themes, follows conventions
2. **Non-intrusive** - Quiet by default, powerful when invoked
3. **Just-in-time** - Information appears when needed, not before
4. **Transparent** - Users understand what's happening
5. **Customizable** - Every feature can be adjusted to user preference
6. **Performant** - Fast, lightweight, no lag
7. **Accessible** - Keyboard navigable, screen reader friendly
8. **Contextual** - Understands what user is working on

The golden rule: **An extension should feel like a natural part of VS Code, not a separate application running inside it.**

---

## Sources

### Official VS Code Documentation
- [UX Guidelines Overview](https://code.visualstudio.com/api/ux-guidelines/overview)
- [Views](https://code.visualstudio.com/api/ux-guidelines/views)
- [Webviews](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [Sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars)
- [Panel](https://code.visualstudio.com/api/ux-guidelines/panel)
- [Status Bar](https://code.visualstudio.com/api/ux-guidelines/status-bar)
- [Notifications](https://code.visualstudio.com/api/ux-guidelines/notifications)
- [Quick Picks](https://code.visualstudio.com/api/ux-guidelines/quick-picks)
- [Command Palette](https://code.visualstudio.com/api/ux-guidelines/command-palette)
- [Walkthroughs](https://code.visualstudio.com/api/ux-guidelines/walkthroughs)
- [Accessibility Guidelines](https://github.com/microsoft/vscode/wiki/Accessibility-Guidelines)
- [Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)

### Extension Examples
- [GitLens](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
- [Thunder Client](https://www.thunderclient.com/)
- [GitHub Pull Requests](https://github.com/microsoft/vscode-pull-request-github)
- [Awesome UX Sample](https://github.com/stateful/vscode-awesome-ux)

### AI Extension Research
- [AI Memory Extension](https://marketplace.visualstudio.com/items?itemName=CoderOne.aimemory)
- [Kilo Code](https://kilo.ai/)
- [VS Code AI Extensibility](https://code.visualstudio.com/api/extension-guides/ai/ai-extensibility-overview)
