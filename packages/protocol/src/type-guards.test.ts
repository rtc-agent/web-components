import { describe, it, expect } from 'vitest';
import {
  isValidSession,
  isValidTurn,
  isValidMessage,
  isValidRtc,
  isValidContentData,
  isValidUpdateDataList,
  extractClientId,
  extractStringField,
} from './type-guards.js';

describe('type-guards', () => {
  // ── isValidSession ──

  describe('isValidSession', () => {
    it('should return true for valid Session', () => {
      const session = {
        id: 'session-1',
        status: 'active',
        owner_kind: 'user',
        owner_ref_id: 'user-123',
        created_at: '2026-10-10T00:00:00Z',
      };
      expect(isValidSession(session)).toBe(true);
    });

    it('should return true for Session with all valid statuses', () => {
      const statuses = ['active', 'closed', 'idle'] as const;
      statuses.forEach((status) => {
        const session = {
          id: 'session-1',
          status,
          owner_kind: 'user',
          owner_ref_id: 'user-123',
        };
        expect(isValidSession(session)).toBe(true);
      });
    });

    it('should return false for invalid status', () => {
      const session = {
        id: 'session-1',
        status: 'invalid_status',
        owner_kind: 'user',
        owner_ref_id: 'user-123',
      };
      expect(isValidSession(session)).toBe(false);
    });

    it('should return false for missing id', () => {
      const session = {
        status: 'active',
        owner_kind: 'user',
        owner_ref_id: 'user-123',
      };
      expect(isValidSession(session)).toBe(false);
    });

    it('should return false for missing status', () => {
      const session = {
        id: 'session-1',
        owner_kind: 'user',
        owner_ref_id: 'user-123',
      };
      expect(isValidSession(session)).toBe(false);
    });

    it('should return false for missing owner_kind', () => {
      const session = {
        id: 'session-1',
        status: 'active',
        owner_ref_id: 'user-123',
      };
      expect(isValidSession(session)).toBe(false);
    });

    it('should return false for missing owner_ref_id', () => {
      const session = {
        id: 'session-1',
        status: 'active',
        owner_kind: 'user',
      };
      expect(isValidSession(session)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidSession(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidSession(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidSession('string')).toBe(false);
      expect(isValidSession(123)).toBe(false);
      expect(isValidSession(true)).toBe(false);
    });
  });

  // ── isValidTurn ──

  describe('isValidTurn', () => {
    it('should return true for valid Turn', () => {
      const turn = {
        id: 'turn-1',
        session_id: 'session-1',
        status: 'pending',
        created_at: '2026-10-10T00:00:00Z',
      };
      expect(isValidTurn(turn)).toBe(true);
    });

    it('should return true for Turn with all valid statuses', () => {
      const statuses = [
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
        'interrupted',
        'merged',
      ] as const;
      statuses.forEach((status) => {
        const turn = {
          id: 'turn-1',
          session_id: 'session-1',
          status,
        };
        expect(isValidTurn(turn)).toBe(true);
      });
    });

    it('should return false for invalid status', () => {
      const turn = {
        id: 'turn-1',
        session_id: 'session-1',
        status: 'invalid_status',
      };
      expect(isValidTurn(turn)).toBe(false);
    });

    it('should return false for missing id', () => {
      const turn = {
        session_id: 'session-1',
        status: 'pending',
      };
      expect(isValidTurn(turn)).toBe(false);
    });

    it('should return false for missing session_id', () => {
      const turn = {
        id: 'turn-1',
        status: 'pending',
      };
      expect(isValidTurn(turn)).toBe(false);
    });

    it('should return false for missing status', () => {
      const turn = {
        id: 'turn-1',
        session_id: 'session-1',
      };
      expect(isValidTurn(turn)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidTurn(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidTurn(undefined)).toBe(false);
    });
  });

  // ── isValidMessage ──

  describe('isValidMessage', () => {
    it('should return true for valid Message', () => {
      const message = {
        id: 'message-1',
        session_id: 'session-1',
        global_offset: 0,
        role: 'user',
        streaming_status: 'pending',
        creator_kind: 'user',
        creator_ref_id: 'user-123',
        created_at: '2026-10-10T00:00:00Z',
      };
      expect(isValidMessage(message)).toBe(true);
    });

    it('should return true for Message with all valid roles', () => {
      const roles = ['user', 'assistant', 'tool', 'system'] as const;
      roles.forEach((role) => {
        const message = {
          id: 'message-1',
          session_id: 'session-1',
          global_offset: 0,
          role,
          streaming_status: 'pending',
          creator_kind: 'user',
          creator_ref_id: 'user-123',
        };
        expect(isValidMessage(message)).toBe(true);
      });
    });

    it('should return true for Message with all valid streaming statuses', () => {
      const streamingStatuses = [
        'pending',
        'streaming',
        'completed',
        'failed',
      ] as const;
      streamingStatuses.forEach((streaming_status) => {
        const message = {
          id: 'message-1',
          session_id: 'session-1',
          global_offset: 0,
          role: 'user',
          streaming_status,
          creator_kind: 'user',
          creator_ref_id: 'user-123',
        };
        expect(isValidMessage(message)).toBe(true);
      });
    });

    it('should return false for invalid role', () => {
      const message = {
        id: 'message-1',
        session_id: 'session-1',
        global_offset: 0,
        role: 'invalid_role',
        streaming_status: 'pending',
        creator_kind: 'user',
        creator_ref_id: 'user-123',
      };
      expect(isValidMessage(message)).toBe(false);
    });

    it('should return false for invalid streaming_status', () => {
      const message = {
        id: 'message-1',
        session_id: 'session-1',
        global_offset: 0,
        role: 'user',
        streaming_status: 'invalid_status',
        creator_kind: 'user',
        creator_ref_id: 'user-123',
      };
      expect(isValidMessage(message)).toBe(false);
    });

    it('should return false for missing id', () => {
      const message = {
        session_id: 'session-1',
        global_offset: 0,
        role: 'user',
        streaming_status: 'pending',
        creator_kind: 'user',
        creator_ref_id: 'user-123',
      };
      expect(isValidMessage(message)).toBe(false);
    });

    it('should return false for missing global_offset', () => {
      const message = {
        id: 'message-1',
        session_id: 'session-1',
        role: 'user',
        streaming_status: 'pending',
        creator_kind: 'user',
        creator_ref_id: 'user-123',
      };
      expect(isValidMessage(message)).toBe(false);
    });

    it('should return false for wrong type of global_offset', () => {
      const message = {
        id: 'message-1',
        session_id: 'session-1',
        global_offset: '0', // should be number
        role: 'user',
        streaming_status: 'pending',
        creator_kind: 'user',
        creator_ref_id: 'user-123',
      };
      expect(isValidMessage(message)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidMessage(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidMessage(undefined)).toBe(false);
    });
  });

  // ── isValidRtc ──

  describe('isValidRtc', () => {
    it('should return true for valid Rtc', () => {
      const rtc = {
        id: 'rtc-1',
        session_id: 'session-1',
        turn_id: 'turn-1',
        tool_name: 'search',
        status: 'pending',
        created_at: '2026-10-10T00:00:00Z',
      };
      expect(isValidRtc(rtc)).toBe(true);
    });

    it('should return true for Rtc with all valid statuses', () => {
      const statuses = [
        'pending',
        'sent',
        'executing',
        'completed',
        'failed',
        'timeout',
        'rejected',
      ] as const;
      statuses.forEach((status) => {
        const rtc = {
          id: 'rtc-1',
          session_id: 'session-1',
          turn_id: 'turn-1',
          tool_name: 'search',
          status,
        };
        expect(isValidRtc(rtc)).toBe(true);
      });
    });

    it('should return false for invalid status', () => {
      const rtc = {
        id: 'rtc-1',
        session_id: 'session-1',
        turn_id: 'turn-1',
        tool_name: 'search',
        status: 'invalid_status',
      };
      expect(isValidRtc(rtc)).toBe(false);
    });

    it('should return false for missing id', () => {
      const rtc = {
        session_id: 'session-1',
        turn_id: 'turn-1',
        tool_name: 'search',
        status: 'pending',
      };
      expect(isValidRtc(rtc)).toBe(false);
    });

    it('should return false for missing tool_name', () => {
      const rtc = {
        id: 'rtc-1',
        session_id: 'session-1',
        turn_id: 'turn-1',
        status: 'pending',
      };
      expect(isValidRtc(rtc)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidRtc(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidRtc(undefined)).toBe(false);
    });
  });

  // ── isValidContentData ──

  describe('isValidContentData', () => {
    it('should return true for valid ContentData', () => {
      const contentData = {
        type: 'text',
        data: { text: 'Hello, world!' },
      };
      expect(isValidContentData(contentData)).toBe(true);
    });

    it('should return true for ContentData with different types', () => {
      const types = ['text', 'image', 'tool_call', 'tool_result'];
      types.forEach((type) => {
        const contentData = {
          type,
          data: {},
        };
        expect(isValidContentData(contentData)).toBe(true);
      });
    });

    it('should return false for missing type', () => {
      const contentData = {
        data: { text: 'Hello, world!' },
      };
      expect(isValidContentData(contentData)).toBe(false);
    });

    it('should return false for missing data', () => {
      const contentData = {
        type: 'text',
      };
      expect(isValidContentData(contentData)).toBe(false);
    });

    it('should return false for non-string type', () => {
      const contentData = {
        type: 123,
        data: { text: 'Hello, world!' },
      };
      expect(isValidContentData(contentData)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidContentData(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidContentData(undefined)).toBe(false);
    });
  });

  // ── isValidUpdateDataList ──

  describe('isValidUpdateDataList', () => {
    it('should return true for undefined dataList', () => {
      expect(isValidUpdateDataList(undefined, 5)).toBe(true);
    });

    it('should return true for empty array', () => {
      expect(isValidUpdateDataList([], 0)).toBe(true);
      expect(isValidUpdateDataList([], 5)).toBe(true);
    });

    it('should return true for matching length', () => {
      const dataList = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(isValidUpdateDataList(dataList, 3)).toBe(true);
    });

    it('should return false for non-array', () => {
      expect(isValidUpdateDataList('not an array', 5)).toBe(false);
      expect(isValidUpdateDataList(123, 5)).toBe(false);
      expect(isValidUpdateDataList({}, 5)).toBe(false);
    });

    it('should return false for mismatched length', () => {
      const dataList = [{ id: 1 }, { id: 2 }];
      expect(isValidUpdateDataList(dataList, 3)).toBe(false);
    });
  });

  // ── extractClientId ──

  describe('extractClientId', () => {
    it('should extract client_id when present', () => {
      const record = { client_id: 'client-123', other: 'value' };
      expect(extractClientId(record)).toBe('client-123');
    });

    it('should fall back to id when client_id is missing', () => {
      const record = { id: 'id-456', other: 'value' };
      expect(extractClientId(record)).toBe('id-456');
    });

    it('should prefer client_id over id', () => {
      const record = { client_id: 'client-123', id: 'id-456' };
      expect(extractClientId(record)).toBe('client-123');
    });

    it('should throw error when both client_id and id are missing', () => {
      const record = { other: 'value' };
      expect(() => extractClientId(record)).toThrow(
        'Record missing required client_id or id field',
      );
    });

    it('should throw error when client_id is not a string', () => {
      const record = { client_id: 123 };
      expect(() => extractClientId(record)).toThrow(
        'Record missing required client_id or id field',
      );
    });

    it('should throw error when id is not a string', () => {
      const record = { id: 123 };
      expect(() => extractClientId(record)).toThrow(
        'Record missing required client_id or id field',
      );
    });
  });

  // ── extractStringField ──

  describe('extractStringField', () => {
    it('should extract string field when present', () => {
      const record = { name: 'John', age: 30 };
      expect(extractStringField(record, 'name')).toBe('John');
    });

    it('should return undefined for missing field', () => {
      const record = { name: 'John' };
      expect(extractStringField(record, 'age')).toBeUndefined();
    });

    it('should return undefined for non-string field', () => {
      const record = { age: 30 };
      expect(extractStringField(record, 'age')).toBeUndefined();
    });

    it('should return undefined for null field', () => {
      const record = { name: null };
      expect(extractStringField(record, 'name')).toBeUndefined();
    });

    it('should handle empty string', () => {
      const record = { name: '' };
      expect(extractStringField(record, 'name')).toBe('');
    });
  });
});
