import {describe, it, expect} from 'vitest';
import {tokens} from './tokens.js';

describe('Design Tokens', () => {
    it('should export a CSSResult', () => {
        expect(tokens).toBeDefined();
        expect(tokens.cssText).toBeDefined();
    });

    it('should NOT define color variables (colors belong to theme files)', () => {
        // Color tokens are defined in themes/light.ts and themes/dark.ts
        // tokens.ts only defines layout, spacing, typography, and structural tokens
        const text = tokens.cssText;
        expect(text).not.toContain('--rtc-color-primary:');
        expect(text).not.toContain('--rtc-color-text:');
        expect(text).not.toContain('--rtc-color-bg:');
    });

    it('should define spacing variables', () => {
        const text = tokens.cssText;
        expect(text).toContain('--rtc-spacing-xs');
        expect(text).toContain('--rtc-spacing-sm');
        expect(text).toContain('--rtc-spacing-md');
        expect(text).toContain('--rtc-spacing-lg');
        expect(text).toContain('--rtc-spacing-xl');
    });

    it('should define font variables', () => {
        const text = tokens.cssText;
        expect(text).toContain('--rtc-font-family-base');
        expect(text).toContain('--rtc-font-size-base');
        expect(text).toContain('--rtc-font-weight-normal');
        expect(text).toContain('--rtc-line-height-base');
    });

    it('should define border variables', () => {
        const text = tokens.cssText;
        expect(text).toContain('--rtc-border-width');
        expect(text).toContain('--rtc-border-radius');
    });

    it('should define shadow variables', () => {
        const text = tokens.cssText;
        expect(text).toContain('--rtc-shadow-sm');
        expect(text).toContain('--rtc-shadow-md');
    });

    it('should define transition variables', () => {
        const text = tokens.cssText;
        expect(text).toContain('--rtc-transition-duration');
        expect(text).toContain('--rtc-transition-timing');
    });

    it('should define z-index layers', () => {
        const text = tokens.cssText;
        expect(text).toContain('--rtc-z-content');
        expect(text).toContain('--rtc-z-overlay');
        expect(text).toContain('--rtc-z-title-bar');
    });
});
