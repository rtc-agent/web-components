/**
 * Debug page for MessageVirtualScroll component.
 *
 * Tests the virtual scrolling with viewport slicing + restore mechanism.
 * Inspired by Telegram Web's bubbles.ts + appMessagesManager pattern.
 *
 * KEY INSIGHT from Telegram:
 * - loadMoreHistory passes the BOUNDARY message ID (first/last rendered mid)
 * - getHistory1(maxId, reverse) loads messages adjacent to that ID
 * - Messages are served from CACHE (SlicedArray), not necessarily from API
 * - After viewport slice destroys messages, scrolling back re-renders from cache
 *
 * MULTI-INSTANCE SUPPORT:
 * - Multiple tabs, each with independent MessageVirtualScroll instance
 * - Non-active tabs use content-visibility: hidden for performance
 * - Each tab has its own message history, scroll position, and state
 */
import {MessageVirtualScroll} from '../src/utils/message-virtual-scroll.js';
import {CustomScrollbar} from '../src/utils/custom-scrollbar.js';
import type {Message} from '../src/types/index.js';

// ── Constants ──

const TOTAL_HISTORY = 500;
const PAGE_SIZE = 50;
const TAB_COUNT = 3;

// ── Mock Data Generation ──

function generateHistory(sessionId: number): Message[] {
    const history: Message[] = [];
    const now = Date.now();
    for (let i = 0; i < TOTAL_HISTORY; i++) {
        const role = i % 3 === 0 ? 'user' : 'assistant';
        const textOptions = [
            `[Session ${sessionId}] Message #${i} — The quick brown fox jumps over the lazy dog.`,
            `[Session ${sessionId}] Message #${i} — Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
            `[Session ${sessionId}] Message #${i} — 这是一条中文测试消息，用来验证多语言渲染是否正常。`,
            `[Session ${sessionId}] Message #${i} — Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
            `[Session ${sessionId}] Message #${i} — **Bold** and \`code\` and *italic* formatting test.`,
            `[Session ${sessionId}] Message #${i} — Ut enim ad minim veniam, quis nostrud exercitation ullamco.`,
        ];
        history.push({
            clientId: `s${sessionId}-msg-${String(i).padStart(4, '0')}`,
            role,
            content: {type: 'text', data: textOptions[i % textOptions.length]},
            timestamp: now - (TOTAL_HISTORY - i) * 30_000,
            syncStatus: 'synced',
        });
    }
    return history;
}

// ── Mock Repository (like Telegram's appMessagesManager) ──
//
// KEY INSIGHT: The repository is the SOURCE OF TRUTH.
// It holds ALL messages in memory (like Telegram's message cache).
// loadMoreTop/Bottom uses the BOUNDARY ID to find adjacent messages,
// just like Telegram's getHistory1(maxId, reverse).

class MockRepository {
    private _allHistory: Message[];
    /** Track how much has been "fetched" from the "API" */
    private _fetchedTop: number;    // index of oldest fetched message
    private _fetchedBottom: number; // index past newest fetched message

    constructor(allHistory: Message[]) {
        this._allHistory = allHistory;
        this._fetchedTop = allHistory.length;
        this._fetchedBottom = allHistory.length;
    }

    get allHistory() { return this._allHistory; }

    /** Find index of a message by its clientId */
    private _indexOf(id: string): number {
        return this._allHistory.findIndex(m => m.clientId === id);
    }

    /** Load initial window: latest PAGE_SIZE messages */
    async fetchInitial(): Promise<Message[]> {
        console.log('[Mock API] fetchInitial → latest', PAGE_SIZE);
        await new Promise(r => setTimeout(r, 200));
        this._fetchedBottom = this._allHistory.length;
        this._fetchedTop = Math.max(0, this._fetchedBottom - PAGE_SIZE);
        return this._allHistory.slice(this._fetchedTop, this._fetchedBottom);
    }

