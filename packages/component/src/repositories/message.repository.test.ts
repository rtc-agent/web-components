import {describe, it, expect, vi, beforeEach} from 'vitest';
import {MessageRepository} from './message.repository.js';
import type {MessageApi} from './message.repository.js';
import type {Message} from '../types/index.js';

/** Auto-incrementing counter for deterministic test IDs. */
let _msgCounter = 0;

/**
 * Helper: create a mock Message with sensible defaults.
 *
 * Each call produces a unique clientId via an internal counter,
 * ensuring tests are deterministic (no Math.random).
 */
function createMessage(overrides: Partial<Message> = {}): Message {
    _msgCounter++;
    return {
        clientId: `msg-${_msgCounter}`,
        role: 'user',
        content: {type: 'text', data: 'test'},
        timestamp: Date.now(),
        syncStatus: 'synced',
        ...overrides,
    };
}

/**
 * Helper: create a mock MessageApi.
 *
 * Returns the API object plus vi.fn() spies for verification.
 */
function createMockApi() {
    const fetchMessages = vi.fn(async (_sessionId: string): Promise<Message[]> => []);
    const fetchOlderMessages = vi.fn(async (_sessionId: string, _beforeCursor?: string): Promise<Message[]> => []);
    const fetchNewerMessages = vi.fn(async (_sessionId: string, _afterCursor?: string): Promise<Message[]> => []);

    const api: MessageApi = {fetchMessages, fetchOlderMessages, fetchNewerMessages};
    return {api, fetchMessages, fetchOlderMessages, fetchNewerMessages};
}

