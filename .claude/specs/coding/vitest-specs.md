# Vitest Specs

Source: https://vitest.dev/

## Configuration

Vitest is configured in `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
    },
  },
});
```

## Test Structure

### Directory Layout

```
test/
├── unit/           # Unit tests (isolated, fast)
├── integration/    # Integration tests (multiple modules)
└── fixtures/       # Test data
```

### File Naming

- Test files: `*.test.ts` or `*.spec.ts`
- Colocate with source or in `test/` directory

### Test Organization

Use `describe` blocks to group related tests:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('SessionStore', () => {
  describe('loadSession', () => {
    it('should load session from valid JSON', () => {
      // ...
    });

    it('should return null for invalid JSON', () => {
      // ...
    });
  });
});
```

## Mocking VS Code

VS Code module doesn't exist at test runtime. Use virtual module mocking:

### vitest.config.ts Plugin

```typescript
plugins: [
  {
    name: 'virtual-vscode',
    resolveId(id) {
      if (id === 'vscode') return 'vscode';
    },
    load(id) {
      if (id === 'vscode') return 'export default {}';
    },
  },
],
```

### Mock in Tests

```typescript
import { vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(),
    showInformationMessage: vi.fn(),
    createWebviewPanel: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn(),
  },
  workspace: {
    fs: {
      readFile: vi.fn(),
    },
  },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
    joinPath: (...parts: string[]) => ({ fsPath: parts.join('/') }),
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
}));
```

## Test Patterns

### AAA Pattern

Structure tests with Arrange-Act-Assert:

```typescript
it('should calculate session duration', () => {
  // Arrange
  const session: Session = {
    id: 'test-1',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-01T01:30:00Z',
    // ...
  };

  // Act
  const metrics = calculateMetrics(session);

  // Assert
  expect(metrics.durationMs).toBe(5400000); // 1.5 hours
});
```

### Testing Type Guards

```typescript
describe('isToolCallEvent', () => {
  it('returns true for tool call events', () => {
    const event: ToolCallEvent = {
      type: 'tool_call',
      tool: 'Edit',
      // ...
    };
    expect(isToolCallEvent(event)).toBe(true);
  });

  it('returns false for other event types', () => {
    const event: MessageEvent = {
      type: 'message',
      // ...
    };
    expect(isToolCallEvent(event)).toBe(false);
  });
});
```

### Testing Async Code

```typescript
it('should load session data', async () => {
  const mockData = JSON.stringify({ id: 'test' });
  vi.mocked(fs.readFile).mockResolvedValue(Buffer.from(mockData));

  const session = await loadSession('test');

  expect(session).toEqual({ id: 'test' });
});
```

### Snapshot Testing

Use for complex output that should remain stable:

```typescript
it('should format session summary', () => {
  const summary = formatSessionSummary(session);
  expect(summary).toMatchSnapshot();
});
```

## Fixtures

Create test fixtures in `test/fixtures/`:

```typescript
// test/fixtures/sessions.ts
export const validSession: Session = {
  id: 'test-session-1',
  startTime: '2024-01-01T00:00:00Z',
  endTime: '2024-01-01T01:00:00Z',
  workspacePath: '/test/workspace',
  inputTokens: 1000,
  outputTokens: 500,
  toolCalls: [],
  filesModified: [],
  status: 'completed',
};

export const inProgressSession: Session = {
  ...validSession,
  id: 'test-session-2',
  endTime: undefined,
  status: 'in_progress',
};
```

## Commands

```bash
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage report
```

## Coverage

Target: 80%+ coverage on business logic

Focus on:
- Data parsing/transformation
- Metrics calculation
- Type guards
- Error handling

Skip:
- Type definitions
- VS Code integration (mock boundaries)
- Config files

## Anti-Patterns

### Don't Test Implementation Details

```typescript
// Bad - tests internal state
expect(store._cache.size).toBe(1);

// Good - tests behavior
expect(store.getSession('id')).toBeDefined();
```

### Don't Mock Everything

Test real logic, mock only boundaries (file system, VS Code API):

```typescript
// Good - real logic, mocked I/O
vi.mocked(fs.readFile).mockResolvedValue(testData);
const result = parseSession(await loadFile(path));
expect(result.id).toBe('test');
```

### Don't Write Flaky Tests

Avoid timing-dependent tests:

```typescript
// Bad - timing dependent
await new Promise(r => setTimeout(r, 100));
expect(result).toBeDefined();

// Good - await the actual operation
const result = await waitForCondition(() => store.isReady);
expect(result).toBe(true);
```
