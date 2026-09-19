/**
 * Debug page for rtc-message-list — windowed rendering prototype
 *
 * This version implements windowed rendering directly in the debug page
 * to validate the approach before integrating into rtc-message-list.
 */
import {MessageRepository} from '../src/repositories/index.js';
import type {Message} from '../src/types/index.js';

// ── Mock Data Generation ──

const TOTAL_HISTORY = 500;
const PAGE_SIZE = 50;
const WINDOW_SIZE = 50; // Render only 50 messages at a time

const allHistory: Message[] = [];

function initHistory() {
    const now = Date.now();
    for (let i = 0; i < TOTAL_HISTORY; i++) {
        const role = i % 3 === 0 ? 'user' : 'assistant';
        const textOptions = [
            `Message #${i} — The quick brown fox jumps over the lazy dog.`,
            `Message #${i} — Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
            `Message #${i} — 这是一条中文测试消息，用来验证多语言渲染是否正常。`,
            `Message #${i} — Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
            `Message #${i} — **Bold** and \`code\` and *italic* formatting test.`,
            `Message #${i} — Ut enim ad minim veniam, quis nostrud exercitation ullamco.`,
        ];
        allHistory.push({
            clientId: `msg-${String(i).padStart(4, '0')}`,
            role,
            content: {type: 'text', data: textOptions[i % textOptions.length]},
            timestamp: now - (TOTAL_HISTORY - i) * 30_000,
            syncStatus: 'synced',
        });
    }
}
initHistory();

// ── Mock MessageRepository ──

const repository = new MessageRepository({
    fetchMessages: async (_sessionId: string) => {
        console.log(`[Mock API] fetchMessages → latest ${PAGE_SIZE} of ${TOTAL_HISTORY}`);
        await new Promise(r => setTimeout(r, 200));
        return allHistory.slice(-PAGE_SIZE);
    },
    fetchOlderMessages: async (_sessionId: string, beforeOffset?: number) => {
        const endIdx = beforeOffset !== undefined ? beforeOffset : TOTAL_HISTORY;
        const startIdx = Math.max(0, endIdx - PAGE_SIZE);
        console.log(`[Mock API] fetchOlderMessages(beforeOffset=${beforeOffset}) → [${startIdx}, ${endIdx})`);
        await new Promise(r => setTimeout(r, 300));
        return allHistory.slice(startIdx, endIdx);
    },
});

// ── Mock MessageController ──

class MockMessageController {
    private _repository = repository;

    get repository(): MessageRepository {
        return this._repository;
    }

    async fetchInitialMessages(sessionId: string): Promise<void> {
        const state = this._repository.getSessionState(sessionId);
        if (state.messages.length === 0) {
            await this._repository.fetchMessages(sessionId);
            const firstMsg = this._repository.getSessionState(sessionId).messages[0];
            if (firstMsg) {
                const idx = parseInt(firstMsg.clientId.replace('msg-', ''), 10);
                this._repository.setOldestOffset(sessionId, idx);
            }
        }
    }

