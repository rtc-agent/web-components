import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createLogger,
  setGlobalLogLevel,
  getGlobalLogLevel,
  type LogLevel,
} from './logger.js';

describe('logger', () => {
  beforeEach(() => {
    // Reset to default level before each test
    setGlobalLogLevel('info');
    // Spy on console methods
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getGlobalLogLevel / setGlobalLogLevel', () => {
    it('should default to info level', () => {
      expect(getGlobalLogLevel()).toBe('info');
    });

    it('should update global level', () => {
      setGlobalLogLevel('debug');
      expect(getGlobalLogLevel()).toBe('debug');
    });

    it('should accept all valid log levels', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      levels.forEach((level) => {
        setGlobalLogLevel(level);
        expect(getGlobalLogLevel()).toBe(level);
      });
    });
  });

  describe('createLogger', () => {
    it('should create a logger with all methods', () => {
      const log = createLogger('TestScope');
      expect(log).toHaveProperty('debug');
      expect(log).toHaveProperty('info');
      expect(log).toHaveProperty('warn');
      expect(log).toHaveProperty('error');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('should prefix messages with scope', () => {
      const log = createLogger('MyModule');
      log.info('test message');
      expect(console.info).toHaveBeenCalledWith('[MyModule]', 'test message');
    });

    it('should handle multiple arguments', () => {
      const log = createLogger('Test');
      log.info('message', { key: 'value' }, 123);
      expect(console.info).toHaveBeenCalledWith('[Test]', 'message', { key: 'value' }, 123);
    });
  });

  describe('log level filtering', () => {
    it('should filter debug messages when level is info', () => {
      setGlobalLogLevel('info');
      const log = createLogger('Test');
      log.debug('should not appear');
      expect(console.debug).not.toHaveBeenCalled();
    });

    it('should emit info messages when level is info', () => {
      setGlobalLogLevel('info');
      const log = createLogger('Test');
      log.info('should appear');
      expect(console.info).toHaveBeenCalled();
    });

    it('should emit warn messages when level is info', () => {
      setGlobalLogLevel('info');
      const log = createLogger('Test');
      log.warn('should appear');
      expect(console.warn).toHaveBeenCalled();
    });

    it('should emit error messages when level is info', () => {
      setGlobalLogLevel('info');
      const log = createLogger('Test');
      log.error('should appear');
      expect(console.error).toHaveBeenCalled();
    });

    it('should emit all messages when level is debug', () => {
      setGlobalLogLevel('debug');
      const log = createLogger('Test');
      log.debug('debug message');
      log.info('info message');
      log.warn('warn message');
      log.error('error message');
      expect(console.debug).toHaveBeenCalled();
      expect(console.info).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it('should filter debug and info when level is warn', () => {
      setGlobalLogLevel('warn');
      const log = createLogger('Test');
      log.debug('should not appear');
      log.info('should not appear');
      log.warn('should appear');
      log.error('should appear');
      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it('should filter debug, info, and warn when level is error', () => {
      setGlobalLogLevel('error');
      const log = createLogger('Test');
      log.debug('should not appear');
      log.info('should not appear');
      log.warn('should not appear');
      log.error('should appear');
      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('dynamic level changes', () => {
    it('should respect level changes after logger creation', () => {
      const log = createLogger('Test');
      setGlobalLogLevel('info');
      log.debug('should not appear');
      expect(console.debug).not.toHaveBeenCalled();

      setGlobalLogLevel('debug');
      log.debug('should appear');
      expect(console.debug).toHaveBeenCalled();
    });

    it('should respect level changes mid-execution', () => {
      const log = createLogger('Test');
      setGlobalLogLevel('debug');
      log.info('message 1');
      expect(console.info).toHaveBeenCalledTimes(1);

      setGlobalLogLevel('error');
      log.info('message 2');
      // Should still be 1 because info is filtered at error level
      expect(console.info).toHaveBeenCalledTimes(1);

      log.error('message 3');
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiple loggers', () => {
    it('should maintain separate scopes', () => {
      const log1 = createLogger('Module1');
      const log2 = createLogger('Module2');

      log1.info('from module 1');
      log2.info('from module 2');

      expect(console.info).toHaveBeenCalledWith('[Module1]', 'from module 1');
      expect(console.info).toHaveBeenCalledWith('[Module2]', 'from module 2');
    });

    it('should respect global level for all loggers', () => {
      const log1 = createLogger('Module1');
      const log2 = createLogger('Module2');

      setGlobalLogLevel('warn');
      log1.info('should not appear');
      log2.info('should not appear');
      log1.warn('should appear');
      log2.warn('should appear');

      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty scope', () => {
      const log = createLogger('');
      log.info('message');
      expect(console.info).toHaveBeenCalledWith('[]', 'message');
    });

    it('should handle special characters in scope', () => {
      const log = createLogger('My-Module_v2.0');
      log.info('message');
      expect(console.info).toHaveBeenCalledWith('[My-Module_v2.0]', 'message');
    });

    it('should handle undefined and null arguments', () => {
      const log = createLogger('Test');
      log.info('message', undefined, null);
      expect(console.info).toHaveBeenCalledWith('[Test]', 'message', undefined, null);
    });

    it('should handle objects with circular references', () => {
      const log = createLogger('Test');
      const obj: any = { key: 'value' };
      obj.self = obj;
      // Should not throw
      expect(() => log.info('circular', obj)).not.toThrow();
    });
  });
});