    /**
     * Load messages BEFORE the given boundary ID.
     * Mirrors Telegram's getHistory1(history[0], reverse=true).
     */
    async loadMoreBefore(boundaryId: string): Promise<Message[]> {
        const boundaryIdx = this._indexOf(boundaryId);
        if (boundaryIdx <= 0) {
            console.log(`[Mock API] loadMoreBefore(${boundaryId}) → at start, no more`);
            return [];
        }

        // Expand fetched range upward
        const newTop = Math.max(0, boundaryIdx - PAGE_SIZE);
        // But don't go beyond what we've already "fetched" from the "server"
        const actualTop = Math.max(newTop, 0);
        if (actualTop >= boundaryIdx) return [];

        console.log(`[Mock API] loadMoreBefore(${boundaryId}=@${boundaryIdx}) → [${actualTop}, ${boundaryIdx})`);
        await new Promise(r => setTimeout(r, 300));

        this._fetchedTop = Math.min(this._fetchedTop, actualTop);
        return this._allHistory.slice(actualTop, boundaryIdx);
    }

    /**
     * Load messages AFTER the given boundary ID.
     * Mirrors Telegram's getHistory1(history[last], reverse=false, isBackLimit=true).
     */
    async loadMoreAfter(boundaryId: string): Promise<Message[]> {
        const boundaryIdx = this._indexOf(boundaryId);
        if (boundaryIdx < 0 || boundaryIdx >= this._allHistory.length - 1) {
            console.log(`[Mock API] loadMoreAfter(${boundaryId}) → at end, no more`);
            return [];
        }

        // Expand fetched range downward
        const newBottom = Math.min(this._allHistory.length, boundaryIdx + 1 + PAGE_SIZE);
        if (newBottom <= boundaryIdx + 1) return [];

        console.log(`[Mock API] loadMoreAfter(${boundaryId}=@${boundaryIdx}) → [${boundaryIdx + 1}, ${newBottom})`);
        await new Promise(r => setTimeout(r, 300));

        this._fetchedBottom = Math.max(this._fetchedBottom, newBottom);
        return this._allHistory.slice(boundaryIdx + 1, newBottom);
    }

    /** Append a new message (incoming from real-time) */
    append(message: Message) {
        this._allHistory.push(message);
    }

    get hasMoreTop() { return this._fetchedTop > 0; }
    get hasMoreBottom() { return this._fetchedBottom < this._allHistory.length; }
}

// ── Tab Instance ──

interface TabInstance {
    sessionId: number;
    repository: MockRepository;
    virtualScroll: MessageVirtualScroll<Message>;
    customScrollbar: CustomScrollbar;
    scrollContainer: HTMLElement;
    innerContainer: HTMLElement;
    nextNewMsgIdx: number;
}

// ── Create Tab Instances ──

const tabs: TabInstance[] = [];

