# UX Research: Information Architecture for AI Memory Visualization

## Executive Summary

This research explores how to visualize an AI coding assistant's persistent memory system in a VS Code extension. The system includes session history, current context, learnings, patterns, decisions, and task history.

Key insight: Users don't think of "AI memory" as a database. They think of it as **a collaborator who remembers**. The UX should reflect that mental model.

---

## 1. Information Hierarchy

### Primary Information (Always Visible)
What users need at a glance, before deciding to dig deeper:

| Element | Why Primary |
|---------|-------------|
| **Current session state** | "What does the AI know right now?" |
| **Recent context** | Last 3-5 items worked on (tasks, files, decisions) |
| **Active learnings** | Rules/preferences affecting current work |

Users checking memory want to answer: "Will the AI remember this?" and "What context does it have?"

### Secondary Information (One Click Away)
Available when users want more detail:

| Element | Why Secondary |
|---------|---------------|
| **Session history** | Past sessions grouped by time/project |
| **All learnings** | Full list of accumulated knowledge |
| **Pattern library** | Technical patterns discovered |
| **Decision log** | Design decisions made |

### Tertiary Information (Search/Filter to Access)
Deep archive, rarely browsed directly:

| Element | Why Tertiary |
|---------|--------------|
| **Full session transcripts** | Raw history of all interactions |
| **Research artifacts** | Investigation findings |
| **Tool usage analytics** | Detailed metrics |

---

## 2. When Users Need Each Type

### Before Asking AI
- **Current context check**: "Does it know about the refactor I did yesterday?"
- **Learnings verification**: "Did I teach it about our error handling pattern?"
- Users want quick confirmation, not deep exploration

### During Work
- **Active learnings display**: "Which rules are influencing responses?"
- **Context window indicator**: "How much is loaded?" (Similar to how Mem0 shows memory visualization)
- Real-time, low-attention-demand displays

### After Completing Work
- **Review session**: "What did we accomplish? What should be saved?"
- **Capture learnings**: "What new patterns emerged?"
- Reflective, summary-focused views

### During Review/Cleanup
- **Browse history**: "What have I worked on this month?"
- **Prune outdated**: "Which learnings are stale?"
- Exploration and curation modes

---

## 3. Organization Strategies

### Recommendation: Hybrid Approach

Based on research from Obsidian, Notion, and PKM systems, a pure hierarchy doesn't match how memory works. Users benefit from multiple access patterns:

#### Primary Organization: By Recency
- Default view shows most recent first
- Users have strong "recently viewed" mental model from browser history
- Time-based organization is universally understood

#### Secondary Organization: By Project/Workspace
- Group artifacts by which project they belong to
- Matches VS Code's workspace model
- Clear scope boundaries

#### Tertiary Organization: By Type
- Sessions, Learnings, Patterns, Decisions as categories
- Useful for targeted searches ("show me all patterns")
- Aligns with system's internal structure

### What Research Shows

**Obsidian's approach**: Non-prescriptive. Let patterns emerge organically through linking. The "graph view" shows relationships between ideas without forcing hierarchy.

**Browser history**: Purely chronological with search. Users scan recent items, rarely browse deep history. Search is the escape hatch.

**Git history visualizations**: DAG (Directed Acyclic Graph) shows relationships and time together. Tools like GitUp render 40,000 commits in <1 second because users need to scan, not read.

**Activity feeds**: Best when aggregated ("Sam, Joan, and 12 others liked your post") rather than listing every atomic action.

---

## 4. User Mental Models for "AI Memory"

### What Users Expect

Based on PKM and AI assistant research, users have these mental models:

#### Model 1: "The Colleague Who Remembers"
Users expect the AI to remember like a coworker would:
- Remembers recent work in detail
- Has fuzzy recall of older work
- Can be reminded of forgotten context
- Learns preferences over time

**Design implication**: Show memory degrading gracefully with time, not as a binary "remembered/forgotten."

#### Model 2: "My Notes, But Smarter"
From second-brain apps (Notion, Obsidian):
- Information stored as building blocks
- Can be recombined and connected
- Searchable and browsable
- I control what's captured

**Design implication**: Make captured artifacts feel like user-owned assets, not opaque system state.

#### Model 3: "Context Window" (Technical Users)
From AI power users:
- Finite space for "active" memory
- Old context "slides out" when limit reached
- Need to manage what's loaded

**Design implication**: Visualize context window usage (how much is loaded vs. capacity).

### Mental Model Mismatch to Avoid

