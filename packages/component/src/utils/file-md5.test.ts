import { describe, it, expect } from 'vitest';
import { calculateStringMD5, calculateBufferMD5 } from './file-md5.js';

describe('file-md5 utilities', () => {
  describe('calculateStringMD5', () => {
    it('should calculate MD5 hash of a string', () => {
      // MD5 of empty string
      expect(calculateStringMD5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
      // MD5 of "hello world"
      expect(calculateStringMD5('hello world')).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
    });
  });

  describe('calculateBufferMD5', () => {
    it('should calculate MD5 hash of an ArrayBuffer', () => {
      // Empty buffer
      const emptyBuffer = new ArrayBuffer(0);
      expect(calculateBufferMD5(emptyBuffer)).toBe('d41d8cd98f00b204e9800998ecf8427e');

      // Buffer with "test"
      const testBuffer = new TextEncoder().encode('test').buffer;
      expect(calculateBufferMD5(testBuffer)).toBe('098f6bcd4621d373cade4e832627b4f6');
    });
  });
});
