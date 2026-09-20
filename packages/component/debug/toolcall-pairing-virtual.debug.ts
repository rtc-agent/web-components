/**
 * Debug: ToolCall Pairing + Virtual Scroll
 *
 * Tests the RenderableUnit transform layer between Repository and VirtualScroll.
 *
 * KEY DESIGN:
 *   Message[] (repository) → toRenderableUnits() → RenderableUnit[] → VirtualScroll
 *
 * VirtualScroll never sees toolcall_output as a separate item.
 * Output arrival = pair content update (in-place DOM update, no prepend/append).
 */
import { MessageVirtualScroll } from '../src/utils/message-virtual-scroll.js';
import type { Message } from '../src/types/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// RenderableUnit — the "万全之策"
// ═══════════════════════════════════════════════════════════════════════════

type RenderableUnit =
    | { kind: 'message'; id: string; message: Message }
    | { kind: 'toolcall-pair'; id: string; input: Message; output?: Message };

/**
 * Transform Message[] → RenderableUnit[]
 *
 * Rules:
 * - toolcall_input → create toolcall-pair unit (output filled if available)
 * - toolcall_output → skip (merged into pair via parentClientId)
 * - other messages → create message unit
 *
 * Pure function — no side effects, always deterministic.
 */
function toRenderableUnits(messages: Message[]): RenderableUnit[] {
    const units: RenderableUnit[] = [];
    const outputByParent = new Map<string, Message>();

    // Pass 1: collect all outputs
    for (const msg of messages) {
        if (msg.content?.type === 'toolcall_output' && msg.parentClientId) {
            outputByParent.set(msg.parentClientId, msg);
        }
    }

    // Pass 2: build units (skip outputs, merge into pairs)
    for (const msg of messages) {
        if (msg.content?.type === 'toolcall_input') {
            units.push({
                kind: 'toolcall-pair',
                id: msg.clientId,
                input: msg,
                output: outputByParent.get(msg.clientId),
            });
        } else if (msg.content?.type === 'toolcall_output') {
            // Skip — already collected in pass 1
        } else {
            units.push({
                kind: 'message',
                id: msg.clientId,
                message: msg,
            });
        }
    }

    return units;
}

// ═══════════════════════════════════════════════════════════════════════════
// Diff algorithm
// ═══════════════════════════════════════════════════════════════════════════

interface UnitsDiff {
    prepended: RenderableUnit[];
    appended: RenderableUnit[];
    updated: { id: string; unit: RenderableUnit }[];
}

