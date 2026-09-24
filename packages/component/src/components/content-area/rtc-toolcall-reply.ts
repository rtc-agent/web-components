/**
 * RTC Tool Call Reply Component
 *
 * Renders a toolcall_output as a standalone message with a clickable
 * reference header that links back to the originating toolcall_input.
 *
 * Design:
 * - Self-contained: extracts tool_name + input from output's own data
 * - On connect: finds the corresponding input card in DOM and updates its
 *   pair.output, so the card's dot switches from "running" to "done"
 * - Tool-specific output rendering (script: logs/warnings/errors + duration)
 * - Clickable header dispatches 'rtc-toolcall-jump' event with parentClientId
 *
 * @element rtc-toolcall-reply
 * @fires rtc-toolcall-jump — when header is clicked, detail: { targetClientId }
 * @csspart dot - The timeline dot
 * @csspart card - The reply card container
 * @csspart header - The clickable reference header
 * @csspart content - The output content area
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-toolcall-reply.styles.js';
import type {Message} from '../../types/index.js';
import {formatTimestampCompact} from '../../utils/format.js';
import type {RtcToolCallCard} from './rtc-toolcall-card.js';
import { createLogger } from '@rtc-agent/client';
import './rtc-scroll-container.js';

const log = createLogger('ToolCallReply');

/**
 * Parsed tool call data from output message.
 * Output's ToolCall includes tool_name + input (echoed from input message).
 */
interface OutputToolCallData {
    id: string;
    tool_name: string;
    input: string;  // JSON string (echoed from input)
    output: string; // JSON string or plain text
    status?: string;
}

/**
 * Parsed script tool output (ToolResult structure).
 */
interface ScriptOutputData {
    success: boolean;
    data?: {
        logs?: string[];
        warnings?: string[];
        errors?: string[];
        duration_ms?: number;
        result?: unknown;
        name?: string;
    };
    error?: string;
}

/**
 * Hash a string to an index (0-7) for color selection.
 * Uses a simple hash algorithm for consistent results.
 */
function hashToColorIndex(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % 8;
}

/**
 * Get a CSS variable name for the toolcall color based on ID.
 * Returns a CSS variable like `var(--rtc-color-toolcall-3)`.
 */
function idToColorVar(id: string): string {
    const index = hashToColorIndex(id);
    return `var(--rtc-color-toolcall-${index})`;
}

/**
 * Try to parse a string as JSON, handling double-serialization.
 * Returns the parsed value, or the original string if parsing fails.
 *
 * Examples:
 * - '"hello"' → 'hello' (single-serialized string)
 * - '"\"hello\""' → 'hello' (double-serialized string)
 * - '{"a":1}' → {a: 1} (JSON object)
 * - 'plain text' → 'plain text' (not JSON)
 */
function tryParseJson(value: string): unknown {
    try {
        let parsed = JSON.parse(value);
        // Handle double-serialization: if result is a string, try parsing again
        while (typeof parsed === 'string') {
            try {
                const next = JSON.parse(parsed);
                if (typeof next === 'string' && next === parsed) break; // No progress, stop
                parsed = next;
            } catch {
                break; // Not JSON, return current value
            }
        }
        return parsed;
    } catch {
        return value; // Not JSON, return as-is
    }
}

/**
 * Raw shape of a tool call as parsed from message content before type normalization.
 *
 * Used internally by `parseOutputToolCall` to safely navigate the parsed JSON
 * structure without `any` casts.
 */
interface RawToolCall {
    id?: string;
    tool_name?: string;
    input?: unknown;
    output?: unknown;
    status?: string;
    data?: RawToolCall;
}

/**
 * Parse tool call data from output message's content.
 */
