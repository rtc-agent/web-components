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
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {styles} from './rtc-toolcall-card.styles.js';
import type {Message} from '../../types/index.js';
import {copyToClipboard} from '../../utils/clipboard.js';

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

@customElement('rtc-toolcall-card')
export class RtcToolCallCard extends LitElement {
    static styles = styles;

    @property({type: Object})
    pair: ToolCallPair = {input: {clientId: '', role: 'assistant', content: {type: 'text', data: ''}, timestamp: 0, syncStatus: 'synced'}};

    @property({type: Boolean, attribute: 'is-last'})
    isLast = false;

    @state()
    private _formattedTimestamp = '';

    connectedCallback() {
        super.connectedCallback();
        this._updateStatus();
        this._updateTimestamp();
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

    private _updateTimestamp() {
        const ts = this.pair.input.timestamp;
        if (!ts) return;
        const date = new Date(ts);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        this._formattedTimestamp = `${month}-${day} ${hours}:${minutes}`;
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
                message: success ? '已复制到剪贴板' : '复制失败',
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
        const inData = parseToolCallData(this.pair.input);
        const outData = this.pair.output ? parseToolCallData(this.pair.output) : null;
        const hasOutput = !!this.pair.output;
        const toolName = inData?.tool_name ?? 'unknown';
        const inParams = inData?.input != null ? tryFormatJson(inData.input) : '{}';

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
              <span class="toolcall-name">${toolName}</span>
            </div>

            <div class="toolcall-section in" part="in">
              <span class="toolcall-label">In</span>
              <span class="toolcall-value" title=${inParams}>${inParams}</span>
              <button
                class="copy-btn"
                @click=${() => this._handleCopy(this._inCopyText)}
                title="Copy input"
              >⧉</button>
            </div>

            ${hasOutput && outData?.output != null
                ? html`
              <div class="toolcall-section out" part="out">
                <span class="toolcall-label">Out</span>
                <div class="toolcall-output-content">${tryFormatJson(outData.output)}</div>
                <button
                  class="copy-btn"
                  @click=${() => this._handleCopy(this._outCopyText)}
                  title="Copy output"
                >⧉</button>
              </div>`
                : null}
          </div>
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