describe('MessageRepository', () => {
    let repo: MessageRepository;
    let mockApi: ReturnType<typeof createMockApi>;

    /** PAGE_SIZE as defined in the implementation. */
    const PAGE_SIZE = 50;

    beforeEach(() => {
        _msgCounter = 0;
        mockApi = createMockApi();
        repo = new MessageRepository(mockApi.api);
    });

    /**
     * Helper: seed a session with PAGE_SIZE messages so hasMore=true.
     * Returns the seeded messages.
     */
    async function seedHasMore(sessionId = 's1'): Promise<Message[]> {
        const msgs = Array.from({length: PAGE_SIZE}, (_, i) =>
            createMessage({clientId: `seed-${i}`}),
        );
        mockApi.fetchMessages.mockResolvedValueOnce(msgs);
        await repo.fetchMessages(sessionId);
        return msgs;
    }

    // ── Basic: getSessionState ──

    describe('getSessionState', () => {
        it('returns default state for uninitialized session', () => {
            const state = repo.getSessionState('unknown-session');
            expect(state).toEqual({messages: [], hasMore: false, isLoadingMore: false, hasMoreNewer: false, isLoadingNewer: false});
        });

        it('returns default state (not the same reference) each time', () => {
            const a = repo.getSessionState('x');
            const b = repo.getSessionState('x');
            expect(a).toEqual(b);
            expect(a).not.toBe(b); // different object references
        });

        it('returns stored state after updateMessages', () => {
            const msgs = [createMessage()];
            repo.updateMessages('s1', msgs);
            const state = repo.getSessionState('s1');
            expect(state.messages).toEqual(msgs);
            expect(state.hasMore).toBe(false);
            expect(state.isLoadingMore).toBe(false);
        });
    });

    // ── Basic: updateMessages ──

    describe('updateMessages', () => {
        it('stores messages for a session', () => {
            const msgs = [createMessage({clientId: 'a'}), createMessage({clientId: 'b'})];
            repo.updateMessages('s1', msgs);
            expect(repo.getSessionState('s1').messages).toEqual(msgs);
        });

        it('replaces existing messages (not append)', () => {
            repo.updateMessages('s1', [createMessage({clientId: 'first'})]);
            repo.updateMessages('s1', [createMessage({clientId: 'second'})]);
            const msgs = repo.getSessionState('s1').messages;
            expect(msgs).toHaveLength(1);
            expect(msgs[0].clientId).toBe('second');
        });

        it('creates an independent copy of the input array', () => {
            const original = [createMessage()];
            repo.updateMessages('s1', original);
            original.push(createMessage());
            // Repository state should not be affected by external mutation
            expect(repo.getSessionState('s1').messages).toHaveLength(1);
        });

        it('notifies subscribers', () => {
            const cb = vi.fn();
            repo.subscribe('s1', cb);
            cb.mockClear(); // clear the initial notification

            const msgs = [createMessage()];
            repo.updateMessages('s1', msgs);

            expect(cb).toHaveBeenCalledOnce();
            expect(cb).toHaveBeenCalledWith(
                expect.objectContaining({messages: msgs})
            );
        });

        it('handles empty messages array', () => {
            repo.updateMessages('s1', []);
            expect(repo.getSessionState('s1').messages).toEqual([]);
        });
    });

    // ── Basic: appendMessage ──

    describe('appendMessage', () => {
        it('appends a message to an empty session', () => {
            const msg = createMessage({clientId: 'only'});
            repo.appendMessage('s1', msg);
            expect(repo.getSessionState('s1').messages).toEqual([msg]);
        });

        it('appends a message to existing messages', () => {
            const first = createMessage({clientId: 'first'});
            const second = createMessage({clientId: 'second'});
            repo.appendMessage('s1', first);
            repo.appendMessage('s1', second);
            const msgs = repo.getSessionState('s1').messages;
            expect(msgs).toHaveLength(2);
            expect(msgs[0].clientId).toBe('first');
            expect(msgs[1].clientId).toBe('second');
        });

        it('notifies subscribers', () => {
            const cb = vi.fn();
            repo.subscribe('s1', cb);
            cb.mockClear();

            const msg = createMessage();
            repo.appendMessage('s1', msg);

            expect(cb).toHaveBeenCalledOnce();
            expect(cb).toHaveBeenCalledWith(
                expect.objectContaining({messages: [msg]})
            );
        });

        it('preserves existing messages (immutability)', () => {
            const first = createMessage({clientId: 'first'});
            repo.appendMessage('s1', first);
            const stateBefore = repo.getSessionState('s1');

            const second = createMessage({clientId: 'second'});
            repo.appendMessage('s1', second);

            // Original state reference should not be mutated
            expect(stateBefore.messages).toHaveLength(1);
        });
    });

    // ── Basic: evictSession ──

    describe('evictSession', () => {
        it('clears session data', () => {
            repo.updateMessages('s1', [createMessage()]);
            repo.evictSession('s1');
            expect(repo.getSessionState('s1')).toEqual({
                messages: [],
                hasMore: false,
                isLoadingMore: false,
                hasMoreNewer: false,
                isLoadingNewer: false,
            });
        });

        it('removes all subscribers for the session', () => {
            const cb = vi.fn();
            repo.subscribe('s1', cb);
            cb.mockClear();

            repo.evictSession('s1');
            repo.updateMessages('s1', [createMessage()]);

            // Subscriber should not be called after eviction
            expect(cb).not.toHaveBeenCalled();
        });

        it('does not affect other sessions', () => {
            repo.updateMessages('s1', [createMessage({clientId: 's1-msg'})]);
            repo.updateMessages('s2', [createMessage({clientId: 's2-msg'})]);
            repo.evictSession('s1');

            expect(repo.getSessionState('s1').messages).toEqual([]);
            expect(repo.getSessionState('s2').messages).toHaveLength(1);
        });

        it('is safe to call on non-existent session', () => {
            expect(() => repo.evictSession('nonexistent')).not.toThrow();
        });
    });

    // ── Subscription mechanism ──

    describe('subscribe', () => {
        it('immediately invokes callback with current state', () => {
            const msgs = [createMessage()];
            repo.updateMessages('s1', msgs);

            const cb = vi.fn();
            repo.subscribe('s1', cb);

            expect(cb).toHaveBeenCalledOnce();
            expect(cb).toHaveBeenCalledWith(
                expect.objectContaining({messages: msgs})
            );
        });

        it('immediately invokes with default state for new session', () => {
            const cb = vi.fn();
            repo.subscribe('new-session', cb);

            expect(cb).toHaveBeenCalledOnce();
            expect(cb).toHaveBeenCalledWith({
                messages: [],
                hasMore: false,
                isLoadingMore: false,
                hasMoreNewer: false,
                isLoadingNewer: false,
            });
        });

        it('supports multiple subscribers for the same session', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            repo.subscribe('s1', cb1);
            repo.subscribe('s1', cb2);
            cb1.mockClear();
            cb2.mockClear();

            repo.updateMessages('s1', [createMessage()]);

            expect(cb1).toHaveBeenCalledOnce();
            expect(cb2).toHaveBeenCalledOnce();
        });

        it('unsubscribe stops notifications', () => {
            const cb = vi.fn();
            const unsub = repo.subscribe('s1', cb);
            cb.mockClear();

            unsub();
            repo.updateMessages('s1', [createMessage()]);

            expect(cb).not.toHaveBeenCalled();
        });

        it('unsubscribe is idempotent (safe to call twice)', () => {
            const cb = vi.fn();
            const unsub = repo.subscribe('s1', cb);
            unsub();
            expect(() => unsub()).not.toThrow();
        });

        it('unsubscribing one does not affect other subscribers', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            const unsub1 = repo.subscribe('s1', cb1);
            repo.subscribe('s1', cb2);
            cb1.mockClear();
            cb2.mockClear();

            unsub1();
            repo.updateMessages('s1', [createMessage()]);

            expect(cb1).not.toHaveBeenCalled();
            expect(cb2).toHaveBeenCalledOnce();
        });

        it('subscriber errors do not break other subscribers', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const cb1 = vi.fn(() => { throw new Error('boom'); });
            const cb2 = vi.fn();
            repo.subscribe('s1', cb1);
            repo.subscribe('s1', cb2);
            cb1.mockClear();
            cb2.mockClear();

            repo.updateMessages('s1', [createMessage()]);

            expect(cb1).toHaveBeenCalledOnce();
            expect(cb2).toHaveBeenCalledOnce();
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    // ── Async: fetchMessages ──

    describe('fetchMessages', () => {
        it('calls API and stores returned messages', async () => {
            const msgs = [createMessage({clientId: 'a'}), createMessage({clientId: 'b'})];
            mockApi.fetchMessages.mockResolvedValueOnce(msgs);

            const result = await repo.fetchMessages('s1');

            expect(mockApi.fetchMessages).toHaveBeenCalledWith('s1');
            expect(result).toEqual(msgs);
            expect(repo.getSessionState('s1').messages).toEqual(msgs);
        });

        it('sets hasMore=false when API returns fewer than PAGE_SIZE messages', async () => {
            mockApi.fetchMessages.mockResolvedValueOnce([createMessage()]);

            await repo.fetchMessages('s1');

            expect(repo.getSessionState('s1').hasMore).toBe(false);
        });

        it('sets hasMore=true when API returns exactly PAGE_SIZE messages', async () => {
            const msgs = Array.from({length: PAGE_SIZE}, (_, i) =>
                createMessage({clientId: `msg-${i}`}),
            );
            mockApi.fetchMessages.mockResolvedValueOnce(msgs);

            await repo.fetchMessages('s1');

            expect(repo.getSessionState('s1').hasMore).toBe(true);
        });

        it('sets isLoadingMore=false after completion', async () => {
            mockApi.fetchMessages.mockResolvedValueOnce([]);

            await repo.fetchMessages('s1');

            expect(repo.getSessionState('s1').isLoadingMore).toBe(false);
        });

        it('notifies subscribers', async () => {
            const cb = vi.fn();
            repo.subscribe('s1', cb);
            cb.mockClear();

            const msgs = [createMessage()];
            mockApi.fetchMessages.mockResolvedValueOnce(msgs);
            await repo.fetchMessages('s1');

            expect(cb).toHaveBeenCalled();
            const lastCall = cb.mock.calls[cb.mock.calls.length - 1][0];
            expect(lastCall.messages).toEqual(msgs);
        });

        it('propagates API errors', async () => {
            mockApi.fetchMessages.mockRejectedValueOnce(new Error('network error'));

            await expect(repo.fetchMessages('s1')).rejects.toThrow('network error');
        });
    });

    // ── Async: loadMore ──

    describe('loadMore', () => {
        it('returns empty array for uninitialized session without calling API', async () => {
            const result = await repo.loadMore('nonexistent');

            expect(result).toEqual([]);
            expect(mockApi.fetchOlderMessages).not.toHaveBeenCalled();
        });

        it('returns current messages when hasMore is false', async () => {
            const msgs = [createMessage()];
            repo.updateMessages('s1', msgs);

            const result = await repo.loadMore('s1');

            expect(result).toEqual(msgs);
            expect(mockApi.fetchOlderMessages).not.toHaveBeenCalled();
        });

        it('calls API and prepends older messages when hasMore is true', async () => {
            const initialMsgs = await seedHasMore();

            // Mock older messages
            const olderMsgs = [createMessage({clientId: 'older-1'}), createMessage({clientId: 'older-2'})];
            mockApi.fetchOlderMessages.mockResolvedValueOnce(olderMsgs);

            const result = await repo.loadMore('s1');

            expect(mockApi.fetchOlderMessages).toHaveBeenCalledWith('s1', undefined);
            expect(result).toEqual([...olderMsgs, ...initialMsgs]);
            expect(repo.getSessionState('s1').messages).toEqual([...olderMsgs, ...initialMsgs]);
        });

        it('sets isLoadingMore=true during API call', async () => {
            await seedHasMore();

            // Track state changes
            const states: boolean[] = [];
            repo.subscribe('s1', (data) => { states.push(data.isLoadingMore); });

            let resolveApi: (v: Message[]) => void;
            const apiPromise = new Promise<Message[]>((resolve) => { resolveApi = resolve; });
            mockApi.fetchOlderMessages.mockReturnValueOnce(apiPromise);

            const loadPromise = repo.loadMore('s1');
            // isLoadingMore should be true now
            expect(states).toContain(true);

            resolveApi!([createMessage()]);
            await loadPromise;

            // isLoadingMore should be false after completion
            expect(states[states.length - 1]).toBe(false);
        });

        it('prevents concurrent loadMore calls (dedup)', async () => {
            await seedHasMore();

            // Create a deferred API call
            let resolveApi!: (v: Message[]) => void;
            const apiPromise = new Promise<Message[]>((resolve) => { resolveApi = resolve; });
            mockApi.fetchOlderMessages.mockReturnValueOnce(apiPromise);

            // Start two concurrent loadMore calls
            const p1 = repo.loadMore('s1');
            const p2 = repo.loadMore('s1');

            // Only one API call should be made
            expect(mockApi.fetchOlderMessages).toHaveBeenCalledTimes(1);

            resolveApi([createMessage()]);
            await Promise.all([p1, p2]);
        });

        it('resets isLoadingMore=false on API failure', async () => {
            const msgs = await seedHasMore();

            mockApi.fetchOlderMessages.mockRejectedValueOnce(new Error('timeout'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await repo.loadMore('s1');

            expect(repo.getSessionState('s1').isLoadingMore).toBe(false);
            expect(result).toEqual(msgs); // returns current messages on failure
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('sets hasMore=false when older messages < PAGE_SIZE', async () => {
            await seedHasMore();

            // Return fewer than PAGE_SIZE older messages
            mockApi.fetchOlderMessages.mockResolvedValueOnce([createMessage()]);

            await repo.loadMore('s1');

            expect(repo.getSessionState('s1').hasMore).toBe(false);
        });

        it('keeps hasMore=true when older messages === PAGE_SIZE', async () => {
            await seedHasMore();

            const olderMsgs = Array.from({length: PAGE_SIZE}, (_, i) =>
                createMessage({clientId: `older-${i}`}),
            );
            mockApi.fetchOlderMessages.mockResolvedValueOnce(olderMsgs);

            await repo.loadMore('s1');

            expect(repo.getSessionState('s1').hasMore).toBe(true);
        });

        it('notifies subscribers during loadMore lifecycle', async () => {
            await seedHasMore();

            const cb = vi.fn();
            repo.subscribe('s1', cb);
            cb.mockClear();

            mockApi.fetchOlderMessages.mockResolvedValueOnce([createMessage()]);
            await repo.loadMore('s1');

            // Should have been called at least twice: loading=true and loading=false
            expect(cb.mock.calls.length).toBeGreaterThanOrEqual(2);

            // First call: isLoadingMore=true
            expect(cb.mock.calls[0][0].isLoadingMore).toBe(true);

            // Last call: isLoadingMore=false
            const lastCall = cb.mock.calls[cb.mock.calls.length - 1][0];
            expect(lastCall.isLoadingMore).toBe(false);
        });

        it('allows new loadMore after previous one completes', async () => {
            const msgs = await seedHasMore();

            // First loadMore
            mockApi.fetchOlderMessages.mockResolvedValueOnce(msgs); // PAGE_SIZE to keep hasMore=true
            await repo.loadMore('s1');

            // Second loadMore should work
            mockApi.fetchOlderMessages.mockResolvedValueOnce([createMessage()]);
            await repo.loadMore('s1');

            expect(mockApi.fetchOlderMessages).toHaveBeenCalledTimes(2);
        });

        it('passes oldest cursor to API', async () => {
            await seedHasMore();

            // Set a cursor (format: "${timestamp}|${clientId}")
            const cursor = '1234567890|msg-001';
            repo.setOldestOffset('s1', cursor);

            mockApi.fetchOlderMessages.mockResolvedValueOnce([]);
            await repo.loadMore('s1');

            expect(mockApi.fetchOlderMessages).toHaveBeenCalledWith('s1', cursor);
        });
    });

    // ── Cursor management ──

    describe('cursor management', () => {
        it('getOldestOffset returns undefined for uninitialized session', () => {
            expect(repo.getOldestOffset('unknown')).toBeUndefined();
        });

        it('setOldestOffset and getOldestOffset work correctly', () => {
            const cursor = '1234567890|msg-001';
            repo.setOldestOffset('s1', cursor);
            expect(repo.getOldestOffset('s1')).toBe(cursor);
        });

        it('evictSession clears cursor', () => {
            const cursor = '1234567890|msg-001';
            repo.setOldestOffset('s1', cursor);
            repo.evictSession('s1');
            expect(repo.getOldestOffset('s1')).toBeUndefined();
        });
    });

    // ── Multi-session isolation ──

    describe('multi-session isolation', () => {
        it('operations on one session do not affect another', () => {
            repo.updateMessages('s1', [createMessage({clientId: 's1'})]);
            repo.updateMessages('s2', [createMessage({clientId: 's2'})]);

            expect(repo.getSessionState('s1').messages).toHaveLength(1);
            expect(repo.getSessionState('s1').messages[0].clientId).toBe('s1');
            expect(repo.getSessionState('s2').messages).toHaveLength(1);
            expect(repo.getSessionState('s2').messages[0].clientId).toBe('s2');
        });

        it('subscribers only receive notifications for their session', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            repo.subscribe('s1', cb1);
            repo.subscribe('s2', cb2);
            cb1.mockClear();
            cb2.mockClear();

            repo.updateMessages('s1', [createMessage()]);

            expect(cb1).toHaveBeenCalledOnce();
            expect(cb2).not.toHaveBeenCalled();
        });

        it('evicting one session does not affect subscribers of another', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            repo.subscribe('s1', cb1);
            repo.subscribe('s2', cb2);
            cb1.mockClear();
            cb2.mockClear();

            repo.evictSession('s1');
            repo.updateMessages('s2', [createMessage()]);

            expect(cb1).not.toHaveBeenCalled(); // evicted
            expect(cb2).toHaveBeenCalledOnce(); // still active
        });
    });
});