function parseOutputToolCall(message: Message): OutputToolCallData | null {
    try {
        const data = message.content?.data;
        if (!data) return null;

        let raw: unknown;
        if (typeof data === 'string') {
            raw = JSON.parse(data);
            // Handle double-serialization
            if (typeof raw === 'string') {
                raw = JSON.parse(raw);
            }
        } else if (typeof data === 'object') {
            raw = data;
        } else {
            return null;
        }

        // Unwrap: if nested under .data, use that
        let tc = raw as RawToolCall;
        if (tc.data?.tool_name) {
            tc = tc.data;
        }
        if (!tc.tool_name) return null;

        // Parse input (handle double-serialization)
        let input: unknown = tc.input;
        if (typeof input === 'string') {
            try {
                input = JSON.parse(input);
                // Handle double-serialized input
                if (typeof input === 'string') {
                    try {
                        input = JSON.parse(input);
                    } catch {
                        // Keep the string as-is
                    }
                }
            } catch {
                // Keep the string as-is
            }
        }

        // Parse output (handle double-serialization)
        const rawOutput = tc.output;
        let output: string;
        if (typeof rawOutput === 'string') {
            const parsed = tryParseJson(rawOutput);
            // If it's a complex object, stringify it; otherwise keep as string
            if (typeof parsed === 'object' && parsed !== null) {
                output = JSON.stringify(parsed, null, 2);
            } else if (typeof parsed === 'string') {
                output = parsed;
            } else {
                output = String(parsed ?? '');
            }
        } else if (typeof rawOutput === 'object' && rawOutput !== null) {
            output = JSON.stringify(rawOutput, null, 2);
        } else {
            output = String(rawOutput ?? '');
        }

        return {
            id: tc.id || '',
            tool_name: tc.tool_name,
            input: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
            output,
            status: tc.status,
        };
    } catch {
        return null;
    }
}

/**
 * Parse script tool output.
 * Handles multiple formats:
 * 1. ToolResult wrapper: { success, data: { logs, warnings, errors, duration_ms } }
 * 2. Direct data: { logs, warnings, errors, duration_ms }
 * 3. Double-serialized JSON (string containing JSON string)
 *
 * Also handles logs/warnings/errors arrays containing JSON strings (each entry
 * is a serialized object that should be pretty-printed).
 */
