/**
 * Tests for Context Runtime Validation Utilities
 *
 * Validates that the context-validation module correctly identifies
 * valid and invalid Context values, catching type mismatches early.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateAuthContext,
  validateSessionContext,
  validateMessageContext,
  validateModeContext,
  validateActivityContext,
} from './context-validation.js';

// Mock the logger to avoid polluting test output
vi.mock('@rtc-agent/protocol', async () => {
  const actual = await vi.importActual('@rtc-agent/protocol');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('Context Validation', () => {
  describe('validateAuthContext', () => {
    it('should accept valid AuthContext', () => {
      const validAuth = {
        state: { isLoggedIn: true, userId: 'user123' },
        actions: { login: () => {}, logout: () => {} },
      };
      expect(validateAuthContext(validAuth)).toBe(true);
    });

    it('should reject null or undefined', () => {
      expect(validateAuthContext(null)).toBe(false);
      expect(validateAuthContext(undefined)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(validateAuthContext('string')).toBe(false);
      expect(validateAuthContext(123)).toBe(false);
    });

    it('should reject missing state', () => {
      const invalidAuth = { actions: { login: () => {}, logout: () => {} } };
      expect(validateAuthContext(invalidAuth)).toBe(false);
    });

    it('should reject invalid state.isLoggedIn', () => {
      const invalidAuth1 = {
        state: { isLoggedIn: 'yes' },
        actions: { login: () => {}, logout: () => {} },
      };
      expect(validateAuthContext(invalidAuth1)).toBe(false);

      const invalidAuth2 = {
        state: { isLoggedIn: undefined },
        actions: { login: () => {}, logout: () => {} },
      };
      expect(validateAuthContext(invalidAuth2)).toBe(false);
    });

    it('should reject missing actions', () => {
      const invalidAuth = { state: { isLoggedIn: true } };
      expect(validateAuthContext(invalidAuth)).toBe(false);
    });

    it('should reject non-function actions', () => {
      const invalidAuth1 = {
        state: { isLoggedIn: true },
        actions: { login: 'not a function', logout: () => {} },
      };
      expect(validateAuthContext(invalidAuth1)).toBe(false);

      const invalidAuth2 = {
        state: { isLoggedIn: true },
        actions: { login: () => {}, logout: 'not a function' },
      };
      expect(validateAuthContext(invalidAuth2)).toBe(false);
    });

    it('should accept minimal valid AuthContext (logged out state)', () => {
      const minimalAuth = {
        state: { isLoggedIn: false },
        actions: { login: () => {}, logout: () => {} },
      };
      expect(validateAuthContext(minimalAuth)).toBe(true);
    });
  });

  describe('validateSessionContext', () => {
    it('should accept valid SessionContext', () => {
      const validSession = {
        state: { sessions: [], currentSessionId: null },
        actions: {
          setCurrentSession: () => {},
          createSession: () => '',
          switchSession: () => {},
        },
      };
      expect(validateSessionContext(validSession)).toBe(true);
    });

    it('should reject missing state', () => {
      const invalidSession = {
        actions: { setCurrentSession: () => {} },
      };
      expect(validateSessionContext(invalidSession)).toBe(false);
    });

    it('should reject non-array sessions', () => {
      const invalidSession = {
        state: { sessions: 'not an array', currentSessionId: null },
        actions: { setCurrentSession: () => {} },
      };
      expect(validateSessionContext(invalidSession)).toBe(false);
    });

    it('should reject invalid currentSessionId type', () => {
      const invalidSession1 = {
        state: { sessions: [], currentSessionId: 123 },
        actions: { setCurrentSession: () => {} },
      };
      expect(validateSessionContext(invalidSession1)).toBe(false);

      const invalidSession2 = {
        state: { sessions: [], currentSessionId: undefined },
        actions: { setCurrentSession: () => {} },
      };
      expect(validateSessionContext(invalidSession2)).toBe(false);
    });

    it('should accept currentSessionId as string or null', () => {
      const withNull = {
        state: { sessions: [], currentSessionId: null },
        actions: { setCurrentSession: () => {} },
      };
      expect(validateSessionContext(withNull)).toBe(true);

      const withString = {
        state: { sessions: [], currentSessionId: 'session-123' },
        actions: { setCurrentSession: () => {} },
      };
      expect(validateSessionContext(withString)).toBe(true);
    });
  });

  describe('validateMessageContext', () => {
    it('should accept valid MessageContext', () => {
      const validMessage = {
        state: { messages: [], hasMore: false, isLoadingMore: false },
        actions: {
          sendMessage: async () => {},
          appendToLastMessage: () => {},
        },
      };
      expect(validateMessageContext(validMessage)).toBe(true);
    });

    it('should reject non-array messages', () => {
      const invalidMessage = {
        state: { messages: 'not an array', hasMore: false },
        actions: { sendMessage: async () => {} },
      };
      expect(validateMessageContext(invalidMessage)).toBe(false);
    });

    it('should reject missing sendMessage action', () => {
      const invalidMessage = {
        state: { messages: [], hasMore: false },
        actions: { appendToLastMessage: () => {} },
      };
      expect(validateMessageContext(invalidMessage)).toBe(false);
    });
  });

  describe('validateModeContext', () => {
    it('should accept valid ModeContext', () => {
      const validMode = {
        state: { currentMode: 'edit' },
        actions: { setMode: () => {} },
      };
      expect(validateModeContext(validMode)).toBe(true);
    });

    it('should reject non-string currentMode', () => {
      const invalidMode1 = {
        state: { currentMode: 123 },
        actions: { setMode: () => {} },
      };
      expect(validateModeContext(invalidMode1)).toBe(false);

      const invalidMode2 = {
        state: { currentMode: null },
        actions: { setMode: () => {} },
      };
      expect(validateModeContext(invalidMode2)).toBe(false);
    });
  });

  describe('validateActivityContext', () => {
    it('should accept valid ActivityContext', () => {
      const validActivity = {
        state: { active: 'chat', sidebarVisible: true },
        actions: { setActivity: () => {} },
      };
      expect(validateActivityContext(validActivity)).toBe(true);
    });

    it('should reject non-string active', () => {
      const invalidActivity = {
        state: { active: 123, sidebarVisible: true },
        actions: { setActivity: () => {} },
      };
      expect(validateActivityContext(invalidActivity)).toBe(false);
    });
  });
});
