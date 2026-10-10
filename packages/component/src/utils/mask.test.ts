import { describe, it, expect } from 'vitest';
import { maskUserID, maskEmail } from './mask.js';

describe('maskUserID', () => {
  it('returns empty string for falsy input', () => {
    expect(maskUserID('')).toBe('');
    expect(maskUserID(null)).toBe('');
    expect(maskUserID(undefined)).toBe('');
  });

  it('returns "***" for short IDs (<=6 chars)', () => {
    expect(maskUserID('a')).toBe('***');
    expect(maskUserID('abc')).toBe('***');
    expect(maskUserID('abcdef')).toBe('***');
  });

  it('masks middle characters for longer IDs', () => {
    expect(maskUserID('abcdefg')).toBe('abc***efg');
  });

  it('works with UUID format', () => {
    expect(maskUserID('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550***000',
    );
  });

  it('preserves first 3 and last 3 characters', () => {
    expect(maskUserID('user_12345')).toBe('use***345');
  });
});

describe('maskEmail', () => {
  it('returns empty string for falsy input', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail(null)).toBe('');
    expect(maskEmail(undefined)).toBe('');
  });

  it('masks normal email addresses', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
  });

  it('masks single-char local part', () => {
    expect(maskEmail('a@example.com')).toBe('***@example.com');
  });

  it('falls back to maskUserID for non-email strings', () => {
    expect(maskEmail('invalid')).toBe('inv***lid');
  });

  it('handles long local parts', () => {
    expect(maskEmail('administrator@corp.io')).toBe('a***@corp.io');
  });
});
