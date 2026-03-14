import { describe, it, expect } from 'vitest';
import {
  isToolCallEvent,
  isMessageEvent,
  isFileChangeEvent,
  type SessionEvent,
  type ToolCallEvent,
  type MessageEvent,
  type FileChangeEvent,
} from '../../src/types';

describe('Event Type Guards', () => {
  const baseEvent = {
    id: 'test-1',
    timestamp: '2024-01-01T00:00:00Z',
    sessionId: 'session-1',
  };

  describe('isToolCallEvent', () => {
    it('returns true for tool call events', () => {
      const event: ToolCallEvent = {
        ...baseEvent,
        type: 'tool_call',
        tool: 'Edit',
        input: { file_path: '/test.ts' },
        success: true,
      };
      expect(isToolCallEvent(event)).toBe(true);
    });

    it('returns false for non-tool-call events', () => {
      const event: MessageEvent = {
        ...baseEvent,
        type: 'message',
        role: 'user',
        content: 'Hello',
      };
      expect(isToolCallEvent(event)).toBe(false);
    });
  });

  describe('isMessageEvent', () => {
    it('returns true for message events', () => {
      const event: MessageEvent = {
        ...baseEvent,
        type: 'message',
        role: 'assistant',
        content: 'Response',
      };
      expect(isMessageEvent(event)).toBe(true);
    });

    it('returns false for non-message events', () => {
      const event: FileChangeEvent = {
        ...baseEvent,
        type: 'file_change',
        path: '/test.ts',
        changeType: 'modified',
      };
      expect(isMessageEvent(event)).toBe(false);
    });
  });

  describe('isFileChangeEvent', () => {
    it('returns true for file change events', () => {
      const event: FileChangeEvent = {
        ...baseEvent,
        type: 'file_change',
        path: '/test.ts',
        changeType: 'created',
      };
      expect(isFileChangeEvent(event)).toBe(true);
    });

    it('returns false for non-file-change events', () => {
      const event: ToolCallEvent = {
        ...baseEvent,
        type: 'tool_call',
        tool: 'Read',
        input: {},
        success: true,
      };
      expect(isFileChangeEvent(event)).toBe(false);
    });
  });
});
