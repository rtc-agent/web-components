/**
 * Markdown Editor Component
 *
 * VS Code 风格 Markdown 编辑器，支持编辑/预览/分屏三种视图模式。
 *
 * 布局（split 模式）：
 * ┌──────────────────┬───┬──────────────────┐
 * │  编辑区           │   │  预览区           │
 * │  (textarea)      │   │  (marked 渲染)    │
 * │                  │   │                   │
 * └──────────────────┴───┴──────────────────┘
 *
 * Markdown 解析使用 marked + DOMPurify（懒加载，与 rtc-message 共享）。
 *
 * @element rtc-markdown-editor
 *
 * @fires editor-content-change - 内容变更 (detail: { content: string })
 * @fires editor-cursor-move - 光标移动 (detail: { line: number, column: number })
 *
 * ## 样式
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
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

@localized()
@customElement('rtc-markdown-editor')
export class RtcMarkdownEditor extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-markdown-editor] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** 当前编辑内容 */
    @property({type: String})
    content = '';

    /** 视图模式 */
    @property({type: String, attribute: 'view-mode'})
    viewMode: EditorViewMode = 'split';

    /** 主题 */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /** 是否只读 */
    @property({type: Boolean, attribute: 'read-only'})
    readOnly = false;

    /* ── Internal State ── */

    /** Markdown 渲染后的 HTML */
    @state()
    private _renderedHtml = '';

    /** 光标位置 */
    @state()
    private _cursorPosition = {line: 1, column: 1};

    /** 分屏分割条位置（百分比） */
    @state()
    private _splitPosition = 50;

    /** 是否正在拖动分割条 */
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
        hljs: typeof import('highlight.js').default;
    }> | null = null;

    /** 防抖定时器 */
    private _debounceTimer?: ReturnType<typeof setTimeout>;

    private async _loadModules() {
        if (!this._modulesPromise) {
            this._modulesPromise = Promise.all([
                import('marked'),
                import('dompurify'),
                import('highlight.js'),
            ]).then(([markedMod, dompurifyMod, hljsMod]) => ({
                marked: markedMod.marked,
                DOMPurify: dompurifyMod.default,
                hljs: hljsMod.default,
            }));
        }
        return this._modulesPromise;
    }

    private async _parseMarkdown() {
        const generation = ++this._parseGeneration;

        if (!this.content) {
            this._renderedHtml = '';
            return;
        }

        try {
            const {marked, DOMPurify, hljs} = await this._loadModules();

            // 解析 Markdown
            const rawHtml = await marked.parse(this.content);

            // 检查 generation 是否过期
            if (generation !== this._parseGeneration) {
                return;
            }

            // 应用语法高亮
            const highlighted = this._highlightCodeBlocks(rawHtml as string, hljs);

            // 消毒
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
                    'input', // 任务列表 checkbox
                    'span', // highlight.js 需要
                ],
                ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'class', 'type', 'checked', 'disabled', 'style'],
            });

            this._renderedHtml = cleanHtml;
        } catch (err) {
            console.error('[rtc-markdown-editor] Failed to parse markdown:', err);
            this._renderedHtml = `<p style="color: var(--rtc-color-error);">${msg(str`渲染失败: ${err instanceof Error ? err.message : String(err)}`)}</p>`;
        }
    }

    /**
     * 对 Markdown 渲染出的所有 <pre><code> 块应用 highlight.js 语法高亮
     */
    private _highlightCodeBlocks(html: string, hljs: typeof import('highlight.js').default): string {
        if (!html.includes('<pre>')) return html;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el as HTMLElement));
        return doc.body.innerHTML;
    }

    /* ── Lifecycle ── */

    willUpdate(changed: Map<string, unknown>) {
        // 内容变化时触发防抖解析
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
        // Tab 键插入 2 空格
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

        // 限制范围 10%-90%
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
