/**
 * Debug page for rtc-message-list
 *
 * Sets up a standalone test environment with mock data,
 * bypassing the full rtc-agent component tree.
 */
import {MessageRepository} from '../src/repositories/index.js';
import type {Message, ContentData} from '../src/types/index.js';
import '../src/components/content-area/rtc-message-list.js';
import type {RtcMessageList} from '../src/components/content-area/rtc-message-list.js';

// ── Mock Data Generation ──

let messageCounter = 0;

function randomText(): string {
    const texts = [
        'Hello, this is a test message.',
        'The quick brown fox jumps over the lazy dog.',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
        'Ut enim ad minim veniam, quis nostrud exercitation ullamco.',
        'Duis aute irure dolor in reprehenderit in voluptate velit esse.',
        'Excepteur sint occaecat cupidatat non proident.',
        'Sunt in culpa qui officia deserunt mollit anim id est laborum.',
        'This is a longer message that might contain **markdown** formatting and `code` snippets.',
        '短消息：你好世界！',
        '这是一条中文测试消息，用来验证多语言渲染是否正常。',
        'Another message with some content to test scrolling behavior.',
    ];
    return texts[Math.floor(Math.random() * texts.length)];
}

function createMessage(role: 'user' | 'assistant' = 'assistant', offset = 0): Message {
    messageCounter++;
    const content: ContentData = {type: 'text', data: randomText()};
    return {
        clientId: `msg-${messageCounter}`,
        role,
        content,
        timestamp: Date.now() - offset * 1000,
        syncStatus: 'synced',
    };
}

function createBatchMessages(count: number, startOffset = 0): Message[] {
    const msgs: Message[] = [];
    for (let i = 0; i < count; i++) {
        const role = i % 3 === 0 ? 'user' : 'assistant';
        msgs.push(createMessage(role, startOffset + count - i));
    }
    return msgs;
}

// ── Mock MessageRepository ──
// We use the real MessageRepository with a mock API

const allMessages = new Map<string, Message[]>();
let globalOffset = 1000; // Simulate 1000 messages in history

const repository = new MessageRepository({
    fetchMessages: async (sessionId: string) => {
        console.log(`[Mock API] fetchMessages(${sessionId})`);
        // Simulate network delay
        await new Promise(r => setTimeout(r, 200));

        if (!allMessages.has(sessionId)) {
            // Initial load: return the latest 50 messages
            const msgs = createBatchMessages(50, 0);
            allMessages.set(sessionId, msgs);
        }
        return allMessages.get(sessionId)!.slice(-50);
    },
    fetchOlderMessages: async (sessionId: string, beforeOffset?: number) => {
        console.log(`[Mock API] fetchOlderMessages(${sessionId}, beforeOffset=${beforeOffset})`);
        // Simulate network delay
        await new Promise(r => setTimeout(r, 300));

        const existing = allMessages.get(sessionId) ?? [];
        // Generate older messages
        const olderMsgs = createBatchMessages(50, existing.length);
        // Prepend to the session's messages
        allMessages.set(sessionId, [...olderMsgs, ...existing]);
        globalOffset -= 50;

        return olderMsgs;
    },
});

// ── Mock MessageController (minimal) ──

class MockMessageController {
    private _repository = repository;

    get repository(): MessageRepository {
        return this._repository;
    }

    async fetchInitialMessages(sessionId: string): Promise<void> {
        const state = this._repository.getSessionState(sessionId);
        if (state.messages.length === 0) {
            await this._repository.fetchMessages(sessionId);
        }
    }

    async loadMoreForSession(sessionId: string): Promise<void> {
        await this._repository.loadMore(sessionId);
    }

    evictSession(sessionId: string): void {
        this._repository.evictSession(sessionId);
    }

    appendToLastMessage(sessionId: string, chunk: string): void {
        const state = this._repository.getSessionState(sessionId);
        if (state.messages.length === 0) return;
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        const newData = (last.content.data as string) + chunk;
        msgs[msgs.length - 1] = {
            ...last,
            content: {...last.content, data: newData},
            streaming: true,
        };
        this._repository.updateMessages(sessionId, msgs);
    }

    finalizeLastMessage(sessionId: string): void {
        const state = this._repository.getSessionState(sessionId);
        if (state.messages.length === 0) return;
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = {...last, streaming: false};
        this._repository.updateMessages(sessionId, msgs);
    }

    appendMessage(sessionId: string, message: Message): void {
        this._repository.appendMessage(sessionId, message);
    }
}

// ── Setup ──

const controller = new MockMessageController();
let currentSessionId = 'session-1';
let streamingInterval: number | null = null;

