import {describe, it, expect} from 'vitest';
import {baseStyles} from './base.js';

describe('Base Styles', () => {
    it('should export a CSSResult', () => {
        expect(baseStyles).toBeDefined();
    });

    it('should set box-sizing border-box', () => {
        expect(baseStyles.cssText).toContain('box-sizing');
    });

    it('should set system font family', () => {
        expect(baseStyles.cssText).toContain('font-family');
    });

    it('should respect prefers-reduced-motion', () => {
        expect(baseStyles.cssText).toContain('prefers-reduced-motion');
    });
});
