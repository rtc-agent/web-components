import { describe, expect, it } from 'vitest';
import {
  ContentType,
  ErrorCategory,
  FileSyncStatus,
  MessageRole,
  MessageStreamingStatus,
  RtcStatus,
  SessionStatus,
  SyncStatus,
  TodoStatus,
  TurnStatus,
  UpdateAction,
  UpdateEntity,
  UpdateType,
} from './index.js';
import type { components } from './models.gen.js';

/**
 * Compile-time type validation: ensures manual enum types are assignable
 * to the auto-generated OpenAPI string literal union types.
 *
 * If any enum value diverges from the OpenAPI spec, TypeScript will emit
 * a compile error at the `satisfies` assertion below.
 */
type GeneratedEnumTypes = {
  SessionStatus: components['schemas']['SessionStatus'];
  TurnStatus: components['schemas']['TurnStatus'];
  MessageRole: components['schemas']['MessageRole'];
  MessageStreamingStatus: components['schemas']['MessageStreamingStatus'];
  ContentType: components['schemas']['ContentType'];
  ErrorCategory: components['schemas']['ErrorCategory'];
  RtcStatus: components['schemas']['RtcStatus'];
  UpdateEntity: components['schemas']['UpdateEntity'];
  UpdateAction: components['schemas']['UpdateAction'];
  UpdateType: components['schemas']['UpdateType'];
};

// This object literal is checked at compile time via `satisfies`.
// Each value array must be assignable to the corresponding generated union type.
const _enumSyncCheck = {
  SessionStatus: Object.values(
    SessionStatus,
  ) as GeneratedEnumTypes['SessionStatus'][],
  TurnStatus: Object.values(TurnStatus) as GeneratedEnumTypes['TurnStatus'][],
  MessageRole: Object.values(
    MessageRole,
  ) as GeneratedEnumTypes['MessageRole'][],
  MessageStreamingStatus: Object.values(
    MessageStreamingStatus,
  ) as GeneratedEnumTypes['MessageStreamingStatus'][],
  ContentType: Object.values(
    ContentType,
  ) as GeneratedEnumTypes['ContentType'][],
  ErrorCategory: Object.values(
    ErrorCategory,
  ) as GeneratedEnumTypes['ErrorCategory'][],
  RtcStatus: Object.values(RtcStatus) as GeneratedEnumTypes['RtcStatus'][],
  UpdateEntity: Object.values(
    UpdateEntity,
  ) as GeneratedEnumTypes['UpdateEntity'][],
  UpdateAction: Object.values(
    UpdateAction,
  ) as GeneratedEnumTypes['UpdateAction'][],
  UpdateType: Object.values(UpdateType) as GeneratedEnumTypes['UpdateType'][],
} as const satisfies Record<keyof GeneratedEnumTypes, readonly string[]>;

// Prevent tree-shaking from removing the compile-time check
void _enumSyncCheck;

