import { describe, it, expect } from 'vitest';
import { parseJwtPayload } from './utils.js';

/**
 * Helper: create a JWT-shaped token (header.payload.signature) from a payload object.
 */
function makeToken(payload: unknown): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = 'fakesig';
  return `${header}.${body}.${sig}`;
}

describe('parseJwtPayload', () => {
  it('should parse a valid JWT payload', () => {
    const token = makeToken({ sub: 'user-123', name: 'Alice' });
    const result = parseJwtPayload(token);
    expect(result).toEqual({ sub: 'user-123', name: 'Alice' });
  });

  it('should return null for malformed token (missing parts)', () => {
    expect(parseJwtPayload('only.two')).toBeNull();
    expect(parseJwtPayload('single')).toBeNull();
    expect(parseJwtPayload('a.b.c.d')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseJwtPayload('')).toBeNull();
  });

  it('should return null for invalid base64 payload', () => {
    expect(parseJwtPayload('header.!!!invalid!!!.sig')).toBeNull();
  });

  it('should return null for invalid JSON in payload', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const body = btoa('not-json');
    expect(parseJwtPayload(`${header}.${body}.sig`)).toBeNull();
  });

  it('should return null when payload is a JSON array', () => {
    const token = makeToken([1, 2, 3]);
    expect(parseJwtPayload(token)).toBeNull();
  });

  it('should return null when payload is a string', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const body = btoa('"just a string"');
    expect(parseJwtPayload(`${header}.${body}.sig`)).toBeNull();
  });

  it('should return null when payload is a number', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const body = btoa('42');
    expect(parseJwtPayload(`${header}.${body}.sig`)).toBeNull();
  });

  it('should return null when payload is null', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const body = btoa('null');
    expect(parseJwtPayload(`${header}.${body}.sig`)).toBeNull();
  });

  it('should return null when payload is a boolean', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const body = btoa('true');
    expect(parseJwtPayload(`${header}.${body}.sig`)).toBeNull();
  });

  it('should handle nested object payloads', () => {
    const token = makeToken({ user: { id: '123', roles: ['admin'] } });
    const result = parseJwtPayload(token);
    expect(result).toEqual({ user: { id: '123', roles: ['admin'] } });
  });
});
