import {describe, it, expect} from 'vitest';
import {darkTheme} from './dark.js';

describe('Dark Theme', () => {
    it('should export a CSSResult', () => {
        expect(darkTheme).toBeDefined();
        expect(darkTheme.cssText).toBeDefined();
    });

    it('should set dark background', () => {
        expect(darkTheme.cssText).toContain('--rtc-color-bg');
        expect(darkTheme.cssText).toContain('#1A7AB0');
    });

    it('should set light text', () => {
        expect(darkTheme.cssText).toContain('--rtc-color-text');
        expect(darkTheme.cssText).toContain('#E8E8E8');
    });

    it('should target dark theme attribute', () => {
        expect(darkTheme.cssText).toContain("[theme='dark']");
    });
});
