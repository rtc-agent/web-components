import {describe, it, expect} from 'vitest';
import {ModeContext, MODE_CONFIGS} from './mode.js';

describe('ModeContext', () => {
    it('should export a context key', () => {
        expect(ModeContext).toBeDefined();
    });

    it('should define 3 mode configurations', () => {
        expect(MODE_CONFIGS).toHaveLength(3);
    });

    it('should include manual, edit, bypass modes', () => {
        const modeNames = MODE_CONFIGS.map((c) => c.mode);
        expect(modeNames).toContain('manual');
        expect(modeNames).toContain('edit');
        expect(modeNames).toContain('bypass');
    });

    it('should have labels and descriptions for each mode', () => {
        for (const config of MODE_CONFIGS) {
            expect(config.label.length).toBeGreaterThan(0);
            expect(config.description.length).toBeGreaterThan(0);
        }
    });
});