Users don't think in terms of:
- "Embedding vectors" or "semantic search"
- "Session IDs" or "UUIDs"
- "JSON schemas" or data structures

Even for developer audience, the UX should speak in terms of memory, recall, and knowledge, not technical implementation.

---

## 5. Level of Detail: Summary vs. Full History

### Progressive Disclosure is Key

Research from Nielsen Norman Group and IBM Design confirms: start simple, reveal complexity on demand.

**Level 1 - Glanceable Summary**
```
Current Session: 45 min | 12 files touched | 3 learnings active
Last session: "Fixed authentication bug" (2 hours ago)
```

**Level 2 - Expandable Detail**
Clicking expands to show:
- Files modified with paths
- Commands run
- Which learnings were applied
- Key decisions made

**Level 3 - Full History**
Accessed via dedicated view or search:
- Complete session transcript
- All tool calls with timing
- Diff-level file changes

### When to Aggregate

Following activity feed best practices:
- **Aggregate similar actions**: "Modified 5 files in /src/auth/" not 5 separate entries
- **Show counts with drill-down**: "23 sessions this week" with ability to browse
- **Time-bucket history**: Today, Yesterday, This Week, This Month, Older

### What Obsidian Gets Right

Obsidian doesn't force users to organize before capturing. Write first, see what patterns emerge, organize later. Apply this:
- Capture everything automatically (hooks already do this)
- Surface patterns after the fact
- Let users decide what's worth keeping

---

## 6. Search and Filter Patterns

### Recommended Approach: Faceted Search

Based on research from Algolia and e-commerce UX, faceted search works best for large, categorized datasets.

#### Suggested Facets

| Facet | Values | Rationale |
|-------|--------|-----------|
| **Type** | Sessions, Learnings, Patterns, Decisions, Tasks | Core categories |
| **Timeframe** | Today, This Week, This Month, Custom | Temporal filtering |
| **Project** | List of workspaces | Scope boundaries |
| **Status** | Active, Archived, Stale | Lifecycle state |

#### Search UX Best Practices

1. **Show result counts per facet**: "Learnings (23), Patterns (8), Decisions (5)"
2. **Remember last search context**: User shouldn't re-enter filters each time
3. **Quick filters as buttons**: "Show only active" toggle for common cases
4. **Full-text search across all types**: Search content, not just titles
5. **Preserve scroll position**: Use History API pattern from browser UX

### Search vs. Browse

Users will:
- **Browse** for recent items (< 1 week old)
- **Search** for specific remembered items ("that auth pattern")
- **Filter** when exploring ("what patterns do I have?")

Design should support all three, with browse as the default landing experience.

---

## 7. VS Code Extension UX Constraints

### Sidebar Patterns

From VS Code's UX guidelines:
- Use one View Container for most extensions
- 3-5 views is comfortable max
- Don't add content that could be a simple command
- Tree views work well for hierarchical data
- Webviews for custom visualization (use sparingly)

### Recommended View Structure

```
MEMORY (View Container)
├── Current Context (View) - Primary
│   ├── Active session summary
│   ├── Loaded learnings
│   └── Recent files/tasks
├── History (View) - Secondary
│   ├── Timeline grouped by day
│   └── Expandable session cards
├── Knowledge (View) - Secondary
│   ├── Learnings list
│   ├── Patterns list
│   └── Decisions list
└── [Search triggered via command palette]
```

### Panel vs. Sidebar

- **Sidebar**: For persistent, glanceable information
- **Panel**: For detailed exploration, logs, or search results

Recommendation: Primary in sidebar, detailed session viewer in panel.

---

## 8. Design Patterns from Existing Tools

### From Obsidian
- **Bidirectional linking**: Show what's connected to what
- **Graph view**: Visualize relationships (optional, for power users)
- **Quick switcher**: Fast search (Cmd+O) for known items
- **Local-first**: Data belongs to user, not the cloud

### From Notion
- **Breadcrumbs**: Show location in hierarchy
- **Progressive disclosure**: Collapse/expand sections
- **Database views**: Same data, different visualizations (table, board, timeline)
- **Minimal chrome**: Content takes center stage

### From Git Visualizers
- **Streamgraph**: Show activity density over time
- **Branch visualization**: Show parallel workstreams
- **Commit grouping**: Cluster related changes
- **Time-aware layout**: Recent on top, historical scrollable

### From Mem0
- **Memory status indicator**: What's active vs. stored
- **Graph visualization**: Entities and relationships
- **Clear interface**: Show what AI remembers