function diffUnits(oldUnits: RenderableUnit[], newUnits: RenderableUnit[]): UnitsDiff {
    const result: UnitsDiff = { prepended: [], appended: [], updated: [] };

    if (oldUnits.length === 0) {
        result.appended = [...newUnits];
        return result;
    }

    const oldIdSet = new Set(oldUnits.map(u => u.id));
    const newIdSet = new Set(newUnits.map(u => u.id));

    // New IDs at head → prepended
    const firstOldId = oldUnits[0]?.id;
    const firstOldIdx = firstOldId ? newUnits.findIndex(u => u.id === firstOldId) : -1;
    if (firstOldIdx > 0) {
        result.prepended = newUnits.slice(0, firstOldIdx);
    }

    // New IDs at tail → appended
    const lastOldId = oldUnits[oldUnits.length - 1]?.id;
    const lastOldIdx = lastOldId ? newUnits.findIndex(u => u.id === lastOldId) : -1;
    if (lastOldIdx >= 0 && lastOldIdx < newUnits.length - 1) {
        result.appended = newUnits.slice(lastOldIdx + 1);
    }

    // Existing IDs with content changes → updated
    const oldById = new Map(oldUnits.map(u => [u.id, u]));
    for (const newUnit of newUnits) {
        const oldUnit = oldById.get(newUnit.id);
        if (!oldUnit) continue;

        // Only toolcall-pair can change (output arrives)
        if (newUnit.kind === 'toolcall-pair' && oldUnit.kind === 'toolcall-pair') {
            if (newUnit.output !== oldUnit.output) {
                result.updated.push({ id: newUnit.id, unit: newUnit });
            }
        }
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool call data types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parsed toolcall_input data.
 * Matches server protocol: ToolCall.input is a JSON STRING.
 */
interface ToolCallInputData {
    id: string;
    tool_name: string;
    input: string; // JSON string of tool-specific parameters
}

/**
 * Parsed toolcall_output data.
 * Matches server protocol: ToolCall.output is a JSON STRING.
 */
interface ToolCallOutputData {
    id: string;
    tool_name: string;
    input: string; // JSON string (echo of input)
    output: string; // Result text
    status: string; // 'done' | 'failed'
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock data generation
// ═══════════════════════════════════════════════════════════════════════════

let counter = 0;
function nextId(sessionId: number): string {
    return `s${sessionId}-msg-${String(counter++).padStart(4, '0')}`;
}

const TOOL_NAMES = ['ls', 'read', 'write', 'find', 'grep', 'script'] as const;

function randomToolInput(toolId: string): ToolCallInputData {
    const tool = TOOL_NAMES[Math.floor(Math.random() * TOOL_NAMES.length)];
    const inputs: Record<string, Record<string, unknown>> = {
        ls: { path: `/scenarios/${Math.random().toString(36).slice(2, 6)}` },
        read: { path: `/functions/${['INDEX', 'README', 'API'][Math.floor(Math.random() * 3)]}.md` },
        write: { path: `/notes/note-${Date.now()}.md`, content: `# Hello\n\nThis is a test note.` },
        find: { pattern: `*.${['ts', 'md', 'json'][Math.floor(Math.random() * 3)]}` },
        grep: { path: '/src', pattern: 'function', case_sensitive: false },
        script: { code: `const result = await fetch('/api/data')\nconsole.log('Done:', result.status)`, title: `Task ${Math.floor(Math.random() * 100)}` },
    };
    return { id: toolId, tool_name: tool, input: JSON.stringify(inputs[tool]) };
}

function toolOutputFor(input: ToolCallInputData): ToolCallOutputData {
    const outputs: Record<string, string> = {
        ls: JSON.stringify(['fortune-analysis.md', 'scenarios.json', 'test-data/']),
        read: `# Functions Index\n\n## Available Functions\n\n- list()\n- create()\n- update()`,
        write: 'File written successfully',
        find: JSON.stringify(['/src/index.ts', '/src/utils/format.ts', '/lib/types.ts']),
        grep: 'function formatDate(d: Date): string {\nfunction parseInput(raw: string) {',
        script: JSON.stringify({
            duration_ms: Math.floor(Math.random() * 500),
            logs: ['Starting execution...', 'Fetching data...', `Result: ${Math.floor(Math.random() * 100)} items`, 'Done.'],
        }),
    };
    return {
        id: input.id,
        tool_name: input.tool_name,
        input: input.input,
        output: outputs[input.tool_name] || 'OK',
        status: Math.random() > 0.1 ? 'completed' : 'failed',
    };
}

function makeTextMessage(sessionId: number): Message {
    const role = Math.random() > 0.5 ? 'user' as const : 'assistant' as const;
    const texts = [
        `Message #${counter} — The quick brown fox jumps over the lazy dog.`,
        `Message #${counter} — 这是一条中文测试消息。`,
        `Message #${counter} — Lorem ipsum dolor sit amet.`,
    ];
    return {
        clientId: nextId(sessionId),
        role,
        content: { type: 'text', data: texts[Math.floor(Math.random() * texts.length)] },
        timestamp: Date.now(),
        syncStatus: 'synced',
    };
}

function makeToolCallInput(sessionId: number): Message {
    const toolId = `toolu_${Math.random().toString(36).slice(2, 15)}`;
    const inputData = randomToolInput(toolId);
    return {
        clientId: nextId(sessionId),
        role: 'assistant',
        content: { type: 'toolcall_input', data: JSON.stringify(inputData) },
        timestamp: Date.now(),
        syncStatus: 'synced',
    };
}

function makeToolCallOutput(inputMsg: Message): Message {
    const inputData = JSON.parse(inputMsg.content.data as string) as ToolCallInputData;
    const outputData = toolOutputFor(inputData);
    return {
        clientId: nextId(0), // output gets its own id
        role: 'assistant',
        content: { type: 'toolcall_output', data: JSON.stringify(outputData) },
        timestamp: Date.now(),
        syncStatus: 'synced',
        parentClientId: inputMsg.clientId, // KEY: links output to input
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock repository
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_ID = 1;
const PAGE_SIZE = 30;

class MockRepository {
    private _allMessages: Message[] = [];
    private _fetchedTop = 0;
    private _fetchedBottom = 0;
    private _subscribers: ((messages: Message[]) => void)[] = [];

    get allMessages() { return this._allMessages; }

    subscribe(cb: (messages: Message[]) => void) {
        this._subscribers.push(cb);
        return () => { this._subscribers = this._subscribers.filter(s => s !== cb); };
    }

    private _notify() {
        for (const cb of this._subscribers) {
            cb([...this._allMessages]);
        }
    }

    async fetchInitial(): Promise<Message[]> {
        await new Promise(r => setTimeout(r, 100));
        this._fetchedBottom = this._allMessages.length;
        this._fetchedTop = Math.max(0, this._fetchedBottom - PAGE_SIZE);
        return this._allMessages.slice(this._fetchedTop, this._fetchedBottom);
    }

    async loadMoreBefore(boundaryId: string): Promise<Message[]> {
        const idx = this._allMessages.findIndex(m => m.clientId === boundaryId);
        if (idx <= 0) return [];
        const newTop = Math.max(0, idx - PAGE_SIZE);
        await new Promise(r => setTimeout(r, 200));
        this._fetchedTop = newTop;
        return this._allMessages.slice(newTop, idx);
    }

    append(msg: Message) {
        this._allMessages.push(msg);
        this._notify();
    }

    prependInitialMessages(messages: Message[]) {
        this._allMessages = [...messages, ...this._allMessages];
        this._fetchedBottom += messages.length;
        this._fetchedTop += messages.length;
        this._notify();
    }

    setInitialMessages(messages: Message[]) {
        this._allMessages = messages;
        this._fetchedTop = messages.length;
        this._fetchedBottom = messages.length;
        this._notify();
    }

    get hasMoreTop() { return this._fetchedTop > 0; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════

const logPanel = document.getElementById('log-panel')!;

function log(text: string, level: 'info' | 'success' | 'warn' | '' = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    logPanel.appendChild(entry);
    logPanel.scrollTop = logPanel.scrollHeight;
    // Keep max 50 entries
    while (logPanel.children.length > 50) {
        logPanel.removeChild(logPanel.firstChild!);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

function parseToolData(msg: Message): ToolCallInputData | ToolCallOutputData | null {
    try {
        const data = msg.content?.data;
        if (!data) return null;
        const raw = typeof data === 'string' ? data : JSON.stringify(data);
        return JSON.parse(raw);
    } catch { return null; }
}

function renderUnit(unit: RenderableUnit, _index: number): HTMLElement {
    if (unit.kind === 'toolcall-pair') {
        return renderToolCallCard(unit);
    }
    return renderMessage(unit.message);
}

function renderMessage(msg: Message): HTMLElement {
    const div = document.createElement('div');
    div.className = `msg ${msg.role}`;
    div.dataset.clientId = msg.clientId;

    const textContent = typeof msg.content?.data === 'string'
        ? msg.content.data
        : JSON.stringify(msg.content?.data);

    div.innerHTML = `
        <div class="msg-meta">${msg.role} · ${new Date(msg.timestamp).toLocaleTimeString()} · ${msg.clientId.slice(-8)}</div>
        <div>${textContent}</div>
    `;
    return div;
}

function renderToolCallCard(unit: { kind: 'toolcall-pair'; id: string; input: Message; output?: Message }): HTMLElement {
    const inputData = parseToolData(unit.input) as ToolCallInputData | null;
    const outputData = unit.output ? parseToolData(unit.output) as ToolCallOutputData | null : null;

    const toolName = inputData?.tool_name || 'unknown';
    const hasOutput = !!unit.output;
    const status = outputData?.status === 'failed' ? 'error' : (hasOutput ? 'done' : 'running');

    // Parse input JSON string to object for rendering
    let inputObj: Record<string, unknown> | null = null;
    if (inputData?.input) {
        try {
            inputObj = JSON.parse(inputData.input) as Record<string, unknown>;
        } catch {
            inputObj = null;
        }
    }

    // Build summary based on tool type
    const summary = buildSummary(toolName, inputObj || undefined, outputData?.output);

    const card = document.createElement('div');
    card.className = 'toolcall-card';
    card.dataset.clientId = unit.id;

    let bodyHtml = '';

    // Input section — parse JSON string for pretty display
    const inputDisplay = inputData?.input
        ? (() => {
            try {
                const parsed = JSON.parse(inputData.input);
                return JSON.stringify(parsed, null, 2);
            } catch {
                return inputData.input;
            }
        })()
        : '{}';

    bodyHtml += `
        <div class="toolcall-section">
            <div class="toolcall-section-label">IN</div>
            <div class="toolcall-section-content">${escapeHtml(inputDisplay)}</div>
        </div>
    `;

    // Output section (if available)
    if (hasOutput && outputData) {
        const outputDisplay = outputData.output || '';
        bodyHtml += `
            <div class="toolcall-section">
                <div class="toolcall-section-label">OUT</div>
                <div class="toolcall-section-content">${escapeHtml(outputDisplay)}</div>
            </div>
        `;
    }

    // Footer
    let footerHtml = '';
    if (hasOutput && outputData) {
        const durationMatch = outputData.output?.match(/"duration_ms":\s*(\d+)/);
        const duration = durationMatch ? `${durationMatch[1]}ms` : '';
        footerHtml = `
            <div class="toolcall-footer">
                <span>${outputData.status || 'completed'}</span>
                ${duration ? `<span>${duration}</span>` : ''}
            </div>
        `;
    } else {
        footerHtml = `
            <div class="toolcall-footer">
                <span style="color: #f59e0b;">Running...</span>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="toolcall-header">
            <div class="toolcall-dot ${status}"></div>
            <span class="toolcall-name">${toolName}</span>
            <span class="toolcall-summary">${escapeHtml(summary)}</span>
        </div>
        <div class="toolcall-body">${bodyHtml}</div>
        ${footerHtml}
    `;

    return card;
}

function buildSummary(toolName: string, input?: Record<string, unknown>, output?: string): string {
    if (!input) return '';
    switch (toolName) {
        case 'ls': return String(input.path || '/');
        case 'read': return String(input.path || '');
        case 'write': return `${input.mode || 'create'} ${input.path || ''}`;
        case 'find': return String(input.pattern || input.path || '');
        case 'grep': return `${input.path || ''} ${input.pattern || ''}`;
        case 'script': return String(input.title || '');
        default: return JSON.stringify(input).slice(0, 40);
    }
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════════════════
// Main controller
// ═══════════════════════════════════════════════════════════════════════════

const scrollContainer = document.getElementById('scroll-container')!;
const innerContainer = document.getElementById('inner-container')!;

const repository = new MockRepository();

// Current RenderableUnit[] — the transformed view
let currentUnits: RenderableUnit[] = [];

// Virtual scroll operates on RenderableUnit, NOT Message
const virtualScroll = new MessageVirtualScroll<RenderableUnit>({
    scrollContainer,
    innerContainer,
    renderItem: renderUnit,
    getItemId: (unit) => unit.id,
    onLoadMore: async (direction, boundary) => {
        if (direction === 'top') {
            if (!boundary.firstId) return [];
            log(`onLoadMore(top, firstId=${boundary.firstId?.slice(-8)})`, 'info');
            const messages = await repository.loadMoreBefore(boundary.firstId);
            if (messages.length === 0) {
                virtualScroll.setFullyLoaded('top', true);
                return [];
            }
            // Re-transform and prepend new units
            const newUnits = toRenderableUnits(messages);
            log(`  → loaded ${messages.length} messages → ${newUnits.length} units`, 'info');
            virtualScroll.setFullyLoaded('top', false);
            return newUnits;
        }
        return [];
    },
    preloadThreshold: 300,
    bufferMessages: 20,
    sliceInterval: 3000,
});

// Subscribe to repository changes
repository.subscribe((messages) => {
    handleMessagesUpdate(messages);
});

/**
 * Core update handler — called whenever repository messages change.
 *
 * Flow:
 *   1. Transform messages → units
 *   2. Diff old units vs new units
 *   3. Apply changes to virtual scroll (prepend/append/update)
 */
function handleMessagesUpdate(messages: Message[]) {
    const newUnits = toRenderableUnits(messages);
    const diff = diffUnits(currentUnits, newUnits);

    const changes: string[] = [];
    if (diff.prepended.length > 0) changes.push(`prepend:${diff.prepended.length}`);
    if (diff.appended.length > 0) changes.push(`append:${diff.appended.length}`);
    if (diff.updated.length > 0) changes.push(`update:${diff.updated.length}`);

    if (changes.length > 0) {
        log(`handleMessagesUpdate: ${changes.join(', ')} (units: ${currentUnits.length} → ${newUnits.length})`, 'info');
    }

    // Apply prepends
    if (diff.prepended.length > 0) {
        virtualScroll.prependItems(diff.prepended);
    }

    // Apply appends
    if (diff.appended.length > 0) {
        virtualScroll.appendItems(diff.appended);
    }

    // Apply in-place updates (output arrived for existing pair)
    for (const { id, unit } of diff.updated) {
        updateUnitInDOM(id, unit);
    }

    currentUnits = newUnits;
    updateStats();
}

/**
 * In-place DOM update for a unit.
 * Finds the existing DOM element and re-renders it.
 */
function updateUnitInDOM(id: string, unit: RenderableUnit) {
    const existingEl = innerContainer.querySelector(`[data-client-id="${id}"]`) as HTMLElement | null;
    if (!existingEl) {
        log(`  updateUnitInDOM: element ${id.slice(-8)} not in DOM (sliced?), skipping`, 'warn');
        return;
    }

    log(`  updateUnitInDOM: updating ${id.slice(-8)} with output`, 'success');

    // Re-render: replace element content
    const newEl = renderUnit(unit, 0);
    // Preserve messageIndex for virtual scroll
    newEl.dataset.messageIndex = (existingEl as HTMLElement).dataset.messageIndex || '0';
    existingEl.replaceWith(newEl);
}

// ═══════════════════════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════════════════════

function updateStats() {
    const stats = virtualScroll.getStats();
    const totalMessages = repository.allMessages.length;
    const rendered = innerContainer.children.length;

    // Count pairs
    const totalPairs = currentUnits.filter(u => u.kind === 'toolcall-pair').length;
    const completePairs = currentUnits.filter(u => u.kind === 'toolcall-pair' && u.output).length;

    document.getElementById('stat-messages')!.textContent = String(totalMessages);
    document.getElementById('stat-units')!.textContent = String(currentUnits.length);
    document.getElementById('stat-rendered')!.textContent = String(rendered);
    document.getElementById('stat-pairs')!.textContent = `${completePairs}/${totalPairs}`;

    // Window from rendered elements
    const indices = Array.from(innerContainer.children)
        .map(el => parseInt((el as HTMLElement).dataset.messageIndex || '-1', 10))
        .filter(n => n >= 0);
    if (indices.length > 0) {
        const min = Math.min(...indices);
        const max = Math.max(...indices);
        document.getElementById('stat-window')!.textContent = `[${min}, ${max + 1})`;
    } else {
        document.getElementById('stat-window')!.textContent = '[0, 0)';
    }

    document.getElementById('stat-scrolltop')!.textContent = String(Math.round(scrollContainer.scrollTop));
    document.getElementById('stat-loaded')!.textContent = `T:${stats.loadedTop} B:${stats.loadedBottom}`;

    // Info label
    document.getElementById('info-label')!.textContent =
        `msgs:${totalMessages} units:${currentUnits.length} rendered:${rendered} pairs:${completePairs}/${totalPairs}`;
}

setInterval(updateStats, 200);

// ═══════════════════════════════════════════════════════════════════════════
// Button handlers
// ═══════════════════════════════════════════════════════════════════════════

// Init: generate a mix of text messages and toolcall pairs
document.getElementById('btn-init')!.addEventListener('click', async () => {
    counter = 0;
    virtualScroll.clear();
    currentUnits = [];

    const messages: Message[] = [];
    // 30 messages including 5 toolcall pairs
    for (let i = 0; i < 30; i++) {
        if (i % 6 === 3) {
            // Insert a toolcall pair (input + output)
            const input = makeToolCallInput(SESSION_ID);
            const output = makeToolCallOutput(input);
            messages.push(input);
            messages.push(output);
        } else {
            messages.push(makeTextMessage(SESSION_ID));
        }
    }

    repository.setInitialMessages(messages);
    const initialMessages = await repository.fetchInitial();
    const units = toRenderableUnits(initialMessages);
    currentUnits = units;
    virtualScroll.setItems(units);
    virtualScroll.scrollToBottom();

    log(`Init: ${messages.length} messages → ${units.length} units`, 'success');
    updateStats();
});

// Add a toolcall_input only (output comes later)
let pendingInput: Message | null = null;

document.getElementById('btn-add-input')!.addEventListener('click', () => {
    const input = makeToolCallInput(SESSION_ID);
    pendingInput = input;
    repository.append(input);
    log(`Added toolcall_input: ${input.clientId.slice(-8)} (tool: ${(JSON.parse(input.content.data as string)).tool_name})`, 'info');
    updateStats();
});

// Add matching output for the last input (simulates delayed response)
document.getElementById('btn-add-output')!.addEventListener('click', () => {
    if (!pendingInput) {
        log('No pending input! Click "Add toolcall_input" first.', 'warn');
        return;
    }

    // Simulate a delay
    setTimeout(() => {
        const output = makeToolCallOutput(pendingInput!);
        repository.append(output);
        const outData = JSON.parse(output.content.data as string) as ToolCallOutputData;
        log(`Added toolcall_output for ${pendingInput!.clientId.slice(-8)} (status: ${outData.status})`, 'success');
        pendingInput = null;
        updateStats();
    }, 1500);

    log('Output arriving in 1.5s...', 'warn');
});

// Add a complete pair (input + output together)
document.getElementById('btn-add-pair')!.addEventListener('click', () => {
    const input = makeToolCallInput(SESSION_ID);
    const output = makeToolCallOutput(input);
    repository.append(input);
    repository.append(output);
    log(`Added complete pair: ${input.clientId.slice(-8)} (${(JSON.parse(input.content.data as string)).tool_name})`, 'success');
    updateStats();
});

// Load more (older messages)
document.getElementById('btn-load-more')!.addEventListener('click', async () => {
    const stats = virtualScroll.getStats();
    if (!stats.firstId) return;
    log(`Loading more (top)...`, 'info');
    const olderMessages = await repository.loadMoreBefore(stats.firstId);
    if (olderMessages.length > 0) {
        const newUnits = toRenderableUnits(olderMessages);
        virtualScroll.prependItems(newUnits);
        currentUnits = [...newUnits, ...currentUnits];
        log(`  → prepended ${olderMessages.length} messages → ${newUnits.length} units`, 'info');
    } else {
        virtualScroll.setFullyLoaded('top', true);
        log('  → no more messages', 'warn');
    }
    updateStats();
});

// Append text message
document.getElementById('btn-append-text')!.addEventListener('click', () => {
    const msg = makeTextMessage(SESSION_ID);
    repository.append(msg);
    log(`Appended text: ${msg.clientId.slice(-8)}`, 'info');
    updateStats();
});

// Manual slice
document.getElementById('btn-slice')!.addEventListener('click', () => {
    log('Manual viewport slice...', 'warn');
    (virtualScroll as any)._sliceViewport();
    updateStats();
});

// Scroll
document.getElementById('btn-scroll-top')!.addEventListener('click', () => {
    scrollContainer.scrollTop = 0;
});

document.getElementById('btn-scroll-bottom')!.addEventListener('click', () => {
    virtualScroll.scrollToBottom();
});

// Clear
document.getElementById('btn-clear')!.addEventListener('click', () => {
    virtualScroll.clear();
    currentUnits = [];
    log('Cleared', 'warn');
    updateStats();
});

// ═══════════════════════════════════════════════════════════════════════════
// Scroll event logging (throttled)
// ═══════════════════════════════════════════════════════════════════════════

let scrollLogTimer: number | null = null;
scrollContainer.addEventListener('scroll', () => {
    if (scrollLogTimer) return;
    scrollLogTimer = window.setTimeout(() => {
        scrollLogTimer = null;
        updateStats();
    }, 500);
}, { passive: true });

// ═══════════════════════════════════════════════════════════════════════════
// Auto-init
// ═══════════════════════════════════════════════════════════════════════════

log('ToolCall Pairing + Virtual Scroll debug page loaded', 'info');
log('Click "Init" to start testing', '');
