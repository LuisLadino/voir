# TypeScript Specs

Source: https://www.typescriptlang.org/docs/handbook/

## Compiler Configuration

This project uses strict TypeScript. The following strict options are enabled in `tsconfig.json`:

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  "exactOptionalPropertyTypes": true,
  "noUncheckedIndexedAccess": true
}
```

## Module System

- **Module:** `Node16` - Modern Node.js ESM/CJS resolution
- **Module Resolution:** `Node16` - Respects package.json exports
- **Target:** `ES2022` - Modern JavaScript features

## Type Patterns

### Interface vs Type

Use **interfaces** for object shapes that may be extended:

```typescript
export interface Session {
  id: string;
  startTime: string;
  endTime?: string;
}
```

Use **types** for unions, intersections, and computed types:

```typescript
export type SessionStatus = 'in_progress' | 'completed' | 'error';
export type SessionEvent = ToolCallEvent | MessageEvent | FileChangeEvent;
```

### Optional Properties

With `exactOptionalPropertyTypes`, optional properties must be explicitly undefined or omitted:

```typescript
interface Config {
  timeout?: number; // Can be number or omitted, NOT undefined
}

// Correct
const config: Config = {}; // omitted
const config2: Config = { timeout: 5000 }; // number

// Error with exactOptionalPropertyTypes
const config3: Config = { timeout: undefined }; // Error!
```

### Index Access Safety

With `noUncheckedIndexedAccess`, array/object index access returns `T | undefined`:

```typescript
const items: string[] = ['a', 'b'];
const first = items[0]; // Type: string | undefined

// Must check before use
if (first !== undefined) {
  console.log(first.toUpperCase()); // OK
}
```

## Function Patterns

### Explicit Return Types (Public APIs)

Always specify return types for exported functions:

```typescript
// Good - explicit return type
export function parseSession(data: unknown): Session | null {
  // ...
}

// Bad - inferred return type for public API
export function parseSession(data: unknown) {
  // ...
}
```

### Type Guards

Use type guard functions for runtime type narrowing:

```typescript
export function isToolCallEvent(event: SessionEvent): event is ToolCallEvent {
  return event.type === 'tool_call';
}
```

### Async Functions

Always handle errors explicitly. Prefer explicit Promise types:

```typescript
export async function loadSession(id: string): Promise<Session | null> {
  try {
    const data = await readFile(path);
    return parseSession(data);
  } catch (error) {
    console.error('Failed to load session:', error);
    return null;
  }
}
```

## Import/Export Patterns

### Explicit Exports

Use named exports, not default exports:

```typescript
// Good
export function parseSession() {}
export interface Session {}

// Avoid
export default function parseSession() {}
```

### Type-Only Imports

Use `type` keyword for type-only imports to avoid runtime overhead:

```typescript
import type { Session, SessionEvent } from './types';
import { parseSession } from './parser';
```

### Barrel Files

Use `index.ts` for module exports:

```typescript
// src/types/index.ts
export * from './session';
export * from './events';
```

## Anti-Patterns

### Never Use `any`

Use `unknown` for truly unknown types, then narrow:

```typescript
// Bad
function parse(data: any): Session { ... }

// Good
function parse(data: unknown): Session | null {
  if (!isValidSessionData(data)) return null;
  return data as Session;
}
```

### Never Ignore Errors

Always handle or explicitly rethrow:

```typescript
// Bad
try { ... } catch (e) {}

// Good
try { ... } catch (error) {
  console.error('Operation failed:', error);
  throw error; // or handle appropriately
}
```

### Avoid Type Assertions

Prefer type guards over assertions:

```typescript
// Bad
const session = data as Session;

// Good
if (isSession(data)) {
  const session = data; // Typed as Session
}
```