for (let i = 0; i < TAB_COUNT; i++) {
    const sessionId = i + 1;
    const history = generateHistory(sessionId);
    const repository = new MockRepository(history);

    const scrollContainer = document.getElementById(`scroll-container-${i}`)!;
    const innerContainer = document.getElementById(`inner-container-${i}`)!;

    // Initialize custom scrollbar
    const customScrollbar = new CustomScrollbar(scrollContainer);
    console.log(`[Debug] CustomScrollbar initialized for Session ${sessionId}`);

    // Create render function with variable heights
    function renderMessage(msg: Message, index: number): HTMLElement {
        const div = document.createElement('div');
        div.className = `message ${msg.role}`;
        div.dataset.messageId = msg.clientId;

        // Random initial height (50-300px)
        const initialHeight = 50 + Math.random() * 250;
        div.style.minHeight = `${initialHeight}px`;
        div.style.transition = 'min-height 0.3s ease';

        div.innerHTML = `
            <div class="message-meta">${msg.role} · ${new Date(msg.timestamp).toLocaleTimeString()} · Index: ${index} · ID: ${msg.clientId}</div>
            <div class="message-content">${msg.content.data}</div>
            <div class="message-height-indicator" style="font-size: 10px; color: #666; margin-top: 8px;">Height: ${Math.round(initialHeight)}px</div>
        `;

        // Schedule random height changes (0-10s)
        scheduleHeightChange(div);

        return div;
    }

    // Randomly change message height every 0-10 seconds
    function scheduleHeightChange(element: HTMLElement) {
        const delay = Math.random() * 10000; // 0-10s
        setTimeout(() => {
            if (!element.isConnected) return; // Element removed from DOM

            // New random height (50-300px)
            const newHeight = 50 + Math.random() * 250;
            element.style.minHeight = `${newHeight}px`;

            // Update indicator
            const indicator = element.querySelector('.message-height-indicator');
            if (indicator) {
                indicator.textContent = `Height: ${Math.round(newHeight)}px`;
            }

            // Schedule next change
            scheduleHeightChange(element);
        }, delay);
    }

    // Create virtual scroll instance
    const virtualScroll = new MessageVirtualScroll<Message>({
        scrollContainer,
        innerContainer,
        renderItem: renderMessage,
        getItemId: (msg) => msg.clientId,
        onLoadMore: async (direction, boundary) => {
            if (direction === 'top') {
                if (!boundary.firstId) return [];
                console.log(`[VirtualScroll-${sessionId}] onLoadMore(top, boundary.firstId=${boundary.firstId})`);
                const items = await repository.loadMoreBefore(boundary.firstId);
                virtualScroll.setFullyLoaded('top', items.length === 0);
                return items;
            } else {
                if (!boundary.lastId) return [];
                console.log(`[VirtualScroll-${sessionId}] onLoadMore(bottom, boundary.lastId=${boundary.lastId})`);
                const items = await repository.loadMoreAfter(boundary.lastId);
                virtualScroll.setFullyLoaded('bottom', items.length === 0);
                return items;
            }
        },
        preloadThreshold: 300, // Telegram uses onScrollOffset = 300
        bufferMessages: 20,
        sliceInterval: 3000,
        onSizeChange: () => customScrollbar.onSizeChange(),
    });

    tabs.push({
        sessionId,
        repository,
        virtualScroll,
        customScrollbar,
        scrollContainer,
        innerContainer,
        nextNewMsgIdx: TOTAL_HISTORY,
    });
}

// ── Active Tab Management ──

let activeTabIndex = 0;

function getActiveTab(): TabInstance {
    return tabs[activeTabIndex];
}

