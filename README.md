# VOIR

**Visual Observability for Intelligent Runtimes**

A VS Code extension that gives developers complete visibility and control over their AI coding assistant interactions.

## Status

**In Development** - Architecture defined, implementation starting.

## The Problem

Developers using AI coding assistants have no visibility into what's happening:
- What did the AI actually do?
- Is it following my standards?
- Is it actually helping me?
- Why did it make that mistake?

Existing tools (Copilot Memory, Windsurf Memories) are locked to their platforms. Nothing works across all your AI tools.

## What VOIR Does

| Capability | Description |
|------------|-------------|
| **Session Capture** | Record what the LLM does - tool calls, file changes, decisions |
| **Visualization** | Tree views, dashboard, timelines showing behavior |
| **Effectiveness Analysis** | Metrics and patterns answering "Is AI helping?" |
| **Compliance/Governance** | Define rules, enforce standards, see compliance status |
| **Four Pillars** | Persistent Profile, Memory, Context, and Patterns |
| **Cross-tool Support** | Works with Claude Code, Copilot, Cursor, Windsurf |

## Key Principles

- **Local-first** - All data stays on your machine
- **Developer-native** - Integrated into VS Code
- **Transparent** - See what the AI is doing, not a black box

## Documentation

- [Project Brief](.claude/specs/project-brief.md) - What we're building and why
- [Architecture Decisions](.claude/specs/architecture/decisions.md) - Key technical choices
- [Project Structure](.claude/specs/architecture/project-structure.md) - Codebase organization
- [Design System](.claude/specs/design/design-system.md) - Visual design decisions
- [Research](docs/research/) - Market research and competitive analysis

## Development

Project uses the [Claude Dev Framework](https://github.com/luisladino/claude-dev-framework).

```bash
# After implementation begins:
pnpm install
pnpm dev     # Watch mode
pnpm test    # Run tests
pnpm build   # Build extension
```

## License

MIT
