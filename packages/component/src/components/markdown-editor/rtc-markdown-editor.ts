/**
 * Markdown Editor Component
 *
 * VS Code-style Markdown editor, supporting edit/preview/split three view modes.
 *
 * Layout (split mode):
 * ┌──────────────────┬───┬──────────────────┐
 * │  Edit Pane       │   │  Preview Pane    │
 * │  (textarea)      │   │  (marked render) │
 * │                  │   │                   │
 * └──────────────────┴───┴──────────────────┘
 *
 * Markdown parsing uses marked + DOMPurify (lazy-loaded, shared with rtc-message).
 *
 * @element rtc-markdown-editor
 *
 * @fires editor-content-change - Content changed (detail: { content: string })
 * @fires editor-cursor-move - Cursor moved (detail: { line: number, column: number })
 *
 * ## Styling
 * Uses project design tokens (--rtc-color-*), supports light/dark themes.
 */
import {LitElement, html} from 'lit';
import {customElement, property, state, query} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg, str} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-markdown-editor.styles.js';
import type {EditorViewMode} from '../../types/index.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('MarkdownEditor');

@localized()
@customElement('rtc-markdown-editor')
export class RtcMarkdownEditor extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** Current editing content */
    @property({type: String})
    content = '';

    /** View mode */
    @property({type: String, attribute: 'view-mode'})
    viewMode: EditorViewMode = 'split';

    /** Theme */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /** Whether read-only */
    @property({type: Boolean, attribute: 'read-only'})
    readOnly = false;

    /* ── Internal State ── */

    /** HTML rendered from Markdown */
    @state()
    private _renderedHtml = '';

    /** Cursor position */
    @state()
    private _cursorPosition = {line: 1, column: 1};

    /** Split divider position (percentage) */
    @state()
    private _splitPosition = 50;

    /** Whether the split divider is being dragged */
    @state()
    private _isDragging = false;

    /* ── Refs ── */

    @query('.editor-textarea')
    private _textarea!: HTMLTextAreaElement;

    @query('.split-container')
    private _splitContainer!: HTMLElement;

    /* ── Markdown Parsing ── */

    private _parseGeneration = 0;
    private _modulesPromise: Promise<{
        marked: typeof import('marked').marked;
        DOMPurify: typeof import('dompurify').default;
        hljs: typeof import('../../utils/highlight-languages.js').default;
    }> | null = null;

    /** Debounce timer */
    private _debounceTimer?: ReturnType<typeof setTimeout>;

    /**
     * Lazy-load marked + DOMPurify + highlight.js with retry logic.
     * Handles stale chunk errors during development (when rebuilds change chunk hashes).
     */
    private async _loadModules(attempts = 2): Promise<{
        marked: typeof import('marked').marked;
        DOMPurify: typeof import('dompurify').default;
        hljs: typeof import('../../utils/highlight-languages.js').default;
    }> {
        try {
            const [markedMod, dompurifyMod, hljsMod] = await Promise.all([
                import('marked'),
                import('dompurify'),
                import('../../utils/highlight-languages.js'),
            ]);
            return {
                marked: markedMod.marked,
                DOMPurify: dompurifyMod.default,
                hljs: hljsMod.default,
            };
        } catch (err) {
            // Dynamic import failed (likely stale chunk hash after rebuild)
            if (attempts > 0) {
                console.warn('[rtc-markdown-editor] Module load failed, retrying...', err);
                this._modulesPromise = null; // Clear cache to force fresh attempt
                return this._loadModules(attempts - 1);
            }
            console.error('[rtc-markdown-editor] Module load failed after retries:', err);
            throw err;
        }
    }

    private async _parseMarkdown() {
        const generation = ++this._parseGeneration;

        if (!this.content) {
            this._renderedHtml = '';
            return;
        }

        try {
            if (!this._modulesPromise) {
                this._modulesPromise = this._loadModules();
            }
            const {marked, DOMPurify, hljs} = await this._modulesPromise;

            // Parse Markdown
            const rawHtml = await marked.parse(this.content);

            // Check if generation is stale
            if (generation !== this._parseGeneration) {
                return;
            }

            // Apply syntax highlighting
            const highlighted = this._highlightCodeBlocks(rawHtml as string, hljs);

            // Sanitize
            const cleanHtml = DOMPurify.sanitize(highlighted, {
                ALLOWED_TAGS: [
                    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                    'p', 'br', 'hr',
                    'ul', 'ol', 'li',
                    'blockquote',
                    'code', 'pre',
                    'a', 'strong', 'em', 'del',
                    'table', 'thead', 'tbody', 'tr', 'th', 'td',
                    'img',
                    'input', // Task list checkbox
                    'span', // Required by highlight.js
                ],
                ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'class', 'type', 'checked', 'disabled', 'style'],
            });

            this._renderedHtml = cleanHtml;
        } catch (err) {
            log.error('Failed to parse markdown:', err);
            this._renderedHtml = `<p style="color: var(--rtc-color-error);">${msg(str`渲染失败: ${err instanceof Error ? err.message : String(err)}`)}</p>`;
        }
    }

    /**
     * Apply highlight.js syntax highlighting to all <pre><code> blocks in Markdown-rendered HTML
     */
    private _highlightCodeBlocks(html: string, hljs: typeof import('../../utils/highlight-languages.js').default): string {
        if (!html.includes('<pre>')) return html;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el as HTMLElement));
        return doc.body.innerHTML;
    }

    /* ── Lifecycle ── */

    willUpdate(changed: Map<string, unknown>) {
        // Trigger debounced parsing when content changes
        if (changed.has('content')) {
            this._debouncedParse();
        }
    }

    private _debouncedParse() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            void this._parseMarkdown();
        }, 300);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._removeDragListeners();
    }

    /* ── Event Handlers ── */

    private _handleInput(e: Event) {
        const textarea = e.target as HTMLTextAreaElement;
        this.content = textarea.value;

        this.dispatchEvent(
            new CustomEvent('editor-content-change', {
                bubbles: true,
                composed: true,
                detail: {content: this.content},
            })
        );
    }

    private _handleKeyUp() {
        this._updateCursorPosition();
    }

    private _handleClick() {
        this._updateCursorPosition();
    }

    private _updateCursorPosition() {
        if (!this._textarea) return;

        const {selectionStart, value} = this._textarea;
        const lines = value.substring(0, selectionStart).split('\n');
        const line = lines.length;
        const column = lines[lines.length - 1].length + 1;

        this._cursorPosition = {line, column};

        this.dispatchEvent(
            new CustomEvent('editor-cursor-move', {
                bubbles: true,
                composed: true,
                detail: this._cursorPosition,
            })
        );
    }

    private _handleKeydown(e: KeyboardEvent) {
        // Tab key inserts 2 spaces
        if (e.key === 'Tab') {
            e.preventDefault();
            const textarea = this._textarea;
            const {selectionStart, selectionEnd, value} = textarea;
            const before = value.substring(0, selectionStart);
            const after = value.substring(selectionEnd);
            const newValue = before + '  ' + after;

            this.content = newValue;
            textarea.value = newValue;
            textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;

            this.dispatchEvent(
                new CustomEvent('editor-content-change', {
                    bubbles: true,
                    composed: true,
                    detail: {content: this.content},
                })
            );
        }
    }

    /* ── Split Pane Drag ── */

    private _handleSplitMouseDown(e: MouseEvent) {
        e.preventDefault();
        this._isDragging = true;
        document.addEventListener('mousemove', this._handleSplitMouseMove);
        document.addEventListener('mouseup', this._handleSplitMouseUp);
    }

    private _handleSplitMouseMove = (e: MouseEvent) => {
        if (!this._isDragging || !this._splitContainer) return;

        const rect = this._splitContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = (x / rect.width) * 100;

        // Clamp range to 10%-90%
        this._splitPosition = Math.max(10, Math.min(90, percentage));
    };

    private _handleSplitMouseUp = () => {
        this._isDragging = false;
        this._removeDragListeners();
    };

    private _removeDragListeners() {
        document.removeEventListener('mousemove', this._handleSplitMouseMove);
        document.removeEventListener('mouseup', this._handleSplitMouseUp);
    }

    /* ── Render ── */

    private _renderEditPane() {
        return html`
            <div class="edit-pane">
                <div class="edit-pane-header">${msg("编辑器")}</div>
                <textarea
                    class="editor-textarea"
                    .value=${this.content}
                    ?readonly=${this.readOnly}
                    placeholder=${msg("开始输入 Markdown...")}
                    spellcheck="false"
                    @input=${this._handleInput}
                    @keyup=${this._handleKeyUp}
                    @click=${this._handleClick}
                    @keydown=${this._handleKeydown}
                ></textarea>
            </div>
        `;
    }

    private _renderPreviewPane() {
        const isEmpty = !this.content.trim();

        return html`
            <div class="preview-pane">
                <div class="preview-pane-header">${msg("预览")}</div>
                <div class="preview-content">
                    ${isEmpty
                        ? html`<div class="empty-state">${msg("暂无内容")}</div>`
                        : html`<div .innerHTML=${this._renderedHtml}></div>`
                    }
                </div>
            </div>
        `;
    }

    private _renderSplitPane() {
        const leftStyle = `flex: 0 0 ${this._splitPosition}%`;
        const rightStyle = `flex: 0 0 ${100 - this._splitPosition}%`;

        return html`
            <div class="split-container">
                <div class="edit-pane" style=${leftStyle}>
                    <div class="edit-pane-header">${msg("编辑器")}</div>
                    <textarea
                        class="editor-textarea"
                        .value=${this.content}
                        ?readonly=${this.readOnly}
                        placeholder=${msg("开始输入 Markdown...")}
                        spellcheck="false"
                        @input=${this._handleInput}
                        @keyup=${this._handleKeyUp}
                        @click=${this._handleClick}
                        @keydown=${this._handleKeydown}
                    ></textarea>
                </div>
                <div
                    class="split-divider ${this._isDragging ? 'dragging' : ''}"
                    @mousedown=${this._handleSplitMouseDown}
                ></div>
                <div class="preview-pane" style=${rightStyle}>
                    <div class="preview-pane-header">${msg("预览")}</div>
                    <div class="preview-content">
                        ${!this.content.trim()
                            ? html`<div class="empty-state">${msg("暂无内容")}</div>`
                            : html`<div .innerHTML=${this._renderedHtml}></div>`
                        }
                    </div>
                </div>
            </div>
        `;
    }

    render() {
        void this._localeCtx.locale;
        return html`
            <div class="editor-content">
                ${this.viewMode === 'edit'
                    ? this._renderEditPane()
                    : this.viewMode === 'preview'
                        ? this._renderPreviewPane()
                        : this._renderSplitPane()
                }
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-markdown-editor': RtcMarkdownEditor;
    }

    interface HTMLElementEventMap {
        'editor-content-change': CustomEvent<{content: string}>;
        'editor-cursor-move': CustomEvent<{line: number; column: number}>;
    }
}
