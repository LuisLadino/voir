/**
 * Session Types
 *
 * Types representing Claude Code session data.
 */

/**
 * Represents a Claude Code session.
 */
export interface Session {
  /** Unique session identifier */
  id: string;

  /** Session start timestamp (ISO 8601) */
  startTime: string;

  /** Session end timestamp (ISO 8601), undefined if in progress */
  endTime?: string;

  /** Workspace path where session occurred */
  workspacePath: string;

  /** Total input tokens used */
  inputTokens: number;

  /** Total output tokens used */
  outputTokens: number;

  /** Tool calls made during session */
  toolCalls: ToolCallSummary[];

  /** Files modified during session */
  filesModified: FileChange[];

  /** Session status */
  status: SessionStatus;
}

export type SessionStatus = 'in_progress' | 'completed' | 'error';

/**
 * Summary of a tool call within a session.
 */
export interface ToolCallSummary {
  /** Tool name (e.g., 'Edit', 'Bash', 'Read') */
  tool: string;

  /** Number of times this tool was called */
  count: number;

  /** Whether any calls failed */
  hadFailures: boolean;
}

/**
 * Represents a file change during a session.
 */
export interface FileChange {
  /** File path relative to workspace */
  path: string;

  /** Type of change */
  changeType: 'created' | 'modified' | 'deleted';

  /** Timestamp of change (ISO 8601) */
  timestamp: string;
}

/**
 * Session metrics for analytics.
 */
export interface SessionMetrics {
  /** Total duration in milliseconds */
  durationMs: number;

  /** Total tokens (input + output) */
  totalTokens: number;

  /** Tokens per minute rate */
  tokensPerMinute: number;

  /** Number of tool calls */
  toolCallCount: number;

  /** Number of files modified */
  filesModifiedCount: number;

  /** Tool failure rate (0-1) */
  failureRate: number;
}
