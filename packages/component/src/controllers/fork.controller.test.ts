import {describe, it, expect, beforeEach, vi} from 'vitest';
import {ForkController} from './fork.controller.js';

class MockHost {
    updateCount = 0;
    requestUpdate() {
        this.updateCount++;
    }
    addController(_c: unknown) {}
}

describe('ForkController', () => {
    let host: MockHost;
    let ctrl: ForkController;
    let deps: {
        clearMessages: ReturnType<typeof vi.fn>;
        setInputValue: ReturnType<typeof vi.fn>;
        setNoticeMessage: ReturnType<typeof vi.fn>;
        clearNoticeMessage: ReturnType<typeof vi.fn>;
        executeFork: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        host = new MockHost();
        ctrl = new ForkController(host as any);
        deps = {
            clearMessages: vi.fn(),
            setInputValue: vi.fn(),
            setNoticeMessage: vi.fn(),
            clearNoticeMessage: vi.fn(),
            executeFork: vi.fn().mockResolvedValue(undefined),
        };
        ctrl.setDeps(deps);
    });

    describe('initial state', () => {
        it('should have null state initially', () => {
            expect(ctrl.state).toBeNull();
        });

        it('should not be active initially', () => {
            expect(ctrl.isActive).toBe(false);
        });

        it('should expose actions object', () => {
            expect(ctrl.actions).toBeDefined();
            expect(typeof ctrl.actions.requestFork).toBe('function');
            expect(typeof ctrl.actions.submitFork).toBe('function');
            expect(typeof ctrl.actions.clearFork).toBe('function');
        });
    });

    describe('requestFork', () => {
        it('should set fork state', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello world');

            expect(ctrl.state).toBeDefined();
            expect(ctrl.state?.oldSessionClientId).toBe('session-1');
            expect(ctrl.state?.oldMessageClientId).toBe('msg-1');
            expect(ctrl.state?.newSessionClientId).toBe('session-2');
        });

        it('should set hint message', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello world');

            expect(ctrl.state?.hintMessage).toContain('分叉');
            expect(ctrl.state?.hintMessage).toContain('Hello world');
        });

        it('should truncate long content in hint', () => {
            const longContent = 'A'.repeat(100);
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', longContent);

            expect(ctrl.state?.hintMessage).toContain('...');
            expect(ctrl.state?.hintMessage.length).toBeLessThan(100);
        });

        it('should not truncate short content', () => {
            const shortContent = 'Hello';
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', shortContent);

            expect(ctrl.state?.hintMessage).toContain('Hello');
            expect(ctrl.state?.hintMessage).not.toContain('...');
        });

        it('should clear messages', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            expect(deps.clearMessages).toHaveBeenCalled();
        });

        it('should set input value with content', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello world');
            expect(deps.setInputValue).toHaveBeenCalledWith('Hello world');
        });

        it('should set notice message', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            expect(deps.setNoticeMessage).toHaveBeenCalled();
        });

        it('should become active', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            expect(ctrl.isActive).toBe(true);
        });

        it('should request host update', () => {
            const updatesBefore = host.updateCount;
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });
    });

    describe('submitFork', () => {
        it('should call executeFork with correct parameters', async () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');

            const content = {type: 'text' as const, data: 'Forked content'};
            await ctrl.actions.submitFork(content);

            expect(deps.executeFork).toHaveBeenCalledWith({
                oldSessionClientId: 'session-1',
                oldMessageClientId: 'msg-1',
                newSessionClientId: 'session-2',
                newMessageClientId: expect.stringMatching(/^msg-/),
                content,
            });
        });

        it('should generate unique message client ID', async () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');

            const content = {type: 'text' as const, data: 'Test'};
            await ctrl.actions.submitFork(content);

            const call = deps.executeFork.mock.calls[0][0];
            expect(call.newMessageClientId).toMatch(/^msg-/);
            expect(call.newMessageClientId.length).toBeGreaterThan(4);
        });

        it('should clear fork state after submission', async () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            await ctrl.actions.submitFork({type: 'text' as const, data: 'Test'});

            expect(ctrl.state).toBeNull();
            expect(ctrl.isActive).toBe(false);
        });

        it('should clear notice message after submission', async () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            await ctrl.actions.submitFork({type: 'text' as const, data: 'Test'});

            expect(deps.clearNoticeMessage).toHaveBeenCalled();
        });

        it('should handle executeFork error gracefully', async () => {
            const error = new Error('Fork failed');
            deps.executeFork.mockRejectedValue(error);

            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');

            // Should not throw
            await ctrl.actions.submitFork({type: 'text' as const, data: 'Test'});

            // Should still clear fork state
            expect(ctrl.state).toBeNull();
        });

        it('should request host update after submission', async () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            const updatesBefore = host.updateCount;
            await ctrl.actions.submitFork({type: 'text' as const, data: 'Test'});
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });

        it('should do nothing if no state', async () => {
            const content = {type: 'text' as const, data: 'Test'};
            await ctrl.actions.submitFork(content);

            expect(deps.executeFork).not.toHaveBeenCalled();
        });

        it('should do nothing if no deps', async () => {
            const ctrl2 = new ForkController(new MockHost() as any);
            ctrl2.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');

            const content = {type: 'text' as const, data: 'Test'};
            await ctrl2.actions.submitFork(content);

            // Should not throw
        });
    });

    describe('clearFork', () => {
        it('should clear fork state', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            ctrl.actions.clearFork();

            expect(ctrl.state).toBeNull();
            expect(ctrl.isActive).toBe(false);
        });

        it('should clear notice message', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            ctrl.actions.clearFork();

            expect(deps.clearNoticeMessage).toHaveBeenCalled();
        });

        it('should request host update', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            const updatesBefore = host.updateCount;
            ctrl.actions.clearFork();
            expect(host.updateCount).toBeGreaterThan(updatesBefore);
        });

        it('should be idempotent', () => {
            ctrl.actions.clearFork();
            ctrl.actions.clearFork();

            // Should not throw
            expect(deps.clearNoticeMessage).toHaveBeenCalledTimes(2);
        });

        it('should work without deps', () => {
            const ctrl2 = new ForkController(new MockHost() as any);
            ctrl2.actions.clearFork();

            // Should not throw
        });
    });

    describe('state transitions', () => {
        it('should transition from inactive -> active -> inactive', () => {
            expect(ctrl.isActive).toBe(false);

            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');
            expect(ctrl.isActive).toBe(true);

            ctrl.actions.clearFork();
            expect(ctrl.isActive).toBe(false);
        });

        it('should handle rapid state changes', () => {
            for (let i = 0; i < 5; i++) {
                ctrl.actions.requestFork(`session-${i}`, `msg-${i}`, `new-session-${i}`, `Content ${i}`);
                ctrl.actions.clearFork();
            }

            expect(ctrl.isActive).toBe(false);
        });

        it('should allow re-request after clear', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'First');
            ctrl.actions.clearFork();

            ctrl.actions.requestFork('session-3', 'msg-3', 'session-4', 'Second');
            expect(ctrl.state?.oldSessionClientId).toBe('session-3');
        });

        it('should allow re-request after submit', async () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', 'First');
            await ctrl.actions.submitFork({type: 'text' as const, data: 'Test'});

            ctrl.actions.requestFork('session-3', 'msg-3', 'session-4', 'Second');
            expect(ctrl.state?.oldSessionClientId).toBe('session-3');
        });
    });

    describe('edge cases', () => {
        it('should handle empty content', () => {
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', '');
            expect(ctrl.state?.hintMessage).toContain('分叉');
        });

        it('should handle very long content', () => {
            const longContent = 'A'.repeat(10000);
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', longContent);

            expect(ctrl.state?.hintMessage.length).toBeLessThan(100);
        });

        it('should handle special characters in content', () => {
            const specialContent = 'Hello <script>alert("xss")</script>';
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', specialContent);

            expect(deps.setInputValue).toHaveBeenCalledWith(specialContent);
        });

        it('should handle unicode content', () => {
            const unicodeContent = '你好世界 🌍 Привет';
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', unicodeContent);

            expect(deps.setInputValue).toHaveBeenCalledWith(unicodeContent);
        });

        it('should handle content at exactly 30 characters', () => {
            const content = 'A'.repeat(30);
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', content);

            expect(ctrl.state?.hintMessage).not.toContain('...');
        });

        it('should handle content at 31 characters', () => {
            const content = 'A'.repeat(31);
            ctrl.actions.requestFork('session-1', 'msg-1', 'session-2', content);

            expect(ctrl.state?.hintMessage).toContain('...');
        });
    });

    describe('deps integration', () => {
        it('should work without setting deps', () => {
            const ctrl2 = new ForkController(new MockHost() as any);
            ctrl2.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');

            expect(ctrl2.state).toBeDefined();
            // Should not throw even without deps
        });

        it('should allow setting deps after construction', () => {
            const ctrl2 = new ForkController(new MockHost() as any);
            ctrl2.actions.requestFork('session-1', 'msg-1', 'session-2', 'Hello');

            // Now set deps
            ctrl2.setDeps(deps);
            ctrl2.actions.clearFork();

            expect(deps.clearNoticeMessage).toHaveBeenCalled();
        });
    });
});
