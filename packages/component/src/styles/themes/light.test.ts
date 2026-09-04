import {describe, it, expect} from 'vitest';
import {lightTheme} from './light.js';

describe('Light Theme', () => {
    it('should export a CSSResult', () => {
        expect(lightTheme).toBeDefined();
        expect(lightTheme.cssText).toBeDefined();
    });

    it('should override color primary', () => {
        expect(lightTheme.cssText).toContain('--rtc-color-primary');
    });

    it('should set light background', () => {
        expect(lightTheme.cssText).toContain('--rtc-color-bg');
        expect(lightTheme.cssText).toContain('#ffffff');
    });

    it('should set dark text', () => {
        expect(lightTheme.cssText).toContain('--rtc-color-text');
        expect(lightTheme.cssText).toContain('#333333');
    });
});
