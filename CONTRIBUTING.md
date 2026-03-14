# Contributing to VOIR

Thank you for your interest in contributing to VOIR.

## Development Setup

### Prerequisites
- Node.js 18+
- pnpm 8+
- VS Code 1.105+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/LuisLadino/voir.git
cd voir

# Install dependencies
pnpm install

# Run type checking
pnpm type-check

# Run tests
pnpm test

# Build the extension
pnpm build
```

### Development Workflow

1. **Press F5** in VS Code to launch the Extension Development Host
2. Make changes to source files
3. **Cmd+Shift+F5** to reload the extension

## Project Structure

```
voir/
├── src/                    # Source code
│   ├── extension.ts        # Entry point
│   ├── types/              # TypeScript types
│   ├── core/               # Four Pillars (Profile, Memory, Context, Patterns)
│   ├── capture/            # AI tool adapters and injection
│   ├── analysis/           # Effectiveness analysis
│   └── views/              # VS Code UI (trees, webviews)
├── test/                   # Tests
├── docs/                   # Documentation
│   └── research/           # Research and analysis
└── .claude/specs/          # Architecture specs
```

## Code Style

- TypeScript with strict mode
- Prettier for formatting
- ESLint for linting

Run before committing:
```bash
pnpm lint
pnpm typecheck
```

## Commit Messages

Use conventional commits:
```
feat: add profile pillar to core module
fix: correct workspace hash generation
docs: update architecture decisions
refactor: simplify adapter interface
test: add memory pillar unit tests
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass: `pnpm test`
4. Ensure types check: `pnpm type-check`
5. **Update documentation** (see below)
6. Submit PR with clear description

## Documentation Requirements

Every PR should update relevant docs:

| Change Type | CHANGELOG | README | Specs |
|-------------|-----------|--------|-------|
| New feature | Yes | If usage changes | If architecture changes |
| Bug fix | Yes | No | No |
| Refactor | No | No | If structure changes |
| Breaking change | Yes + note | Yes | Yes |

**CHANGELOG.md format:**
```markdown
## [Unreleased]

### Added
- Description of new feature

### Fixed
- Description of bug fix
```

## Architecture Decisions

Major decisions are documented in `.claude/specs/architecture/decisions.md`.

If your contribution involves an architectural change:
1. Discuss in an issue first
2. Document the decision using the ADR format
3. Update relevant specs

## Questions?

Open an issue or start a discussion.
