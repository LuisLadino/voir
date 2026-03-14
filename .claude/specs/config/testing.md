# Testing

## Framework

**Test Runner:** Vitest 3.x
**Environment:** Node.js (not jsdom - extension runs in Node)
**Coverage:** V8 provider

## Structure

```
test/
├── unit/           # Unit tests - isolated, fast
├── integration/    # Integration tests - multiple modules
└── fixtures/       # Test data (sessions, events)
```

## Commands

```bash
pnpm test              # Run all tests once
pnpm test:watch        # Watch mode (re-run on changes)
pnpm test:coverage     # Generate coverage report
```

## Coverage

**Target:** 80%+ on business logic

**Focus on:**
- Data parsing (`src/data/`)
- Metrics calculation (`src/analysis/`)
- Type guards (`src/types/`)
- Utility functions (`src/utils/`)

**Skip:**
- Type definitions (no runtime code)
- VS Code integration layer (mocked boundary)
- Config files

## VS Code Mocking

The `vscode` module doesn't exist at test runtime. Vitest config includes a virtual module plugin:

```typescript
// vitest.config.ts
plugins: [{
  name: 'virtual-vscode',
  resolveId(id) { if (id === 'vscode') return 'vscode'; },
  load(id) { if (id === 'vscode') return 'export default {}'; },
}]
```

Mock specific APIs in tests:

```typescript
vi.mock('vscode', () => ({
  window: { showInformationMessage: vi.fn() },
  workspace: { fs: { readFile: vi.fn() } },
  // ...
}));
```

## Patterns

### AAA Pattern

```typescript
it('should calculate session duration', () => {
  // Arrange
  const session = createTestSession({ duration: 3600000 });

  // Act
  const metrics = calculateMetrics(session);

  // Assert
  expect(metrics.durationMs).toBe(3600000);
});
```

### Fixtures

Use shared test data from `test/fixtures/`:

```typescript
import { validSession, inProgressSession } from '../fixtures/sessions';

it('should handle completed sessions', () => {
  const result = processSession(validSession);
  expect(result.status).toBe('completed');
});
```

## What to Test

| Layer | What | How |
|-------|------|-----|
| Types | Type guards | Unit tests |
| Data | Parsing, transformation | Unit tests with fixtures |
| Analysis | Metrics, patterns | Unit tests |
| Views | TreeItem creation | Unit tests (mock VS Code) |
| Integration | Full data flow | Integration tests |

## Anti-Patterns

- Don't test VS Code API behavior (mock boundary)
- Don't test implementation details (test behavior)
- Don't use timing-dependent assertions
- Don't mock everything - test real logic
