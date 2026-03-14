# Environment

## Requirements

- Node.js: 20.x LTS
- Package manager: pnpm
- IDE: VS Code / Antigravity IDE (VS Code fork)

## Setup

```bash
# Install dependencies
pnpm install

# Start development (watch mode)
pnpm dev

# Run tests
pnpm test

# Build extension
pnpm build
```

## Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Watch mode - rebuild on changes |
| `build` | Bundle extension with esbuild |
| `test` | Run Vitest tests |
| `test:watch` | Run tests in watch mode |
| `test:coverage` | Run tests with coverage |
| `lint` | Check code with ESLint |
| `format` | Format code with Prettier |
| `type-check` | TypeScript type checking |
| `package` | Create .vsix file |
| `publish` | Publish to VS Code Marketplace |

## Environment Variables

### Development

None required for local development.

### Publishing (CI only)

| Variable | Purpose |
|----------|---------|
| `VSCE_PAT` | VS Code Marketplace personal access token |
| `OPENVSX_TOKEN` | Open VSX Registry token |

## Editor

**Recommended:** VS Code or any VS Code fork

**Extensions:**
- ESLint
- Prettier
- TypeScript

## Debugging

Press F5 in VS Code to launch Extension Development Host with debugger attached.

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

## Data Sources

VOIR reads session data from:

| Source | Path |
|--------|------|
| Brain files | `~/.gemini/antigravity/brain/{uuid}/` |
| Claude JSONL | `~/.claude/` |
