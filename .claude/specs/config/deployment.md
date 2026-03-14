# Deployment

## Platform

**Type:** VS Code Extension
**Distribution:**
- VS Code Marketplace (primary)
- Open VSX Registry (for VSCodium, other forks)
- Direct .vsix install (universal fallback)

## Build & Package

```bash
# Build extension
pnpm build

# Create .vsix package
pnpm package
# Output: voir-{version}.vsix
```

## Publishing

### VS Code Marketplace

Requires:
- Microsoft Azure DevOps organization
- Personal Access Token (PAT) with Marketplace scope
- Publisher account (luisladino)

```bash
# First time: login
vsce login luisladino

# Publish
pnpm publish
# or
vsce publish
```

### Open VSX Registry

Requires:
- Eclipse Foundation account
- Open VSX access token

```bash
# Publish to Open VSX
npx ovsx publish -p $OPENVSX_TOKEN
```

### Direct Install

For users who can't access marketplaces:

```bash
# User installs from .vsix
code --install-extension voir-0.1.0.vsix
```

## Version Management

Update version in `package.json`:

```bash
# Patch (0.1.0 -> 0.1.1)
npm version patch

# Minor (0.1.0 -> 0.2.0)
npm version minor

# Major (0.1.0 -> 1.0.0)
npm version major
```

## Pre-Publish Checklist

1. [ ] All tests pass (`pnpm test`)
2. [ ] Type check passes (`pnpm type-check`)
3. [ ] Lint passes (`pnpm lint`)
4. [ ] Build succeeds (`pnpm build`)
5. [ ] Version bumped in `package.json`
6. [ ] CHANGELOG updated
7. [ ] README accurate
8. [ ] Package creates successfully (`pnpm package`)

## CI/CD

Future: GitHub Actions workflow

```yaml
# .github/workflows/publish.yml
on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test
      - run: pnpm build
      - run: vsce publish
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

## Compatibility

**VS Code Version:** ^1.105.0 (engine constraint in package.json)

**Tested On:**
- VS Code (official)
- Antigravity IDE (development environment)

**Should Work On:**
- Cursor
- Windsurf
- VSCodium
- Any VS Code fork using standard Extension API

## Rollback

If a version has issues:

```bash
# Unpublish specific version (within 24h)
vsce unpublish luisladino.voir@0.1.1

# Or publish a patch fix
npm version patch
vsce publish
```

## Notes

- Extension is bundled with esbuild (single file output)
- No runtime dependencies shipped (devDependencies only)
- `@vscode/webview-ui-toolkit` is bundled into output