function switchTab(tabIndex: number) {
    if (tabIndex === activeTabIndex) return;

    const oldTab = tabs[activeTabIndex];
    const newTab = tabs[tabIndex];

    // Update tab buttons
    document.querySelectorAll('.tab').forEach((btn, idx) => {
        btn.classList.toggle('active', idx === tabIndex);
    });

    // Update tab content visibility
    document.querySelectorAll('.tab-content').forEach((content, idx) => {
        if (idx === tabIndex) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    // Update session info
    document.getElementById('session-info')!.textContent = `Active: Session ${newTab.sessionId}`;

    activeTabIndex = tabIndex;
    console.log(`[Debug] Switched to Session ${newTab.sessionId}`);

    // Update stats for new active tab
    updateStats();
}

// ── Status Bar Updates ──

function updateStats() {
    const tab = getActiveTab();
    const stats = tab.virtualScroll.getStats();
    const rendered = tab.innerContainer.children.length;
    document.getElementById('stat-repo')!.textContent =
        `fetched:[${tab.repository.allHistory.length}] window:[${stats.firstId ?? '?'}, ${stats.lastId ?? '?'}]`;
    document.getElementById('stat-rendered')!.textContent = String(rendered);

    // Estimate window from rendered elements
    const indices = Array.from(tab.innerContainer.children)
        .map(el => parseInt((el as HTMLElement).dataset.messageIndex || '-1', 10))
        .filter(n => n >= 0);

    if (indices.length > 0) {
        const min = Math.min(...indices);
        const max = Math.max(...indices);
        document.getElementById('stat-window')!.textContent = `[${min}, ${max + 1})`;
    } else {
        document.getElementById('stat-window')!.textContent = '[0, 0)';
    }

    document.getElementById('stat-scrolltop')!.textContent = String(Math.round(tab.scrollContainer.scrollTop));
    document.getElementById('stat-scrollheight')!.textContent = String(tab.scrollContainer.scrollHeight);
    document.getElementById('stat-loaded')!.textContent = `T:${stats.loadedTop} B:${stats.loadedBottom}`;
}

// Update stats periodically
setInterval(updateStats, 200);

// ── Tab Button Handlers ──

document.querySelectorAll('.tab').forEach((btn, idx) => {
    btn.addEventListener('click', () => switchTab(idx));
});

// ── Toolbar Button Handlers (operate on active tab) ──

document.getElementById('btn-load-initial')!.addEventListener('click', async () => {
    const tab = getActiveTab();
    console.log(`[Debug] Loading initial messages for Session ${tab.sessionId}...`);
    const messages = await tab.repository.fetchInitial();
    tab.virtualScroll.setItems(messages);
    tab.virtualScroll.scrollToBottom();
    updateStats();
});

document.getElementById('btn-load-more')!.addEventListener('click', async () => {
    const tab = getActiveTab();
    console.log(`[Debug] Manual load more (top) for Session ${tab.sessionId}...`);
    const stats = tab.virtualScroll.getStats();
    if (!stats.firstId) return;
    const olderMessages = await tab.repository.loadMoreBefore(stats.firstId);
    if (olderMessages.length > 0) {
        await tab.virtualScroll.prependItems(olderMessages);
        tab.virtualScroll.setFullyLoaded('top', false);
    } else {
        tab.virtualScroll.setFullyLoaded('top', true);
    }
    updateStats();
});

document.getElementById('btn-append')!.addEventListener('click', async () => {
    const tab = getActiveTab();
    const msg: Message = {
        clientId: `s${tab.sessionId}-msg-${String(tab.nextNewMsgIdx++).padStart(4, '0')}`,
        role: Math.random() > 0.5 ? 'user' : 'assistant',
        content: {type: 'text', data: `New message #${tab.nextNewMsgIdx - 1} — ${Date.now()}`},
        timestamp: Date.now(),
        syncStatus: 'synced',
    };
    tab.repository.append(msg);
    await tab.virtualScroll.appendItems([msg]);
    tab.virtualScroll.setFullyLoaded('bottom', false);
    console.log(`[Debug] Appended message to Session ${tab.sessionId}: ${msg.clientId}`);
    updateStats();
});

document.getElementById('btn-add-100')!.addEventListener('click', async () => {
    const tab = getActiveTab();
    const newMessages: Message[] = [];
    for (let i = 0; i < 100; i++) {
        const msg: Message = {
            clientId: `s${tab.sessionId}-msg-${String(tab.nextNewMsgIdx++).padStart(4, '0')}`,
            role: i % 3 === 0 ? 'user' : 'assistant',
            content: {type: 'text', data: `Bulk message #${tab.nextNewMsgIdx - 1}`},
            timestamp: Date.now() - (100 - i) * 1000,
            syncStatus: 'synced',
        };
        newMessages.push(msg);
    }
    for (const msg of newMessages) {
        tab.repository.append(msg);
    }
    await tab.virtualScroll.appendItems(newMessages);
    tab.virtualScroll.setFullyLoaded('bottom', false);
    console.log(`[Debug] Added 100 messages to Session ${tab.sessionId}`);
    updateStats();
});

document.getElementById('btn-clear')!.addEventListener('click', () => {
    const tab = getActiveTab();
    tab.virtualScroll.clear();
    console.log(`[Debug] Cleared Session ${tab.sessionId}`);
    updateStats();
});

document.getElementById('btn-scroll-top')!.addEventListener('click', () => {
    const tab = getActiveTab();
    tab.scrollContainer.scrollTop = 0;
});

document.getElementById('btn-scroll-bottom')!.addEventListener('click', () => {
    const tab = getActiveTab();
    tab.virtualScroll.scrollToBottom();
});

document.getElementById('btn-slice')!.addEventListener('click', () => {
    const tab = getActiveTab();
    console.log(`[Debug] Manual viewport slice for Session ${tab.sessionId}`);
    (tab.virtualScroll as any)._sliceViewport();
    updateStats();
});

// ── Initial Load for All Tabs ──

console.log('[Debug] Page loaded, initializing all sessions...');

// Load initial messages for all tabs (but only Session 1 is visible)
tabs.forEach(async (tab) => {
    const messages = await tab.repository.fetchInitial();
    tab.virtualScroll.setItems(messages);
    tab.virtualScroll.scrollToBottom();
    console.log(`[Debug] Session ${tab.sessionId} initial messages loaded`);
});

// Initial stats update
updateStats();