const messageList = document.getElementById('message-list') as RtcMessageList;
messageList.sessionId = currentSessionId;
messageList.messageController = controller as any;

// ── Status Bar Updates ──

function updateStats() {
    const state = repository.getSessionState(currentSessionId);
    document.getElementById('stat-repo')!.textContent = String(state.messages.length);
    document.getElementById('stat-hasmore')!.textContent = String(state.hasMore);
    document.getElementById('stat-loading')!.textContent = String(state.isLoadingMore);

    const scrollEl = messageList.shadowRoot?.querySelector('.message-list-scroll') as HTMLElement;
    if (scrollEl) {
        document.getElementById('stat-scrolltop')!.textContent = String(Math.round(scrollEl.scrollTop));
        document.getElementById('stat-scrollheight')!.textContent = String(scrollEl.scrollHeight);
    }

    const domMessages = messageList.shadowRoot?.querySelectorAll('[data-client-id]');
    document.getElementById('stat-dom')!.textContent = String(domMessages?.length ?? 0);
}

// Update stats periodically
setInterval(updateStats, 500);

// ── Button Handlers ──

document.getElementById('btn-load-initial')!.addEventListener('click', async () => {
    console.log('[Debug] Loading initial messages...');
    await controller.fetchInitialMessages(currentSessionId);
    updateStats();
});

document.getElementById('btn-load-more')!.addEventListener('click', async () => {
    console.log('[Debug] Loading more messages...');
    await controller.loadMoreForSession(currentSessionId);
    updateStats();
});

document.getElementById('btn-append')!.addEventListener('click', () => {
    const msg = createMessage(Math.random() > 0.5 ? 'user' : 'assistant');
    controller.appendMessage(currentSessionId, msg);
    console.log(`[Debug] Appended message: ${msg.clientId}`);
    updateStats();
});

document.getElementById('btn-streaming')!.addEventListener('click', () => {
    if (streamingInterval) return;
    // Create a streaming message
    const msg = createMessage('assistant');
    msg.streaming = true;
    msg.content = {type: 'text', data: ''};
    controller.appendMessage(currentSessionId, msg);
    console.log(`[Debug] Started streaming: ${msg.clientId}`);

    const chars = 'The quick brown fox jumps over the lazy dog. '.split('');
    let charIndex = 0;
    streamingInterval = window.setInterval(() => {
        if (charIndex < chars.length) {
            controller.appendToLastMessage(currentSessionId, chars[charIndex]);
            charIndex++;
        } else {
            controller.finalizeLastMessage(currentSessionId);
            if (streamingInterval) {
                clearInterval(streamingInterval);
                streamingInterval = null;
            }
            console.log(`[Debug] Streaming finished`);
        }
    }, 50);
});

document.getElementById('btn-stop-streaming')!.addEventListener('click', () => {
    if (streamingInterval) {
        clearInterval(streamingInterval);
        streamingInterval = null;
        controller.finalizeLastMessage(currentSessionId);
        console.log('[Debug] Streaming stopped');
    }
});

document.getElementById('btn-switch-session')!.addEventListener('click', () => {
    currentSessionId = currentSessionId === 'session-1' ? 'session-2' : 'session-1';
    messageList.sessionId = currentSessionId;
    document.getElementById('session-info')!.textContent = `Session: ${currentSessionId}`;
    console.log(`[Debug] Switched to ${currentSessionId}`);
    updateStats();
});

document.getElementById('btn-add-100')!.addEventListener('click', () => {
    const msgs = createBatchMessages(100, 0);
    for (const msg of msgs) {
        controller.appendMessage(currentSessionId, msg);
    }
    console.log(`[Debug] Added 100 messages`);
    updateStats();
});

document.getElementById('btn-clear')!.addEventListener('click', () => {
    allMessages.delete(currentSessionId);
    repository.updateMessages(currentSessionId, []);
    console.log(`[Debug] Cleared messages for ${currentSessionId}`);
    updateStats();
});

document.getElementById('btn-scroll-top')!.addEventListener('click', () => {
    const scrollEl = messageList.shadowRoot?.querySelector('.message-list-scroll') as HTMLElement;
    if (scrollEl) scrollEl.scrollTop = 0;
});

document.getElementById('btn-scroll-bottom')!.addEventListener('click', () => {
    messageList.scrollToBottom();
});

// ── Initial Load ──

console.log('[Debug] Page loaded, fetching initial messages...');
controller.fetchInitialMessages(currentSessionId).then(() => {
    console.log('[Debug] Initial messages loaded');
    updateStats();
});
