# Version Control

## Branch Strategy

```
main              # Production / stable
feature/*         # New features (e.g., feature/dashboard-view)
fix/*             # Bug fixes (e.g., fix/session-parsing)
```

## Commit Format

```
type: description

Types: feat, fix, docs, style, refactor, test, chore
```

Examples:
- `feat: add session tree view`
- `fix: resolve brain file parsing error`
- `docs: update README with usage instructions`
- `refactor: extract metrics calculation to separate module`
- `test: add unit tests for type guards`
- `chore: update dependencies`

## Pull Requests

- Branch from: `main`
- Merge to: `main`
- Require: passing tests, lint check

### PR Template

```markdown
## Summary
[Brief description of changes]

## Changes
- [Change 1]
- [Change 2]

## Testing
- [ ] Tests pass
- [ ] Manually tested in Extension Development Host

## Documentation
- [ ] CHANGELOG.md updated (if user-facing change)
- [ ] README.md updated (if usage changes)
- [ ] Architecture specs updated (if structure changes)
```

## Git Workflow

```bash
# Start new feature
git checkout -b feature/my-feature

# Make changes, commit
git add .
git commit -m "feat: add my feature"

# Push and create PR
git push -u origin feature/my-feature
```

## Quality Gates (Pre-commit)

Before committing, ensure:
1. `pnpm lint` passes
2. `pnpm type-check` passes
3. `pnpm test` passes
4. `pnpm build` succeeds

## Documentation Requirements

**CHANGELOG.md** - Update for every meaningful change:

| Change Type | CHANGELOG Section | Required? |
|-------------|-------------------|-----------|
| New feature (`feat:`) | Added | Yes |
| Bug fix (`fix:`) | Fixed | Yes |
| Breaking change | Changed + note | Yes |
| Refactor (`refactor:`) | - | No (internal) |
| Tests (`test:`) | - | No (internal) |
| Chore (`chore:`) | - | No (internal) |
| Docs (`docs:`) | - | No (unless major) |

**Format:** Add under `[Unreleased]` section:
```markdown
## [Unreleased]

### Added
- Four Pillars data model for persistent context

### Fixed
- Session parsing error when brain directory missing
```

**README.md** - Update when:
- New user-facing feature added
- Installation/usage instructions change
- New commands or settings added

**Architecture specs** - Update when:
- New architectural decisions made
- Module structure changes
- New dependencies with architectural impact

### Documentation Checklist (for PRs)

```markdown
## Documentation
- [ ] CHANGELOG.md updated (if user-facing change)
- [ ] README.md updated (if usage changes)
- [ ] Architecture specs updated (if structure changes)
- [ ] Code comments added (for complex logic)
```

## Ignored Files

See `.gitignore`:
- `node_modules/` - dependencies
- `dist/` - build output
- `*.vsix` - packaged extension
- `.env*` - environment files
- `coverage/` - test coverage