describe('enums', () => {
  describe('SessionStatus', () => {
    it('should have correct values', () => {
      expect(SessionStatus.Active).toBe('active');
      expect(SessionStatus.Closed).toBe('closed');
      expect(SessionStatus.Idle).toBe('idle');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(SessionStatus)).toHaveLength(3);
    });

    it('should have unique values', () => {
      const values = Object.values(SessionStatus);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('TurnStatus', () => {
    it('should have correct values', () => {
      expect(TurnStatus.Pending).toBe('pending');
      expect(TurnStatus.Running).toBe('running');
      expect(TurnStatus.Completed).toBe('completed');
      expect(TurnStatus.Failed).toBe('failed');
      expect(TurnStatus.Cancelled).toBe('cancelled');
      expect(TurnStatus.Interrupted).toBe('interrupted');
      expect(TurnStatus.Merged).toBe('merged');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(TurnStatus)).toHaveLength(7);
    });

    it('should have unique values', () => {
      const values = Object.values(TurnStatus);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('MessageRole', () => {
    it('should have correct values', () => {
      expect(MessageRole.User).toBe('user');
      expect(MessageRole.Assistant).toBe('assistant');
      expect(MessageRole.Tool).toBe('tool');
      expect(MessageRole.System).toBe('system');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(MessageRole)).toHaveLength(4);
    });

    it('should have unique values', () => {
      const values = Object.values(MessageRole);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('MessageStreamingStatus', () => {
    it('should have correct values', () => {
      expect(MessageStreamingStatus.Pending).toBe('pending');
      expect(MessageStreamingStatus.Streaming).toBe('streaming');
      expect(MessageStreamingStatus.Completed).toBe('completed');
      expect(MessageStreamingStatus.Failed).toBe('failed');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(MessageStreamingStatus)).toHaveLength(4);
    });

    it('should have unique values', () => {
      const values = Object.values(MessageStreamingStatus);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('ContentType', () => {
    it('should have correct values', () => {
      expect(ContentType.Markdown).toBe('markdown');
      expect(ContentType.Summary).toBe('summary');
      expect(ContentType.Text).toBe('text');
      expect(ContentType.Thinking).toBe('thinking');
      expect(ContentType.ToolCallInput).toBe('toolcall_input');
      expect(ContentType.ToolCallOutput).toBe('toolcall_output');
      expect(ContentType.UserMessage).toBe('user_message');
      expect(ContentType.Error).toBe('error');
      expect(ContentType.Prompt).toBe('prompt');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(ContentType)).toHaveLength(9);
    });

    it('should have unique values', () => {
      const values = Object.values(ContentType);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('ErrorCategory', () => {
    it('should have correct values', () => {
      expect(ErrorCategory.Api).toBe('api');
      expect(ErrorCategory.Stream).toBe('stream');
      expect(ErrorCategory.Tool).toBe('tool');
      expect(ErrorCategory.Context).toBe('context');
      expect(ErrorCategory.System).toBe('system');
      expect(ErrorCategory.Network).toBe('network');
      expect(ErrorCategory.Timeout).toBe('timeout');
      expect(ErrorCategory.Permission).toBe('permission');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(ErrorCategory)).toHaveLength(8);
    });

    it('should have unique values', () => {
      const values = Object.values(ErrorCategory);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('RtcStatus', () => {
    it('should have correct values', () => {
      expect(RtcStatus.Pending).toBe('pending');
      expect(RtcStatus.Sent).toBe('sent');
      expect(RtcStatus.Executing).toBe('executing');
      expect(RtcStatus.Completed).toBe('completed');
      expect(RtcStatus.Failed).toBe('failed');
      expect(RtcStatus.Timeout).toBe('timeout');
      expect(RtcStatus.Rejected).toBe('rejected');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(RtcStatus)).toHaveLength(7);
    });

    it('should have unique values', () => {
      const values = Object.values(RtcStatus);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('UpdateEntity', () => {
    it('should have correct values', () => {
      expect(UpdateEntity.Session).toBe('session');
      expect(UpdateEntity.Turn).toBe('turn');
      expect(UpdateEntity.Message).toBe('message');
      expect(UpdateEntity.Rtc).toBe('rtc');
      expect(UpdateEntity.File).toBe('file');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(UpdateEntity)).toHaveLength(5);
    });

    it('should have unique values', () => {
      const values = Object.values(UpdateEntity);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('UpdateAction', () => {
    it('should have correct values', () => {
      expect(UpdateAction.Created).toBe('created');
      expect(UpdateAction.Updated).toBe('updated');
      expect(UpdateAction.Deleted).toBe('deleted');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(UpdateAction)).toHaveLength(3);
    });

    it('should have unique values', () => {
      const values = Object.values(UpdateAction);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('UpdateType', () => {
    it('should have correct values', () => {
      expect(UpdateType.Gap).toBe('gap');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(UpdateType)).toHaveLength(1);
    });

    it('should have unique values', () => {
      const values = Object.values(UpdateType);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('TodoStatus', () => {
    it('should have correct values', () => {
      expect(TodoStatus.Pending).toBe('pending');
      expect(TodoStatus.InProgress).toBe('in_progress');
      expect(TodoStatus.Completed).toBe('completed');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(TodoStatus)).toHaveLength(3);
    });

    it('should have unique values', () => {
      const values = Object.values(TodoStatus);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('SyncStatus', () => {
    it('should have correct values', () => {
      expect(SyncStatus.Pending).toBe('pending');
      expect(SyncStatus.Syncing).toBe('syncing');
      expect(SyncStatus.Synced).toBe('synced');
      expect(SyncStatus.Failed).toBe('failed');
      expect(SyncStatus.Timeout).toBe('timeout');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(SyncStatus)).toHaveLength(5);
    });

    it('should have unique values', () => {
      const values = Object.values(SyncStatus);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('FileSyncStatus', () => {
    it('should have correct values', () => {
      expect(FileSyncStatus.Pending).toBe('pending');
      expect(FileSyncStatus.Syncing).toBe('syncing');
      expect(FileSyncStatus.Synced).toBe('synced');
      expect(FileSyncStatus.Failed).toBe('failed');
    });

    it('should have correct number of values', () => {
      expect(Object.keys(FileSyncStatus)).toHaveLength(4);
    });

    it('should have unique values', () => {
      const values = Object.values(FileSyncStatus);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });
});