function parseScriptOutput(outputStr: string): ScriptOutputData | null {
    try {
        let parsed = JSON.parse(outputStr);

        // Handle double-serialized JSON: if parsed is a string, try parsing again
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch {
                // Not double-serialized, continue with the string
                return null;
            }
        }

        if (typeof parsed !== 'object' || parsed === null) return null;

        // Format 1: ToolResult wrapper with 'success' field
        if ('success' in parsed) {
            // Normalize logs/warnings/errors: parse JSON strings and format them
            normalizeScriptData(parsed.data);
            return parsed as ScriptOutputData;
        }

        // Format 2: Direct data (no wrapper) — check if it has script-like fields
        if ('logs' in parsed || 'duration_ms' in parsed || 'warnings' in parsed || 'errors' in parsed) {
            const data = {
                logs: parsed.logs,
                warnings: parsed.warnings,
                errors: parsed.errors,
                duration_ms: parsed.duration_ms,
                result: parsed.result,
                name: parsed.name,
            };
            normalizeScriptData(data);
            return {
                success: true,
                data,
            };
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Normalize script output data: parse JSON strings in logs/warnings/errors arrays
 * and format them as pretty-printed JSON.
 */
function normalizeScriptData(data: ScriptOutputData['data'] | undefined): void {
    if (!data) return;

    // Helper to format a single log entry
    const formatEntry = (entry: unknown): string => {
        if (typeof entry !== 'string') {
            // Not a string, stringify it
            return JSON.stringify(entry, null, 2);
        }
        // Try to parse as JSON and pretty-print
        try {
            const parsed = JSON.parse(entry);
            if (typeof parsed === 'object' && parsed !== null) {
                return JSON.stringify(parsed, null, 2);
            }
            return entry;
        } catch {
            // Not JSON, return as-is
            return entry;
        }
    };

    // Normalize logs
    if (Array.isArray(data.logs)) {
        data.logs = data.logs.map(formatEntry);
    }

    // Normalize warnings
    if (Array.isArray(data.warnings)) {
        data.warnings = data.warnings.map(formatEntry);
    }

    // Normalize errors
    if (Array.isArray(data.errors)) {
        data.errors = data.errors.map(formatEntry);
    }
}

/**
 * Parse tool input params from echoed input JSON.
 */
function parseToolInput(inputStr: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(inputStr);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Format tool title for the reply header.
 */
function formatReplyTitle(toolName: string, inputStr: string): string {
    const input = parseToolInput(inputStr);

    switch (toolName) {
        case 'script': {
            const title = (input.title as string) || '';
            return title ? `script ${title}` : 'script';
        }
        case 'read': {
            const path = (input.path as string) || '';
            return `read ${path}`;
        }
        case 'ls': {
            const path = (input.path as string) || '/';
            return `ls ${path}`;
        }
        case 'write': {
            const path = (input.path as string) || '';
            return `write ${path}`;
        }
        case 'grep': {
            const pattern = (input.pattern as string) || '';
            return `grep ${pattern}`;
        }
        case 'find': {
            const pattern = (input.pattern as string) || '';
            return `find ${pattern}`;
        }
        default:
            return toolName;
    }
}

@localized()
@customElement('rtc-toolcall-reply')
export class RtcToolCallReply extends LitElement {
    static styles = styles;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /** The toolcall_output message */
    @property({type: Object})
    message!: Message;

    firstUpdated() {
        // Set initial status attribute after first render.
        this._updateStatus();
        // Notify the corresponding input card that output has arrived.
        // Using firstUpdated (instead of connectedCallback) ensures the input card
        // is already rendered in the DOM when we traverse to find it, preventing
        // a race condition where the card hasn't been mounted yet.
        this._notifyInputCard();
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);
        if (changed.has('message')) {
            this._updateStatus();
        }
    }

    private _updateStatus() {
        const tc = parseOutputToolCall(this.message);
        const status = tc?.status || 'completed';
        this.setAttribute('data-status', status);
    }

    /**
     * Find the corresponding input card in DOM and update its pair.output.
     * This switches the card's dot from "running" (orange pulse) to "done" (green).
     */
    private _notifyInputCard() {
        const parentClientId = this.message.parentClientId;
        if (!parentClientId) return;

        // Look for the input card in the same shadow root's scroll container
        const root = this.getRootNode() as ShadowRoot | Document;
        const card = root.querySelector(
            `rtc-toolcall-card[data-client-id="${parentClientId}"]`
        ) as RtcToolCallCard | null;

        if (card && card.pair && !card.pair.output) {
            card.pair = { ...card.pair, output: this.message };
        }
    }

    private get _formattedTimestamp(): string {
        return formatTimestampCompact(this.message.timestamp);
    }

    /**
     * Handle header click: dispatch jump event to scroll to input.
     */
    private _handleHeaderClick() {
        const targetClientId = this.message.parentClientId;
        if (!targetClientId) {
            log.warn('No parentClientId for jump');
            return;
        }

        this.dispatchEvent(new CustomEvent('rtc-toolcall-jump', {
            bubbles: true,
            composed: true,
            detail: { targetClientId },
        }));
    }

    render() {
        void this._localeCtx.locale;

        const tc = parseOutputToolCall(this.message);
        if (!tc) {
            return this._renderFallback();
        }

        // Script tool: structured output rendering
        if (tc.tool_name === 'script') {
            return this._renderScriptReply(tc);
        }

        // Read tool: file content with smaller max-height
        if (tc.tool_name === 'read') {
            return this._renderReadReply(tc);
        }

        // Default: generic output rendering
        return this._renderGenericReply(tc);
    }

    /**
     * Fallback: unparseable output rendered as plain text.
     */
    private _renderFallback() {
        return html`
            <div class="timeline-item">
                <div class="timeline-dot" part="dot" data-timestamp=${this._formattedTimestamp}></div>
                <div class="timeline-content" part="content">
                    <div class="reply-card" part="card">
                        <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                            <pre class="reply-content" part="content">${this.message.content?.data || ''}</pre>
                        </rtc-scroll-container>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Script tool reply: logs/warnings/errors sections + duration footer.
     */
    private _renderScriptReply(tc: OutputToolCallData) {
        const title = formatReplyTitle(tc.tool_name, tc.input);
        const headerColor = tc.id ? idToColorVar(tc.id) : '';
        const scriptOutput = parseScriptOutput(tc.output);

        // If not a structured ToolResult, fall back to generic
        if (!scriptOutput) {
            return this._renderGenericReply(tc);
        }

        const logs = scriptOutput.data?.logs || [];
        const warnings = scriptOutput.data?.warnings || [];
        const errors = scriptOutput.data?.errors || [];
        const durationMs = scriptOutput.data?.duration_ms;
        const isSuccess = scriptOutput.success !== false;
        const errorMsg = scriptOutput.error;

        return html`
            <div class="timeline-item">
                <div class="timeline-dot" part="dot" data-timestamp=${this._formattedTimestamp}></div>
                <div class="timeline-content" part="content">
                    <div class="reply-card" part="card">
                        <div
                            class="reply-header"
                            part="header"
                            @click=${this._handleHeaderClick}
                            title=${msg('点击跳转到工具调用')}
                        >
                            <span class="reply-tool-name" style=${headerColor ? `color: ${headerColor}` : ''}>${title}</span>
                            <span class="reply-status-dot"></span>
                        </div>

                        ${logs.length > 0 ? html`
                            <div class="reply-section">
                                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                                    <pre class="reply-content reply-logs">${logs.join('\n')}</pre>
                                </rtc-scroll-container>
                            </div>
                        ` : nothing}

                        ${warnings.length > 0 ? html`
                            <div class="reply-section">
                                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                                    <pre class="reply-content reply-warnings">${warnings.map(w => `[WARN] ${w}`).join('\n')}</pre>
                                </rtc-scroll-container>
                            </div>
                        ` : nothing}

                        ${errors.length > 0 ? html`
                            <div class="reply-section">
                                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                                    <pre class="reply-content reply-errors">${errors.map(e => `[ERR] ${e}`).join('\n')}</pre>
                                </rtc-scroll-container>
                            </div>
                        ` : nothing}

                        ${errorMsg ? html`
                            <div class="reply-section">
                                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                                    <pre class="reply-content reply-errors">${errorMsg}</pre>
                                </rtc-scroll-container>
                            </div>
                        ` : nothing}

                        ${logs.length === 0 && warnings.length === 0 && errors.length === 0 && !errorMsg ? html`
                            <div class="reply-section">
                                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                                    <pre class="reply-content reply-empty">${msg('(无输出)')}</pre>
                                </rtc-scroll-container>
                            </div>
                        ` : nothing}

                        <div class="reply-footer">
                            ${!isSuccess ? html`
                                <span class="reply-status-label reply-status-failed">${msg('Failed')}</span>
                            ` : nothing}
                            ${durationMs != null ? html`
                                <span class="reply-duration">${durationMs}ms</span>
                            ` : nothing}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Read tool reply: file content with smaller max-height.
     */
    private _renderReadReply(tc: OutputToolCallData) {
        const title = formatReplyTitle(tc.tool_name, tc.input);
        const headerColor = tc.id ? idToColorVar(tc.id) : '';
        // Output is plain text file content — display as-is
        const content = tc.output;

        return html`
            <div class="timeline-item">
                <div
                    class="timeline-dot"
                    part="dot"
                    data-timestamp=${this._formattedTimestamp}
                ></div>
                <div class="timeline-content" part="content">
                    <div class="reply-card reply-card-compact" part="card">
                        <div
                            class="reply-header"
                            part="header"
                            @click=${this._handleHeaderClick}
                            title=${msg('点击跳转到工具调用')}
                        >
                            <span class="reply-tool-name" style=${headerColor ? `color: ${headerColor}` : ''}>${title}</span>
                            <span class="reply-status-dot"></span>
                        </div>
                        <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-sm); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-lg);">
                            <pre class="reply-content" part="content">${content}</pre>
                        </rtc-scroll-container>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Generic tool reply: formatted output content.
     */
    private _renderGenericReply(tc: OutputToolCallData) {
        const title = formatReplyTitle(tc.tool_name, tc.input);
        const headerColor = tc.id ? idToColorVar(tc.id) : '';
        const outputFormatted = (() => {
            try {
                const parsed = JSON.parse(tc.output);
                return JSON.stringify(parsed, null, 2);
            } catch {
                return tc.output;
            }
        })();

        return html`
            <div class="timeline-item">
                <div
                    class="timeline-dot"
                    part="dot"
                    data-timestamp=${this._formattedTimestamp}
                ></div>
                <div class="timeline-content" part="content">
                    <div class="reply-card" part="card">
                        <div
                            class="reply-header"
                            part="header"
                            @click=${this._handleHeaderClick}
                            title=${msg('点击跳转到工具调用')}
                        >
                            <span class="reply-tool-name" style=${headerColor ? `color: ${headerColor}` : ''}>${title}</span>
                            <span class="reply-status-dot"></span>
                        </div>
                        <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                            <pre class="reply-content" part="content">${outputFormatted}</pre>
                        </rtc-scroll-container>
                    </div>
                </div>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-toolcall-reply': RtcToolCallReply;
    }
}