### From Browser History
- **Chronological default**: Most recent first
- **Search is primary access for old items**: Browse recent, search old
- **Domain grouping**: Group by site (→ group by project)
- **Clear all for privacy**: User control over data

---

## 9. Key Recommendations

### Do
1. **Default to recency**: Most recent first, always
2. **Use progressive disclosure**: Summary → Detail → Full history
3. **Show context window usage**: Users want to know capacity
4. **Aggregate similar items**: "Modified 5 files" not 5 entries
5. **Support multiple access patterns**: Browse, search, filter
6. **Keep primary view simple**: 3-5 key metrics max
7. **Design for VS Code constraints**: Limited sidebar space
8. **Let patterns emerge**: Don't force categorization before capture

### Don't
1. **Don't expose technical details**: No UUIDs, JSON, vectors
2. **Don't require organization upfront**: Capture first, organize later
3. **Don't show flat chronological lists**: Aggregate and group
4. **Don't hide search**: It's the primary access for older items
5. **Don't make every view equally prominent**: Hierarchy matters
6. **Don't forget mobile-like constraints**: Sidebar is narrow

---

## 10. Open Questions for User Testing

1. Do users want to see exactly what's "in context" right now?
2. How often do users edit/delete learnings vs. just browse?
3. Is project-based grouping more useful than time-based?
4. Do users want memory visualization or just memory access?
5. How much detail do users want in session summaries?

---

## Sources

### Note-Taking & PKM
- [Obsidian](https://obsidian.md/) - Bidirectional linking, graph view, non-prescriptive organization
- [Why Every UI/UX Designer Should Use Obsidian](https://medium.com/@g.r.tanny/why-every-ui-ux-designer-should-use-obsidian-for-knowledge-management-7f6402d3e2e4)
- [Notion UX Review](https://adamfard.com/blog/notion-ux-review) - Breadcrumbs, progressive disclosure
- [Building a Second Brain](https://fortelabs.com/blog/basboverview/) - CODE methodology, PARA hierarchy
- [Best Second Brain Apps 2026](https://buildin.ai/blog/best-second-brain-apps)

### Browser History & Timeline
- [Recently Viewed UI Pattern](https://www.creativebloq.com/ux/ui-design-pattern-tips-recently-viewed-101413262)
- [History Design Examples](https://nicelydone.club/pages/history) - 194 history page designs
- [Timeline UI Best Practices](https://www.uinkits.com/blog-post/timeline-what-is-timeline-in-ui-design-and-how-to-use-it)

### Git Visualization
- [Git In Practice - History Visualization](https://livebook.manning.com/book/git-in-practice/chapter-4)
- [Githru Research Paper](https://arxiv.org/pdf/2009.03115) - Visual analytics for development history
- [Visualizing Git](https://git-school.github.io/visualizing-git/) - Interactive DAG visualization

### AI Memory Tools
- [Mem0](https://mem0.ai/) - Universal memory layer, graph visualization
- [ContextForge](https://dev.to/alfredoizjr/import-your-ai-memory-into-contextforge-claude-code-chatgpt-and-knowledge-graph-5615) - Memory import and knowledge graph
- [AI Memory vs Context Understanding](https://www.sphereinc.com/blogs/ai-memory-and-context/)
- [Context Engineering for AI UX](https://medium.com/design-bootcamp/context-engineering-is-reimagining-ux-for-ai-e5baa3d474d3)

### UX Patterns
- [Progressive Disclosure - NN/G](https://www.nngroup.com/articles/progressive-disclosure/)
- [Information Density and Progressive Disclosure](https://www.algolia.com/blog/ux/information-density-and-progressive-disclosure-search-ux)
- [Activity Feed Design](https://getstream.io/blog/activity-feed-design/)
- [Faceted Search Best Practices](https://www.algolia.com/blog/ux/faceted-search-and-navigation)

### VS Code Extension Design
- [VS Code Sidebar Guidelines](https://code.visualstudio.com/api/ux-guidelines/sidebars)
- [VS Code Views Guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
- [VS Code Panel Guidelines](https://code.visualstudio.com/api/ux-guidelines/panel)

### Mental Models & IA
- [Mental Model for Information Architecture](https://medium.com/@yitingli_49802/mental-model-your-golden-compass-for-information-architecture-design-cab09e0379a0)
- [The Information Architecture Essentials](https://sruram.medium.com/the-information-architecture-essentials-user-mind-mind-mental-models-533841214f37)
- [PKM at Scale Analysis](https://www.dsebastien.net/personal-knowledge-management-at-scale-analyzing-8-000-notes-and-64-000-links/)