    async loadMoreForSession(sessionId: string): Promise<void> {
        await this._repository.loadMore(sessionId);
        const msgs = this._repository.getSessionState(sessionId).messages;
        if (msgs.length > 0) {
            const idx = parseInt(msgs[0].clientId.replace('msg-', ''), 10);
            this._repository.setOldestOffset(sessionId, idx);
        }
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

// Windowed Rendering State ──

const controller = new MockMessageController();
let currentSessionId = 'session-1';
let streamingInterval: number | null = null;
let nextNewMsgIdx = TOTAL_HISTORY;

// Window state: indices into the repository's message array
let windowStart = 0;
let windowEnd = 0;

// Throttle for auto-loadMore
let isLoadingMore = false;
let lastLoadMoreTime = 0;
const LOAD_MORE_COOLDOWN = 1000; // 1s cooldown

// ── Custom Message List with Windowed Rendering ──

class WindowedMessageList extends HTMLElement {
    private _scrollEl: HTMLElement;
    private _innerEl: HTMLElement;
    private _messages: Message[] = [];
    private _subscription: {unsubscribe: () => void} | null = null;
    private _scrollHandler: (() => void) | null = null;

    constructor() {
        super();
        const shadow = this.attachShadow({mode: 'open'});
        shadow.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }
        .message-list-scroll {
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          padding: 16px;
        }
        .message-item {
          margin-bottom: 12px;
          padding: 12px;
          border-radius: 8px;
          background: #2a2a4a;
        }
        .message-item.user { background: #1e3a5f; }
        .message-item.assistant { background: #2a2a4a; }
        .message-meta {
          font-size: 11px;
          color: #888;
          margin-bottom: 4px;
        }
        .message-content {
          font-size: 14px;
          line-height: 1.5;
        }
      </style>
      <div class="message-list-scroll">
        <div class="message-list-inner"></div>
      </div>
    `;
        this._scrollEl = shadow.querySelector('.message-list-scroll')!;
        this._innerEl = shadow.querySelector('.message-list-inner')!;

        this._scrollHandler = () => this._handleScroll();
        this._scrollEl.addEventListener('scroll', this._scrollHandler);
    }

    set sessionId(id: string | null) {
        if (this._subscription) {
            this._subscription.unsubscribe();
            this._subscription = null;
        }
        if (id) {
            this._subscription = repository.subscribe(id, (data) => {
                this._messages = data.messages;
                this._adjustWindow();
                this._render();
            });
        }
    }

    set messageController(ctrl: any) {
        // No-op for now, just to match the API
    }

    private _adjustWindow() {
        const totalMessages = this._messages.length;
        if (totalMessages === 0) {
            windowStart = 0;
            windowEnd = 0;
            return;
        }

        // Initial: bottom-aligned window
        if (windowEnd === 0) {
            windowEnd = totalMessages;
            windowStart = Math.max(0, totalMessages - WINDOW_SIZE);
            return;
        }

        // New messages appended: if window was at bottom, extend to include new messages
        if (windowEnd >= totalMessages - 1 && totalMessages > windowEnd) {
            // Window was at bottom, extend to include new messages
            windowEnd = totalMessages;
            // Trim top to maintain WINDOW_SIZE
            windowStart = Math.max(0, windowEnd - WINDOW_SIZE);
        } else if (windowEnd > totalMessages) {
            // Window end exceeded total (shouldn't happen, but clamp)
            windowEnd = totalMessages;
            windowStart = Math.max(0, windowEnd - WINDOW_SIZE);
        }
        // Otherwise: window is not at bottom, don't auto-extend (user scrolled up)
    }

    private _handleScroll() {
        const {scrollTop, scrollHeight, clientHeight} = this._scrollEl;
        const isNearTop = scrollTop < 100;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
        const now = Date.now();

        console.log(`[Scroll] scrollTop=${scrollTop}, isNearTop=${isNearTop}, hasMore=${repository.getSessionState(currentSessionId).hasMore}, isLoading=${isLoadingMore}`);

        // Near top: auto-loadMore (with throttle)
        if (isNearTop && !isLoadingMore && now - lastLoadMoreTime > LOAD_MORE_COOLDOWN) {
            const state = repository.getSessionState(currentSessionId);
            console.log(`[Debug] Checking auto-loadMore: hasMore=${state.hasMore}`);
            if (state.hasMore) {
                isLoadingMore = true;
                lastLoadMoreTime = now;
                console.log('[Debug] Auto loadMore triggered (near top)');

                const scrollHeightBefore = this._scrollEl.scrollHeight;
                const messagesBefore = this._messages.length;

                controller.loadMoreForSession(currentSessionId).then(() => {
                    console.log(`[Debug] loadMore completed. messagesBefore=${messagesBefore}, _messages.length=${this._messages.length}`);
                    const messagesAfter = this._messages.length;
                    const prependedCount = messagesAfter - messagesBefore;
                    console.log(`[Debug] prependedCount=${prependedCount}`);

                    // Show the newly loaded messages at the top
                    windowStart = 0;
                    windowEnd = Math.min(WINDOW_SIZE, messagesAfter);
                    console.log(`[Debug] Window adjusted to show new messages: [${windowStart}, ${windowEnd})`);

                    // Scroll to top to show the new messages
                    this._scrollEl.scrollTop = 0;

                    this._render();
                    isLoadingMore = false;
                    updateStats();
                });
            }
        }

        // Near bottom: extend window downward + trim top (smooth append)
        if (isNearBottom && windowEnd < this._messages.length) {
            const extendBy = Math.min(20, this._messages.length - windowEnd);
            const newEnd = windowEnd + extendBy;
            const newStart = Math.max(0, newEnd - WINDOW_SIZE);

            // Only update if window actually changed
            if (newStart !== windowStart || newEnd !== windowEnd) {
                windowStart = newStart;
                windowEnd = newEnd;
                this._render();
            }
        }
    }

    private _render() {
        const visibleMessages = this._messages.slice(windowStart, windowEnd);

        this._innerEl.innerHTML = visibleMessages
            .map(
                (msg) => `
        <div class="message-item ${msg.role}" data-client-id="${msg.clientId}">
          <div class="message-meta">${msg.role} · ${new Date(msg.timestamp).toLocaleTimeString()}</div>
          <div class="message-content">${msg.content.data}</div>
        </div>
      `
            )
            .join('');
    }

    scrollToBottom() {
        this._scrollEl.scrollTop = this._scrollEl.scrollHeight;
    }
}

customElements.define('windowed-message-list', WindowedMessageList);

// ── Setup ──

const messageList = document.getElementById('message-list') as WindowedMessageList;
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
    const domCount = domMessages?.length ?? 0;
    document.getElementById('stat-dom')!.textContent = String(domCount);

    // Show window range
    if (domMessages && domMessages.length > 0) {
        const first = domMessages[0].getAttribute('data-client-id') ?? '?';
        const last = domMessages[domMessages.length - 1].getAttribute('data-client-id') ?? '?';
        document.getElementById('stat-window')!.textContent = `[${first} … ${last}] (${windowStart}-${windowEnd})`;
    } else {
        document.getElementById('stat-window')!.textContent = '[empty]';
    }

    // Color the DOM count red if it differs from repo count (windowing active)
    const domEl = document.getElementById('stat-dom')!;
    domEl.style.color = domCount < state.messages.length ? '#f72585' : '#4cc9f0';
}

setInterval(updateStats, 200);

// ── Button Handlers ──

document.getElementById('btn-load-initial')!.addEventListener('click', async () => {
    console.log('[Debug] Loading initial messages...');
    windowStart = 0;
    windowEnd = 0;
    await controller.fetchInitialMessages(currentSessionId);
    updateStats();
});

document.getElementById('btn-load-more')!.addEventListener('click', async () => {
    console.log('[Debug] Loading more messages...');
    // Record scroll height and window position before prepend
    const scrollEl = messageList.shadowRoot?.querySelector('.message-list-scroll') as HTMLElement;
    const scrollHeightBefore = scrollEl?.scrollHeight ?? 0;
    const messagesBefore = controller.repository.getSessionState(currentSessionId).messages.length;

    await controller.loadMoreForSession(currentSessionId);

    const messagesAfter = controller.repository.getSessionState(currentSessionId).messages.length;
    const prependedCount = messagesAfter - messagesBefore;

    // Adjust window indices: prepend shifted everything
    if (prependedCount > 0) {
        windowStart += prependedCount;
        windowEnd += prependedCount;
        console.log(`[Debug] Window adjusted: +${prependedCount} → [${windowStart}, ${windowEnd})`);
    }

    // After prepend, adjust scroll position to keep visual position
    if (scrollEl && scrollHeightBefore > 0) {
        const scrollHeightAfter = scrollEl.scrollHeight;
        const delta = scrollHeightAfter - scrollHeightBefore;
        scrollEl.scrollTop += delta;
        console.log(`[Debug] Scroll compensation: delta=${delta}`);
    }

    // Force re-render with adjusted window
    (messageList as any)._render();

    updateStats();
});

document.getElementById('btn-append')!.addEventListener('click', () => {
    const msg: Message = {
        clientId: `msg-${String(nextNewMsgIdx++).padStart(4, '0')}`,
        role: Math.random() > 0.5 ? 'user' : 'assistant',
        content: {type: 'text', data: `New message #${nextNewMsgIdx - 1} — ${Date.now()}`},
        timestamp: Date.now(),
        syncStatus: 'synced',
    };
    controller.appendMessage(currentSessionId, msg);
    console.log(`[Debug] Appended message: ${msg.clientId}`);
    updateStats();
});

document.getElementById('btn-streaming')!.addEventListener('click', () => {
    if (streamingInterval) return;
    const msg: Message = {
        clientId: `msg-${String(nextNewMsgIdx++).padStart(4, '0')}`,
        role: 'assistant',
        content: {type: 'text', data: ''},
        timestamp: Date.now(),
        streaming: true,
        syncStatus: 'synced',
    };
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
    windowStart = 0;
    windowEnd = 0;
    messageList.sessionId = currentSessionId;
    document.getElementById('session-info')!.textContent = `Session: ${currentSessionId}`;
    console.log(`[Debug] Switched to ${currentSessionId}`);
    updateStats();
});

document.getElementById('btn-add-100')!.addEventListener('click', () => {
    for (let i = 0; i < 100; i++) {
        const msg: Message = {
            clientId: `msg-${String(nextNewMsgIdx++).padStart(4, '0')}`,
            role: i % 3 === 0 ? 'user' : 'assistant',
            content: {type: 'text', data: `Bulk message #${nextNewMsgIdx - 1}`},
            timestamp: Date.now() - (100 - i) * 1000,
            syncStatus: 'synced',
        };
        controller.appendMessage(currentSessionId, msg);
    }
    console.log(`[Debug] Added 100 messages`);
    updateStats();
});

document.getElementById('btn-clear')!.addEventListener('click', () => {
    repository.updateMessages(currentSessionId, []);
    windowStart = 0;
    windowEnd = 0;
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
