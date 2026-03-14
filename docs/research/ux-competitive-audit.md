# UX Competitive Audit: AI Coding Extension Interfaces

**Date:** 2026-03-14
**Purpose:** Document UX patterns from leading AI coding assistants to inform design of a VS Code extension with persistent memory visualization.

---

## Executive Summary

After analyzing five tools (Continue.dev, Cursor, Cody, GitHub Copilot, GitLens), clear patterns emerge:

1. **Sidebar is the primary surface** - All AI assistants use the sidebar for chat. The debate is left vs. right placement.
2. **Inline > Panel for diffs** - Editing in-place feels native; bouncing to panels breaks flow.
3. **Context visualization is underdeveloped** - Most tools hide what the AI "knows." The few that expose it (Copilot's token bar, Cursor's context pills) feel more trustworthy.
4. **Memory is the frontier** - Persistent context/rules exist, but surfacing them is clunky (files, settings menus). No one has nailed "show me what you remember."

---

## 1. Continue.dev

**Source:** [Continue.dev VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Continue.continue), [Continue Docs](https://docs.continue.dev/)

### UI Components Used

| Component | Implementation |
|-----------|----------------|
| **Sidebar** | Primary interface. Webview lazy-loaded on first open. Strongly recommended to move to RIGHT sidebar. |
| **Inline Editing** | Cmd+I triggers inline edit mode with diff streaming directly into the file. |
| **Tabs** | Chat sessions organized as tabs (similar to browser tabs). Middle-click to close. |
| **Notch** | Control panel above chat input for toggling rules, bookmarking prompts, managing tools. |
| **Status Indicators** | Yellow border when staging mode is active. Visual indicators for running tools. |

### How Context is Displayed

- **The Notch:** A "control panel" positioned above the chat input that shows active rules, bookmarked prompts, allowed tools, and blocks. This is their primary context visualization surface.
- **Prompt Inspector:** Purpose-built UI for viewing the exact prompt and completion from the LLM, including request metadata. Designed for transparency.
- **No token counter visible in chat UI** (based on available documentation).

### What Feels Native

- **Keyboard shortcuts mirror VS Code patterns:** Cmd+L for chat, Cmd+I for inline edit.
- **Right sidebar recommendation:** Continue recognizes VS Code's left sidebar is crowded (Explorer, Source Control) and pushes users toward the secondary sidebar.
- **Tab-based chat sessions:** Familiar from browser UX.

### What's Frustrating / Missing

- **Diff readability:** Users complain inline vertical diffs are "hard to read" and "kinda ugly" with small accept/reject buttons. Feature requests for full horizontal diff view exist.
- **Null changes:** When using Cmd+I, unchanged lines still require accept/reject, creating noise.
- **No full diff view:** Users want to open a side-by-side diff comparing original vs. proposed changes.

### Key UX Pattern: The Notch

The "notch" is Continue's most distinctive UI pattern. It's a persistent control surface that lives above the chat input, making context management visible without requiring navigation to settings or separate panels.

**What it does well:**
- Always visible during chat
- Quick toggles for rules and tools
- Collapses complexity into a compact bar

**Opportunity:** Extend this pattern for memory visualization - show what persistent context is loaded.

---

## 2. Cursor

**Source:** [Cursor](https://cursor.com/), [Cursor Docs](https://docs.cursor.com/), [Prismic Blog](https://prismic.io/blog/cursor-ai)

### UI Components Used

| Component | Implementation |
|-----------|----------------|
| **Composer (Panel)** | Primary multi-file editing interface. Two modes: floating window (Cmd+I) or full-screen with 3 panels (Cmd+Shift+I). |
| **Agent Sidebar** | Cursor 2.0 redesign: agents, plans, and runs are first-class objects in a dedicated sidebar. |
| **Context Pills** | Files and code sections appear as inline pills within conversations. |
| **Progress Panel** | Shows current agent actions ("searching codebase", "editing files"). |
| **Notepads** | "Supercharged sticky notes" for storing reusable context bundles. |

### How Context is Displayed

- **Context Pills:** Files/symbols the agent is working with appear as clickable pills inline in the conversation. This makes scope visible without listing files separately.
- **Agent Plans:** Multi-step strategies an agent intends to follow are inspectable in the sidebar.
- **Real-time Progress:** Live updates show what the agent is doing right now.
- **Rules Visibility:** `.cursorrules` file and project rules (`.cursor/rules/`) provide always-on constraints. Users can also reference Notepads with `@` symbols for "sometimes-on" context.
- **1M+ token context:** Cursor touts expanded memory beyond typical limits. Context feels seamless because the model rarely "forgets."

### What Feels Native

- **VS Code foundation:** Cursor is a VS Code fork, so keybindings and extension compatibility carry over.
- **Multi-agent parallel execution:** Up to 8 agents can run simultaneously, each showing progress independently.
- **Agent-centric layout:** The 2.0 redesign moved away from file-centric views. Files appear as pills within agent conversations rather than in the file tree.

### What's Frustrating / Missing

- **Button overload:** Cursor has "all those buttons everywhere" - power features create clutter.
- **Learning curve:** The agent-centric interface requires unlearning traditional file navigation.
- **Rules file discovery:** The `.cursorrules` and `.cursor/rules/` system is powerful but requires documentation diving to understand.

### Key UX Patterns

**1. Context Pills**
Instead of listing files in a working set sidebar, Cursor shows referenced files as inline pills within the chat/composer. This keeps context visible where you're working.

**2. Notepads as Reusable Context**
Notepads solve a real problem: "I need this context sometimes, not always." They're referenced with `@NoteName` in prompts. Better than dumping everything into rules files.

**3. Progress as Real-Time Feedback**
When agents are running, users see what's happening: "searching codebase," "editing src/auth.ts." This builds trust.

**Opportunity:** Memory visualization could adopt the pills pattern - show persistent memories as pills that can be expanded, edited, or dismissed.

---

## 3. Cody (Sourcegraph)

**Source:** [Sourcegraph Cody VS Code Extension](https://marketplace.visualstudio.com/items?itemName=sourcegraph.cody-ai), [DeepWiki](https://deepwiki.com/sourcegraph/cody/2-vs-code-extension)

### UI Components Used

| Component | Implementation |
|-----------|----------------|
| **Sidebar** | Primary interface. Default left, but can be moved to secondary sidebar or bottom panel. |
| **Autocomplete** | Ghost text suggestions inline. |
| **Chat** | Webview-based chat in sidebar. |
| **Status Bar** | CodyStatusBar shows authentication status, errors, loading states. Click for quick settings. |

### How Context is Displayed

- **Cross-Repo Search:** Cody's differentiator is repo-scale knowledge. It can pull context from multiple repositories, symbols, and references.
- **Embeddings Index:** Code is indexed as vector embeddings for semantic similarity matching. This happens silently; users don't see the index.
- **Minimal UI surface for context:** Unlike Cursor's pills, Cody's context retrieval is largely invisible. You trust the model knows what it needs.

### What Feels Native

- **Unobtrusive:** "It doesn't interfere with big banners showing recommendations or pushing my main window to the left or to the right of the screen. It is just there to give suggestions only when you want it to."
- **Status bar integration:** The CodyStatusBar uses native VS Code patterns for showing state.
- **No aggressive UI chrome:** Cody stays out of the way.

### What's Frustrating / Missing

- **Opaque context:** Users don't see what context Cody is using. Trust is required.
- **Enterprise focus:** Features like SSO/RBAC and policy controls suggest a focus on large organizations, which can mean heavier setup for individuals.
- **No visible memory/persistence:** Unlike Cursor's rules or Notepads, Cody doesn't have obvious user-facing memory controls in the UI.

### Key UX Pattern: The Invisible Assistant

Cody's philosophy is "stay out of the way." Autocomplete appears when relevant, chat is in the sidebar, but there's no constant visual presence. This is the opposite of Cursor's button-heavy interface.

**Trade-off:** Less clutter, but also less transparency. Users can't easily verify what context the AI is using.

**Opportunity:** Find a middle ground - allow users to "peek" at context on demand without always showing it.

---

## 4. GitHub Copilot

**Source:** [VS Code Copilot Docs](https://code.visualstudio.com/docs/copilot/overview), [Copilot Chat](https://code.visualstudio.com/docs/copilot/chat/copilot-chat)

### UI Components Used

| Component | Implementation |
|-----------|----------------|
| **Chat Panel** | Primary in sidebar. Can invoke @-mentions for specialized participants (@vscode, @terminal). |
| **Secondary Sidebar (Edits)** | Copilot Edits lives in the right sidebar so you can use Explorer/Debug on the left simultaneously. |
| **Working Set** | Files you're editing appear in a dedicated list. Drag-and-drop or # to add files. |
| **Inline Diff** | Hover over changes to accept/reject specific hunks. |
| **Context Fill Indicator** | Visual bar showing % of context window used, with token breakdown on hover. |

### How Context is Displayed

- **Context Fill Indicator:** A shaded bar shows proportion of context window in use. Hover for exact token count (e.g., "15K/128K") and breakdown by category.
- **#-mentions:** Explicit context references: `#file`, `#codebase`, `#terminalSelection`, `#fetch`, `#githubRepo`.
- **@-mentions:** Chat participants like `@vscode` or `@terminal` that provide specialized context.
- **Image/Vision support:** Attach screenshots as context for prompts.

### What Feels Native

- **Microsoft owns VS Code:** Copilot is deeply integrated. It uses native VS Code diff views, native panels, native notifications.
- **Working Set as concept:** "These are the files I'm working on" is explicit. Files don't magically appear - you add them or they're auto-detected from open editors.
- **Per-hunk accept/reject:** Hover over inline changes to accept/reject individually. This granular control is highly praised.
- **Compaction messaging:** When context fills, Copilot auto-compacts and tells you. You can trigger `/compact` manually.

### What's Frustrating / Missing

- **Agent mode is opt-in:** Edit mode gives you control but requires more manual work. Agent mode is autonomous but harder to verify.
- **Memory is new (2026):** "Copilot Memory" was introduced in the January 2026 release. It's not as mature as Cursor's rules system.
- **Approval prompts for edits:** Copilot prompts for approval before editing sensitive files. This builds trust but adds friction.

### Key UX Patterns

**1. Context Fill Indicator**
The most explicit context visualization of any tool. A bar fills up, you hover to see tokens. This makes the abstract concrete.

**2. Working Set as Explicit Scope**
Instead of "AI figures it out," you define what files are in scope. Drag-and-drop or # to add. This is transparent and controllable.

**3. Per-Hunk Accept/Reject**
Inline change review where you can accept individual hunks without accepting everything. This is the gold standard for granular control.

**Opportunity:** The context fill indicator is an excellent pattern for memory visualization. Extend it to show "persistent memories" as a category.

---

## 5. GitLens

**Source:** [GitLens Marketplace](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens), [GitLens Settings](https://help.gitkraken.com/gitlens/gitlens-settings/)

### UI Components Used (Not AI, but Best-in-Class Extension UX)

| Component | Implementation |
|-----------|----------------|
| **Inline Annotations** | Small text at end of lines showing commit author/date. Unobtrusive until hovered. |
| **Hover Tooltips** | Rich commit details, diffs, avatars, PR info on hover. Extensively customizable. |
| **Sidebar Views** | Repositories, File History, Line History, Commits. Each is a collapsible tree. |
| **Status Bar** | Current branch, quick actions. |
| **Heatmap Gutter** | Color-coded age indicator along the scroll bar. Warmer = newer. |
| **Home View** | Compact dashboard for issues, PRs, tasks. "Take issues from code to merge." |
| **Command Palette** | All GitLens commands accessible via Cmd+Shift+P. No need for terminal. |

### What Feels Native

- **Everything follows VS Code conventions:** Sidebar views are standard tree views. Hover tooltips use VS Code's native hover API. Status bar items are standard.
- **Inline annotations don't disrupt code:** Small, faded text at line ends. Visible but not intrusive.
- **Customization depth:** Every feature can be adjusted or disabled. GitLens doesn't force a workflow.

### What's Frustrating / Missing

- **Feature overload:** 50+ commands, 8+ sidebar views, 100+ settings. Discoverability is hard.
- **Performance on large repos:** Some users report slowdowns with heavy annotation.
- **Not AI:** GitLens is about Git, not code generation. But its UX patterns are instructive.

### Key UX Patterns to Borrow

**1. Inline Annotations (Unobtrusive Context)**
Small, faded annotations at line ends provide context without demanding attention. Information is there when you look for it.

**Adaptation for memory:** Show small memory indicators inline - "AI remembers context about this function" - that expand on hover.

**2. Heatmap Gutter (Visual Age Indicators)**
Color-coded scroll bar shows code age at a glance. No text needed.

**Adaptation for memory:** Use color to indicate memory freshness or confidence. Warmer = recently confirmed. Cooler = stale.

**3. Hover for Details**
Click-free information access. Hover to see commit details, diffs, authors.

**Adaptation for memory:** Hover on memory indicators to see what's remembered, when it was captured, how it's being used.

**4. Command Palette Integration**
Power users can access any feature via keyboard. No mouse required.

**Adaptation for memory:** Expose all memory operations (add, edit, delete, search) via command palette.

---

## Cross-Cutting UX Insights

### What Works Across All Tools

1. **Sidebar for persistent surfaces** - Chat, history, settings all live in sidebars.
2. **Inline for ephemeral interactions** - Diffs, completions, annotations happen in the editor.
3. **Keyboard-first** - Every tool has extensive keyboard shortcuts.
4. **Right sidebar for secondary concerns** - Copilot Edits, Continue recommendations all suggest right sidebar to avoid conflicting with Explorer.

### Gaps in Current Tools

1. **Memory visualization is minimal** - No tool shows a clear "here's what I remember about you/this project" view.
2. **Context is often invisible** - Cody's approach (trust the AI) is clean but opaque. Users want transparency.
3. **Persistence management is file-based** - Rules, Notepads, .cursorrules are all files. No visual editor for persistent context.
4. **No memory timeline** - When was this learned? Has it been used? Is it still accurate? No tool answers these.

### Opportunities for Differentiation

1. **Memory as first-class UI surface**
   - Dedicated panel showing all persistent memories
   - Grouped by type: code patterns, preferences, project context
   - Editable, deletable, searchable

2. **Context fill bar with memory breakdown**
   - Extend Copilot's token indicator to show: "15K/128K: 5K current context, 3K memories, 7K conversation"
   - Make memory contribution visible

3. **Inline memory indicators**
   - Like GitLens blame annotations, but for AI knowledge
   - "AI knows about this function" indicator at function definition
   - Hover to see what's remembered

4. **Memory freshness/confidence visualization**
   - Color-coded (like GitLens heatmap) for memory age
   - Show when memories were captured and last confirmed
   - Flag stale memories for review

5. **Memory capture UX**
   - Explicit "Remember this" command
   - Selection-based: select code, "Remember this pattern"
   - Confirmation: "Added to memory: [preview]. Edit? Delete?"

---

## Summary: UX Principles for Memory Visualization

Based on this audit, a well-designed memory visualization system should:

### Be Transparent
- Show what the AI knows (Copilot's context indicator, Cursor's pills)
- Don't hide memory behind settings menus

### Be Unobtrusive
- Inline indicators should be small and faded (GitLens pattern)
- Details on demand via hover, not always visible

### Be Controllable
- Per-item accept/reject (Copilot's per-hunk pattern)
- Edit, delete, search memories
- Rules for what gets remembered

### Be Discoverable
- Keyboard shortcuts for power users
- Visual controls for discoverability
- Clear grouping (project context, code patterns, preferences)

### Be Native
- Use VS Code's sidebar, panel, hover, status bar conventions
- Follow existing keyboard shortcut patterns
- Don't create new UI paradigms when existing ones work

---

## Sources

- [Continue.dev VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Continue.continue)
- [Continue Docs - Chat Quick Start](https://docs.continue.dev/ide-extensions/chat/quick-start)
- [Continue Changelog](https://changelog.continue.dev/)
- [Cursor AI](https://cursor.com/)
- [Cursor Docs - Rules](https://cursor.com/docs/context/rules)
- [Cursor Docs - Notepads](https://docs.cursor.com/beta/notepads)
- [Prismic Blog - Cursor Review 2026](https://prismic.io/blog/cursor-ai)
- [Sourcegraph Cody Extension](https://marketplace.visualstudio.com/items?itemName=sourcegraph.cody-ai)
- [GitHub Copilot in VS Code](https://code.visualstudio.com/docs/copilot/overview)
- [VS Code Copilot Chat](https://code.visualstudio.com/docs/copilot/chat/copilot-chat)
- [GitHub Copilot February 2026 Release](https://github.blog/changelog/2026-03-06-github-copilot-in-visual-studio-code-v1-110-february-release/)
- [GitLens Extension](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)
- [GitLens Settings](https://help.gitkraken.com/gitlens/gitlens-settings/)
- [VS Code UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)
- [AI Memory Extension](https://marketplace.visualstudio.com/items?itemName=CoderOne.aimemory)
