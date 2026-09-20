/**
 * RTC Tool Call Card Component
 *
 * Renders a toolcall_input + toolcall_output pair as a single card.
 *
 * Layout (matches Claude Code style):
 *   .timeline-item (position: relative, with dot + vertical line)
 *     ├── .timeline-dot          (absolute, colored by status)
 *     ├── ::before               (vertical line)
 *     └── .timeline-content
 *           └── .toolcall-card
 *                 ├── .toolcall-header   — tool name
 *                 ├── .toolcall-section.in  — input parameters
 *                 └── .toolcall-section.out — output result (when available)
 *
 * Dot color states (via host data attribute):
 *   - "running" — orange pulse (waiting for output)
 *   - "done"    — green static (output received)
 *
 * @element rtc-toolcall-card
 * @csspart dot     - The timeline dot
 * @csspart card    - The card container
 * @csspart header  - Tool name header
 * @csspart in      - Input section
 * @csspart out     - Output section
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {classMap} from 'lit/directives/class-map.js';
import {styles} from './rtc-toolcall-card.styles.js';
import type {Message} from '../../types/index.js';
import {copyToClipboard} from '../../utils/clipboard.js';
import {formatTimestampCompact} from '../../utils/format.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('RtcToolCallCard');

/**
 * A paired tool call: input is always present, output arrives later.
 */
export interface ToolCallPair {
    input: Message;
    output?: Message;
}

/**
 * Parsed tool call data from the message content.
 */
interface ToolCallData {
    id: string;
    tool_name: string;
    input: unknown;
    output?: string;
    status?: string;
}

/**
 * Parse tool call data from a Message's content.
 *
 * Handles both shapes of content.data:
 *   1. Already an object:  { id, tool_name, input, output?, status? }
 *   2. JSON string:        '{"id":"...","tool_name":"ls",...}'
 */
function parseToolCallData(message: Message): ToolCallData | null {
    try {
        const data = message.content?.data;
        if (!data) return null;

        // Case 1: data is already an object with tool_name
        if (typeof data === 'object' && !Array.isArray(data) && 'tool_name' in (data as object)) {
            return data as ToolCallData;
        }

        // Case 2: data is a JSON string — parse it
        const raw = typeof data === 'string' ? data : JSON.stringify(data);
        const parsed = JSON.parse(raw);

        // The parsed result might have the tool call fields at the top level,
        // or nested under a `data` key
        if (parsed?.tool_name) return parsed as ToolCallData;
        if (parsed?.data?.tool_name) return parsed.data as ToolCallData;

        return null;
    } catch {
        return null;
    }
}

/**
 * Parsed script tool input parameters.
 */
interface ScriptInput {
    title: string;
    action: 'eval' | 'run' | 'save';
    name?: string;
    code?: string;
}

/**
 * Parse script tool input from ToolCallData.
 */
function parseScriptInput(toolData: ToolCallData): ScriptInput | null {
    if (toolData.tool_name !== 'script') return null;
    try {
        let input: any;
        if (typeof toolData.input === 'string') {
            input = JSON.parse(toolData.input);
        } else if (typeof toolData.input === 'object' && toolData.input !== null) {
            input = toolData.input;
        } else {
            return null;
        }
        return {
            title: input.title || '',
            action: input.action || 'eval',
            name: input.name,
            code: input.code,
        };
    } catch {
        return null;
    }
}

/**
 * Try to parse a value as JSON and return pretty-printed result.
 * Falls back to the original string if parsing fails.
 *
 * Used to format `input` and `output` fields which are often JSON strings
 * like `"{}"` or `"{\"files\":[\"a\",\"b\"]}"`.
 */
function tryFormatJson(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return value;
        }
    }
    return JSON.stringify(value, null, 2);
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

@localized()
@customElement('rtc-toolcall-card')
export class RtcToolCallCard extends LitElement {
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

    @property({type: Object})
    pair: ToolCallPair = {input: {clientId: '', role: 'assistant', content: {type: 'text', data: ''}, timestamp: 0, syncStatus: 'synced'}};

    @property({type: Boolean, attribute: 'is-last'})
    isLast = false;

    connectedCallback() {
        super.connectedCallback();
        this._updateStatus();
    }

    updated(changed: Map<string, unknown>) {
        super.updated(changed);
        if (changed.has('pair')) {
            this._updateStatus();
        }
    }

    private _updateStatus() {
        const status = this.pair.output ? 'done' : 'running';
        this.setAttribute('data-toolcall-status', status);
    }

    /**
     * Formatted timestamp from the input message (computed on each render).
     */
    private get _formattedTimestamp(): string {
        return formatTimestampCompact(this.pair.input.timestamp);
    }

    /**
     * Get IN section copy text (input parameters)
     */
    private get _inCopyText(): string {
        const inData = parseToolCallData(this.pair.input);
        if (inData?.input != null) return tryFormatJson(inData.input);
        return '';
    }

    /**
     * Get OUT section copy text (output result)
     */
    private get _outCopyText(): string {
        const outData = this.pair.output ? parseToolCallData(this.pair.output) : null;
        if (outData?.output != null) return tryFormatJson(outData.output);
        return '';
    }

