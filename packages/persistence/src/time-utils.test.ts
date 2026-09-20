import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRFC3339, nowRFC3339 } from './time-utils.js';

describe('formatRFC3339', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Basic format ──

    it('should format a date as RFC3339 with local timezone', () => {
        // Create a date in local timezone: 2026-09-02 17:55:13.228
        const date = new Date(2026, 8, 2, 17, 55, 13, 228);
        const result = formatRFC3339(date);

        // Should match pattern: YYYY-MM-DDTHH:mm:ss.SSS+/-HH:MM
        expect(result).toMatch(
            /^2026-09-02T17:55:13\.228[+-]\d{2}:\d{2}$/
        );
    });

    it('should pad single-digit components', () => {
        const date = new Date(2026, 0, 5, 3, 7, 9, 42); // Jan 5, 03:07:09.042
        const result = formatRFC3339(date);

        expect(result).toMatch(
            /^2026-01-05T03:07:09\.042[+-]\d{2}:\d{2}$/
        );
    });

    it('should handle midnight on January 1st', () => {
        const date = new Date(2026, 0, 1, 0, 0, 0, 0);
        const result = formatRFC3339(date);
        expect(result).toMatch(
            /^2026-01-01T00:00:00\.000[+-]\d{2}:\d{2}$/
        );
    });

    it('should handle end-of-year December 31st 23:59:59.999', () => {
        const date = new Date(2026, 11, 31, 23, 59, 59, 999);
        const result = formatRFC3339(date);
        expect(result).toMatch(
            /^2026-12-31T23:59:59\.999[+-]\d{2}:\d{2}$/
        );
    });

    // ── Timezone offset ──

    it('should include correct timezone offset', () => {
        const date = new Date(2026, 5, 15, 12, 0, 0, 0);
        const result = formatRFC3339(date);

        // Verify the offset portion matches the actual timezone offset
        const expectedOffset = -date.getTimezoneOffset();
        const sign = expectedOffset >= 0 ? '+' : '-';
        const absOffset = Math.abs(expectedOffset);
        const h = String(Math.floor(absOffset / 60)).padStart(2, '0');
        const m = String(absOffset % 60).padStart(2, '0');
        const expectedSuffix = `${sign}${h}:${m}`;

        expect(result.endsWith(expectedSuffix)).toBe(true);
    });

    // ── Default argument ──

    it('should use current date when no argument is provided', () => {
        const now = new Date();
        const result = formatRFC3339();

        // Should be close to current time (within 1 second)
        const parsed = new Date(result);
        expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });

    // ── RFC3339 compliance ──

    it('should produce parseable timestamps', () => {
        const date = new Date(2026, 3, 20, 10, 30, 45, 123);
        const result = formatRFC3339(date);

        // JavaScript Date can parse RFC3339
        const parsed = new Date(result);
        expect(parsed.getFullYear()).toBe(2026);
        expect(parsed.getMonth()).toBe(3);
        expect(parsed.getDate()).toBe(20);
    });

    it('should produce millisecond precision (3 digits)', () => {
        const date = new Date(2026, 0, 1, 0, 0, 0, 7);
        const result = formatRFC3339(date);
        // Millisecond should be "007", not "7" or "007000"
        expect(result).toMatch(/\.007[+-]/);
    });
});

describe('nowRFC3339', () => {
    it('should return a valid RFC3339 string', () => {
        const result = nowRFC3339();
        expect(result).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/
        );
    });

    it('should return current time', () => {
        const before = Date.now();
        const result = nowRFC3339();
        const after = Date.now();

        const parsed = new Date(result).getTime();
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
    });
});
