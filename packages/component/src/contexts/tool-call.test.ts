import {describe, it, expect} from 'vitest';
import {ToolCallContext} from './tool-call.js';

describe('ToolCallContext', () => {
    it('should export a context key', () => {
        expect(ToolCallContext).toBeDefined();
    });
});