    private async _handleCopy(text: string) {
        if (!text) return;

        const success = await copyToClipboard(text);
        this.dispatchEvent(new CustomEvent('rtc-toast-requested', {
            bubbles: true,
            composed: true,
            detail: {
                message: success ? msg('已复制到剪贴板') : msg('复制失败'),
                type: success ? 'success' : 'error',
            },
        }));
    }

    /**
     * 复制工具调用内容（与 dot 点击对应）
     */
    private async _handleDotClick() {
        await this._handleCopy(this._outCopyText || this._inCopyText);
    }

    render() {
        void this._localeCtx.locale;
        const inData = parseToolCallData(this.pair.input);
        const hasOutput = !!this.pair.output;
        const toolName = inData?.tool_name ?? 'unknown';
        const toolCallId = inData?.id || this.pair.input.clientId || '';
        const headerColor = toolCallId ? idToColorVar(toolCallId) : '';

        const classes = {
            'timeline-item': true,
            'toolcall-card-item': true,
            success: this.isLast && hasOutput,
        };

        return html`
      <div class=${classMap(classes)}>
        <div
          class="timeline-dot"
          part="dot"
          data-timestamp=${this._formattedTimestamp}
          @click=${this._handleDotClick}
        ></div>
        <div class="timeline-content" part="content">
          <div class="toolcall-card" part="card">
            <div class="toolcall-header" part="header">
              <span class="toolcall-name" style=${headerColor ? `color: ${headerColor}` : ''}>${this._formatHeader(toolName, inData)}</span>
            </div>
            ${this._renderInputSection(toolName, inData)}
          </div>
        </div>
      </div>
    `;
    }

    /**
     * Format header text based on tool type.
     */
    private _formatHeader(toolName: string, toolData: ToolCallData | null): string {
        if (!toolData) return toolName;

        // Parse input params
        let input: any = {};
        try {
            const raw = toolData.input;
            if (typeof raw === 'string') input = JSON.parse(raw);
            else if (typeof raw === 'object' && raw !== null) input = raw;
        } catch { /* ignore */ }

        switch (toolName) {
            case 'script': {
                const title = input.title;
                return title ? `script ${title}` : 'script';
            }
            case 'read': {
                const path = input.path || '';
                return `read ${path}`;
            }
            case 'ls': {
                const path = input.path || '/';
                return `ls ${path}`;
            }
            case 'write': {
                const path = input.path || '';
                return `write ${path}`;
            }
            case 'grep': {
                const pattern = input.pattern || '';
                return `grep ${pattern}`;
            }
            case 'find': {
                const pattern = input.pattern || '';
                return `find ${pattern}`;
            }
            default:
                return toolName;
        }
    }

    /**
     * Render input section based on tool type.
     */
    private _renderInputSection(toolName: string, toolData: ToolCallData | null) {
        // read/ls/write/grep/find: header-only, no content section
        if (['read', 'ls', 'write', 'grep', 'find'].includes(toolName)) {
            return nothing;
        }

        // Script tool: render based on action
        if (toolName === 'script' && toolData) {
            return this._renderScriptInput(toolData);
        }

        // Default: show formatted JSON parameters
        const params = toolData?.input != null ? tryFormatJson(toolData.input) : '{}';
        return html`
          <div class="toolcall-section in" part="in">
            <span class="toolcall-label">In</span>
            <span class="toolcall-value" title=${params}>${params}</span>
            <button
              class="copy-btn"
              @click=${() => this._handleCopy(this._inCopyText)}
              title="Copy input"
            >⧉</button>
          </div>
        `;
    }

    /**
     * Render script tool input based on action type.
     */
    private _renderScriptInput(toolData: ToolCallData) {
        const script = parseScriptInput(toolData);
        if (!script) {
            // Fallback to default rendering
            const params = tryFormatJson(toolData.input);
            return html`
              <div class="toolcall-section in" part="in">
                <span class="toolcall-label">In</span>
                <span class="toolcall-value">${params}</span>
              </div>
            `;
        }

        // eval: show code only
        if (script.action === 'eval') {
            return html`
              <div class="toolcall-section in" part="in">
                <span class="toolcall-label">Code</span>
                <pre class="toolcall-code-block">${script.code || ''}</pre>
                <button
                  class="copy-btn"
                  @click=${() => this._handleCopy(script.code || '')}
                  title="Copy code"
                >⧉</button>
              </div>
            `;
        }

        // save: show name + code
        if (script.action === 'save') {
            return html`
              <div class="toolcall-section in" part="in">
                <div class="toolcall-script-meta">
                  <span class="toolcall-meta-label">Name</span>
                  <span class="toolcall-meta-value">${script.name || ''}</span>
                </div>
                <pre class="toolcall-code-block">${script.code || ''}</pre>
                <button
                  class="copy-btn"
                  @click=${() => this._handleCopy(script.code || '')}
                  title="Copy code"
                >⧉</button>
              </div>
            `;
        }

        // run: show name + action (no code)
        return html`
          <div class="toolcall-section in" part="in">
            <div class="toolcall-script-meta">
              <span class="toolcall-meta-label">Name</span>
              <span class="toolcall-meta-value">${script.name || ''}</span>
            </div>
            <div class="toolcall-script-meta">
              <span class="toolcall-meta-label">Action</span>
              <span class="toolcall-meta-value">${script.action}</span>
            </div>
          </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-toolcall-card': RtcToolCallCard;
    }
}
