import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from './relative-time.js';

describe('formatRelativeTime', () => {
    const FIXED_NOW = new Date('2026-09-20T12:00:00Z').getTime();

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Seconds ──

    it('should format seconds ago in Chinese', () => {
        const thirtySecsAgo = FIXED_NOW - 30 * 1000;
        const result = formatRelativeTime(thirtySecsAgo, 'zh-CN');
        expect(result).toContain('秒');
    });

    it('should format seconds in the future', () => {
        const thirtySecsAhead = FIXED_NOW + 30 * 1000;
        const result = formatRelativeTime(thirtySecsAhead, 'zh-CN');
        expect(result).toContain('秒');
    });

    // ── Minutes ──

    it('should format minutes ago in Chinese', () => {
        const fiveMinAgo = FIXED_NOW - 5 * 60 * 1000;
        const result = formatRelativeTime(fiveMinAgo, 'zh-CN');
        expect(result).toContain('分钟');
    });

    // ── Hours ──

    it('should format hours ago in Chinese', () => {
        const threeHoursAgo = FIXED_NOW - 3 * 60 * 60 * 1000;
        const result = formatRelativeTime(threeHoursAgo, 'zh-CN');
        expect(result).toContain('小时');
    });

    // ── Days ──

    it('should format days ago in Chinese', () => {
        const twoDaysAgo = FIXED_NOW - 2 * 24 * 60 * 60 * 1000;
        const result = formatRelativeTime(twoDaysAgo, 'zh-CN');
        expect(result).toContain('天');
    });

    // ── Weeks ──

    it('should format weeks ago in Chinese', () => {
        const twoWeeksAgo = FIXED_NOW - 14 * 24 * 60 * 60 * 1000;
        const result = formatRelativeTime(twoWeeksAgo, 'zh-CN');
        expect(result).toContain('周');
    });

    // ── Months ──

    it('should format months ago in Chinese', () => {
        const twoMonthsAgo = FIXED_NOW - 60 * 24 * 60 * 60 * 1000;
        const result = formatRelativeTime(twoMonthsAgo, 'zh-CN');
        expect(result).toContain('个月');
    });

    // ── Years ──

    it('should format years ago in Chinese', () => {
        const twoYearsAgo = FIXED_NOW - 730 * 24 * 60 * 60 * 1000;
        const result = formatRelativeTime(twoYearsAgo, 'zh-CN');
        expect(result).toContain('年');
    });

    // ── English locale ──

    it('should format in English', () => {
        const fiveMinAgo = FIXED_NOW - 5 * 60 * 1000;
        const result = formatRelativeTime(fiveMinAgo, 'en-US');
        expect(result).toMatch(/minute/);
    });

    it('should format hours in English', () => {
        const threeHoursAgo = FIXED_NOW - 3 * 60 * 60 * 1000;
        const result = formatRelativeTime(threeHoursAgo, 'en-US');
        expect(result).toMatch(/hour/);
    });

    // ── Default locale ──

    it('should default to Chinese locale', () => {
        const fiveMinAgo = FIXED_NOW - 5 * 60 * 1000;
        const result = formatRelativeTime(fiveMinAgo);
        expect(result).toContain('分钟');
    });

    // ── Edge cases ──

    it('should handle timestamp equal to now (0 seconds)', () => {
        const result = formatRelativeTime(FIXED_NOW, 'zh-CN');
        // Should be "现在" or "0秒前" depending on Intl implementation
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});
