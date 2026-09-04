import {describe, it, expect} from 'vitest';
import type {
    Message,
    Session,
    Mode,
    ToolCall,
    WindowState,
    AuthState,
} from './index.js';

describe('Type Definitions', () => {
    it('should allow creating a valid Message object', () => {
        const msg: Message = {
            clientId: 'msg-1',
            role: 'user',
            content: {type: 'text', data: 'hello'},
            timestamp: Date.now(),
            syncStatus: 'synced',
        };
        expect(msg.role).toBe('user');
        expect(msg.content.data).toBe('hello');
    });

    it('should allow creating a valid Session object', () => {
        const session: Session = {
            clientId: 'session-1',
            title: 'Untitled',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        expect(session.title).toBe('Untitled');
    });

    it('should define all mode values', () => {
        const modes: Mode[] = ['manual', 'edit', 'plan', 'auto', 'bypass'];
        expect(modes).toHaveLength(5);
    });

    it('should allow creating a valid ToolCall object', () => {
        const tc: ToolCall = {
            id: 'tc-1',
            toolName: 'Bash',
            command: 'ls',
            status: 'pending',
        };
        expect(tc.status).toBe('pending');
    });

    it('should allow creating a valid WindowState', () => {
        const ws: WindowState = {
            mode: 'normal',
            position: {x: 100, y: 100},
            size: {width: 420, height: 640},
        };
        expect(ws.mode).toBe('normal');
    });

    it('should allow creating a valid AuthState', () => {
        const auth: AuthState = {
            isLoggedIn: false,
        };
        expect(auth.isLoggedIn).toBe(false);
    });
});
