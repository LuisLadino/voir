/**
 * Event Types
 *
 * Types representing events captured during Claude Code sessions.
 */

/**
 * Base event type for all session events.
 */
export interface BaseEvent {
  /** Event unique identifier */
  id: string;

  /** Event timestamp (ISO 8601) */
  timestamp: string;

  /** Session this event belongs to */
  sessionId: string;
}

/**
 * Tool call event - when Claude Code invokes a tool.
 */
export interface ToolCallEvent extends BaseEvent {
  type: 'tool_call';

  /** Tool name (e.g., 'Edit', 'Bash', 'Read', 'Write', 'Glob', 'Grep') */
  tool: string;

  /** Tool input parameters */
  input: Record<string, unknown>;

  /** Tool output (if completed) */
  output?: string;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Whether the call succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Message event - user or assistant message.
 */
export interface MessageEvent extends BaseEvent {
  type: 'message';

  /** Message role */
  role: 'user' | 'assistant';

  /** Message content (may be truncated) */
  content: string;

  /** Token count for this message */
  tokens?: number;
}

/**
 * File change event - when a file is modified.
 */
export interface FileChangeEvent extends BaseEvent {
  type: 'file_change';

  /** File path relative to workspace */
  path: string;

  /** Type of change */
  changeType: 'created' | 'modified' | 'deleted';

  /** Tool that caused the change */
  causedBy?: string;
}

/**
 * Union type of all events.
 */
export type SessionEvent = ToolCallEvent | MessageEvent | FileChangeEvent;

/**
 * Type guard for ToolCallEvent.
 */
export function isToolCallEvent(event: SessionEvent): event is ToolCallEvent {
  return event.type === 'tool_call';
}

/**
 * Type guard for MessageEvent.
 */
export function isMessageEvent(event: SessionEvent): event is MessageEvent {
  return event.type === 'message';
}

/**
 * Type guard for FileChangeEvent.
 */
export function isFileChangeEvent(event: SessionEvent): event is FileChangeEvent {
  return event.type === 'file_change';
}
