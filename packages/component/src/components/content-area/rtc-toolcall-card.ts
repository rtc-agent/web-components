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
 *   - "error"   — red static (tool call failed)
 *
 * @element rtc-toolcall-card
 * @csspart dot     - The timeline dot
 * @csspart card    - The card container
 * @csspart header  - Tool name header
 * @csspart in      - Input section
 * @csspart out     - Output section
 */
import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg, str } from '@lit/localize';
import {
  localeContext,
  type LocaleContextValue,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { classMap } from 'lit/directives/class-map.js';
import { styles } from './rtc-toolcall-card.styles.js';
import type { Message } from '../../types/index.js';
import { copyToClipboard } from '../../utils/clipboard.js';
import { formatTimestampCompact } from '../../utils/format.js';
import { createLogger, TodoStatus } from '@rtc-agent/protocol';
import './rtc-scroll-container.js';

const log = createLogger('ToolCallCard');

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
  error?: string;
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
    if (
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'tool_name' in (data as object)
    ) {
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
 * Parsed todo item from todoWrite tool input.
 */
interface TodoItem {
  content: string;
  status: TodoStatus;
  active_form?: string;
}

/**
 * Parse todoWrite tool input from ToolCallData.
 */
function parseTodoWriteInput(toolData: ToolCallData): TodoItem[] | null {
  if (toolData.tool_name !== 'todoWrite') return null;
  try {
    let raw: unknown;
    if (typeof toolData.input === 'string') {
      raw = JSON.parse(toolData.input);
    } else if (typeof toolData.input === 'object' && toolData.input !== null) {
      raw = toolData.input;
    } else {
      return null;
    }
    const input = raw as Record<string, unknown>;
    const todos = input.todos as TodoItem[] | undefined;
    return Array.isArray(todos) ? todos : null;
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
  params?: Record<string, unknown>;
}

/**
 * Parse script tool input from ToolCallData.
 */
function parseScriptInput(toolData: ToolCallData): ScriptInput | null {
  if (toolData.tool_name !== 'script') return null;
  try {
    let raw: unknown;
    if (typeof toolData.input === 'string') {
      raw = JSON.parse(toolData.input);
    } else if (typeof toolData.input === 'object' && toolData.input !== null) {
      raw = toolData.input;
    } else {
      return null;
    }
    const input = raw as Record<string, unknown>;
    return {
      title: (input.title as string) || '',
      action: ((input.action as string) || 'eval') as ScriptInput['action'],
      name: input.name as string | undefined,
      code: input.code as string | undefined,
      params: input.params as Record<string, unknown> | undefined,
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

  @consume({ context: localeContext, subscribe: true })
  @state()
  private _localeCtx: LocaleContextValue = {
    locale: sourceLocale,
    setLocale: async () => {
      log.warn('Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  @property({ type: Object })
  pair: ToolCallPair = {
    input: {
      clientId: '',
      role: 'assistant',
      content: { type: 'text', data: '' },
      timestamp: 0,
      syncStatus: 'synced',
    },
  };

  @property({ type: Boolean, attribute: 'is-last' })
  isLast = false;

  firstUpdated() {
    // Set initial data attribute after first render.
    // Using firstUpdated instead of connectedCallback ensures this runs once
    // (not on every reconnect) and after the shadow DOM is ready.
    this._updateStatus();
  }

  updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has('pair')) {
      this._updateStatus();
    }
  }

  private _updateStatus() {
    const output = this.pair.output;
    const inData = parseToolCallData(this.pair.input);
    const hasError = !!inData?.error || output?.content?.type === 'error';

    let status: string;
    if (hasError) {
      status = 'error';
    } else if (output) {
      status = 'done';
    } else {
      status = 'running';
    }
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
    if (!inData) return '';

    // todoWrite: render as task list text (matches visual rendering)
    if (inData.tool_name === 'todoWrite') {
      const todos = parseTodoWriteInput(inData);
      if (todos && todos.length > 0) {
        return todos
          .map((todo) => {
            const icon =
              todo.status === 'completed'
                ? '✓'
                : todo.status === 'in_progress'
                  ? '●'
                  : '○';
            return `${icon} ${todo.content}`;
          })
          .join('\n');
      }
    }

    // default: formatted JSON
    if (inData?.input != null) return tryFormatJson(inData.input);
    return '';
  }

  private async _handleCopy(text: string) {
    if (!text) return;

    const success = await copyToClipboard(text);
    this.dispatchEvent(
      new CustomEvent('rtc-toast-requested', {
        bubbles: true,
        composed: true,
        detail: {
          message: success ? msg('已复制到剪贴板') : msg('复制失败'),
          type: success ? 'success' : 'error',
        },
      }),
    );
  }

  /**
   * Copy tool call content (corresponds to dot click).
   * Input card's dot should copy input content (render-what-you-see principle).
   */
  private async _handleDotClick() {
    await this._handleCopy(this._inCopyText);
  }

  render() {
    void this._localeCtx.locale;
    const inData = parseToolCallData(this.pair.input);
    const hasOutput = !!this.pair.output;
    const hasError = !!inData?.error || this.pair.output?.content?.type === 'error';
    const toolName = inData?.tool_name ?? 'unknown';
    const toolCallId = inData?.id || this.pair.input.clientId || '';
    const headerColor = toolCallId ? idToColorVar(toolCallId) : '';

    const classes = {
      'timeline-item': true,
      'toolcall-card-item': true,
      'has-error': hasError,
      success: this.isLast && hasOutput && !hasError,
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
              ${this._renderStatusIndicator(hasOutput, hasError)}
            </div>
            ${hasError ? this._renderErrorBlock(inData?.error || this._extractOutputError()) : nothing}
            ${this._renderInputSection(toolName, inData)}
            ${hasOutput && !hasError ? this._renderOutputSection() : nothing}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render status indicator (loading spinner, success check, or error icon).
   */
  private _renderStatusIndicator(hasOutput: boolean, hasError: boolean) {
    if (hasError) {
      return html`
        <span class="toolcall-status toolcall-status-error">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
          </svg>
        </span>
      `;
    }
    if (hasOutput) {
      return html`
        <span class="toolcall-status toolcall-status-success">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
          </svg>
        </span>
      `;
    }
    // Loading state
    return html`
      <span class="toolcall-status toolcall-status-loading">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="11 33" stroke-linecap="round"/>
        </svg>
      </span>
    `;
  }

  /**
   * Render error block when tool call fails.
   */
  private _renderErrorBlock(errorMessage?: string) {
    return html`
      <div class="toolcall-section toolcall-error" part="error">
        <div class="toolcall-error-header">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm9-3a1 1 0 1 1-2 0a1 1 0 0 1 2 0zM6.75 9.75A.75.75 0 0 1 7.5 9h1a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-.75.75h-1a.75.75 0 0 1-.75-.75v-2.5z"/>
          </svg>
          <span>${msg('工具执行失败')}</span>
        </div>
        ${errorMessage ? html`<pre class="toolcall-error-message">${errorMessage}</pre>` : nothing}
      </div>
    `;
  }

  /**
   * Extract error message from output if it's an error type.
   */
  private _extractOutputError(): string | undefined {
    const output = this.pair.output;
    if (output?.content?.type === 'error') {
      const data = output.content.data;
      if (typeof data === 'string') return data;
      if (typeof data === 'object' && data !== null) {
        return (data as Record<string, unknown>).message as string || JSON.stringify(data);
      }
    }
    return undefined;
  }

  /**
   * Render output section when tool call succeeds.
   */
  private _renderOutputSection() {
    const output = this.pair.output;
    if (!output) return nothing;

    const outputData = output.content?.data;
    const outputText = typeof outputData === 'string'
      ? outputData
      : JSON.stringify(outputData, null, 2);

    return html`
      <div class="toolcall-section out" part="out">
        <span class="toolcall-label">${msg('Out')}</span>
        <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-sm); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-lg);">
          <span class="toolcall-value" title=${outputText}>${outputText}</span>
        </rtc-scroll-container>
      </div>
    `;
  }

  /**
   * Format header text based on tool type.
   */
  private _formatHeader(
    toolName: string,
    toolData: ToolCallData | null,
  ): string {
    if (!toolData) return toolName;

    // Parse input params
    let input: Record<string, unknown> = {};
    try {
      const raw = toolData.input;
      if (typeof raw === 'string') input = JSON.parse(raw);
      else if (typeof raw === 'object' && raw !== null)
        input = raw as Record<string, unknown>;
    } catch {
      /* malformed JSON — input stays as {} */
    }

    switch (toolName) {
      case 'script': {
        const title = input.title as string | undefined;
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
      case 'todoWrite': {
        const todos = input.todos as unknown[] | undefined;
        const count = Array.isArray(todos) ? todos.length : 0;
        return msg(str`todoWrite (${count} tasks)`);
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

    // todoWrite: render as todo list
    if (toolName === 'todoWrite' && toolData) {
      return this._renderTodoWriteInput(toolData);
    }

    // Script tool: render based on action
    if (toolName === 'script' && toolData) {
      return this._renderScriptInput(toolData);
    }

    // Default: show formatted JSON parameters
    const params =
      toolData?.input != null ? tryFormatJson(toolData.input) : '{}';
    return html`
          <div class="toolcall-section in" part="in">
            <span class="toolcall-label">${msg('In')}</span>
            <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-sm); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-lg);">
              <span class="toolcall-value" title=${params}>${params}</span>
            </rtc-scroll-container>
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
                <span class="toolcall-label">${msg('In')}</span>
                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-sm); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-lg);">
                  <span class="toolcall-value">${params}</span>
                </rtc-scroll-container>
              </div>
            `;
    }

    // eval: show code only
    if (script.action === 'eval') {
      return html`
              <div class="toolcall-section in" part="in">
                <span class="toolcall-label">${msg('Code')}</span>
                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                  <pre class="toolcall-code-block">${script.code || ''}</pre>
                </rtc-scroll-container>
              </div>
            `;
    }

    // save: show name + code
    if (script.action === 'save') {
      return html`
              <div class="toolcall-section in" part="in">
                <div class="toolcall-script-meta">
                  <span class="toolcall-meta-label">${msg('Name')}</span>
                  <span class="toolcall-meta-value">${script.name || ''}</span>
                </div>
                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-md); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-xl);">
                  <pre class="toolcall-code-block">${script.code || ''}</pre>
                </rtc-scroll-container>
              </div>
            `;
    }

    // run: show name + action + params
    return html`
          <div class="toolcall-section in" part="in">
            <div class="toolcall-script-meta">
              <span class="toolcall-meta-label">${msg('Name')}</span>
              <span class="toolcall-meta-value">${script.name || ''}</span>
            </div>
            <div class="toolcall-script-meta">
              <span class="toolcall-meta-label">${msg('Action')}</span>
              <span class="toolcall-meta-value">${script.action}</span>
            </div>
            ${
              script.params
                ? html`
            <div class="toolcall-script-meta">
              <span class="toolcall-meta-label">${msg('Params')}</span>
              <span class="toolcall-meta-value">${JSON.stringify(script.params)}</span>
            </div>
            `
                : nothing
            }
          </div>
        `;
  }

  /**
   * Render todoWrite tool input as a todo list.
   */
  private _renderTodoWriteInput(toolData: ToolCallData) {
    const todos = parseTodoWriteInput(toolData);
    if (!todos || todos.length === 0) {
      // Fallback to default rendering
      const params = tryFormatJson(toolData.input);
      return html`
              <div class="toolcall-section in" part="in">
                <span class="toolcall-label">${msg('In')}</span>
                <rtc-scroll-container style="--rtc-scroll-max-height-locked: var(--rtc-content-height-sm); --rtc-scroll-max-height-unlocked: var(--rtc-content-height-lg);">
                  <span class="toolcall-value">${params}</span>
                </rtc-scroll-container>
              </div>
            `;
    }

    return html`
          <div class="toolcall-todo-list">
            ${todos.map((todo) => this._renderTodoItem(todo))}
          </div>
        `;
  }

  /**
   * Render a single todo item.
   */
  private _renderTodoItem(todo: TodoItem) {
    const status = todo.status || 'pending';
    const isCompleted = status === 'completed';
    const isInProgress = status === 'in_progress';

    const icon = isCompleted ? '✓' : isInProgress ? '●' : '○';
    const statusClass = `todo-item-${status}`;

    return html`
          <div class="toolcall-todo-item ${statusClass}">
            <span class="todo-icon">${icon}</span>
            <div class="todo-content">
              <span class="todo-text">${todo.content}</span>
              ${
                isInProgress && todo.active_form
                  ? html`
                <span class="todo-active-form">${todo.active_form}</span>
              `
                  : nothing
              }
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
