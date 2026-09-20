import { describe, it, expect } from 'vitest';
import { parseCommand } from './command-parser.js';

describe('command-parser', () => {
    // ── Basic command detection ──

    describe('basic command detection', () => {
        it('should parse a simple command without args', () => {
            const result = parseCommand('/compact');
            expect(result).toEqual({ isCommand: true, name: 'compact' });
        });

        it('should parse a command with args', () => {
            const result = parseCommand('/compact summarize');
            expect(result).toEqual({ isCommand: true, name: 'compact', args: 'summarize' });
        });

        it('should parse a command with Chinese args', () => {
            const result = parseCommand('/compact 请总结对话');
            expect(result).toEqual({ isCommand: true, name: 'compact', args: '请总结对话' });
        });

        it('should return isCommand=false for plain text', () => {
            expect(parseCommand('hello world')).toEqual({ isCommand: false });
        });

        it('should return isCommand=false for empty string', () => {
            expect(parseCommand('')).toEqual({ isCommand: false });
        });
    });

    // ── Edge cases around '/' ──

    describe('slash edge cases', () => {
        it('should return isCommand=false for bare "/"', () => {
            expect(parseCommand('/')).toEqual({ isCommand: false });
        });

        it('should return isCommand=false for "/ " (slash + space)', () => {
            expect(parseCommand('/ ')).toEqual({ isCommand: false });
        });

        it('should return isCommand=false for text not starting with "/"', () => {
            expect(parseCommand(' hello')).toEqual({ isCommand: false });
        });

        it('should handle "/" with leading whitespace', () => {
            // trim() strips leading/trailing whitespace before checking
            const result = parseCommand('  /test  ');
            expect(result).toEqual({ isCommand: true, name: 'test' });
        });
    });

    // ── Case normalization ──

    describe('case normalization', () => {
        it('should lowercase the command name', () => {
            expect(parseCommand('/Compact')).toEqual({ isCommand: true, name: 'compact' });
        });

        it('should lowercase multi-char command', () => {
            expect(parseCommand('/CLEAR_ALL')).toEqual({ isCommand: true, name: 'clear_all' });
        });

        it('should preserve original case in args', () => {
            const result = parseCommand('/send Hello World');
            expect(result).toEqual({ isCommand: true, name: 'send', args: 'Hello World' });
        });
    });

    // ── Whitespace handling ──

    describe('whitespace handling', () => {
        it('should handle multiple spaces between command and args', () => {
            const result = parseCommand('/compact   summarize   now');
            expect(result).toEqual({ isCommand: true, name: 'compact', args: 'summarize   now' });
        });

        it('should handle tab as whitespace separator', () => {
            const result = parseCommand('/compact\tsummarize');
            expect(result).toEqual({ isCommand: true, name: 'compact', args: 'summarize' });
        });

        it('should trim trailing whitespace from args', () => {
            const result = parseCommand('/compact summarize   ');
            expect(result).toEqual({ isCommand: true, name: 'compact', args: 'summarize' });
        });

        it('should return undefined args when only whitespace follows command', () => {
            // After trim, "/compact   " becomes "/compact" (the trailing spaces are stripped)
            const result = parseCommand('/compact   ');
            expect(result).toEqual({ isCommand: true, name: 'compact' });
        });
    });

    // ── Command name extraction ──

    describe('command name extraction', () => {
        it('should extract command name up to first whitespace', () => {
            const result = parseCommand('/my-cmd arg1 arg2');
            expect(result).toEqual({ isCommand: true, name: 'my-cmd', args: 'arg1 arg2' });
        });

        it('should handle command with no args but trailing newline', () => {
            const result = parseCommand('/compact\n');
            expect(result).toEqual({ isCommand: true, name: 'compact' });
        });
    });
});
