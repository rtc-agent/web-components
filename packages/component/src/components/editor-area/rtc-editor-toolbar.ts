/**
 * Editor Toolbar Component
 *
 * VS Code 风格编辑器工具栏。
 *
 * 布局：
 * [💾 保存] │ [↶] [↷] │ [B] [I] [</>] │ [flex spacer] │ [编辑|预览|分屏]
 *
 * 纯 UI 组件：只发事件，不操作 VFS。状态由 EditorController 驱动。
 *
 * @element rtc-editor-toolbar
 *
 * @fires editor-save - 点击保存
 * @fires editor-undo - 点击撤销
 * @fires editor-redo - 点击重做
 * @fires editor-format - 格式化操作 (detail: { format: 'bold' | 'italic' | 'code' | 'link' })
 * @fires editor-view-mode-change - 视图切换 (detail: { viewMode: EditorViewMode })
 *
 * ## 样式
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-editor-toolbar.styles.js';
import type {EditorViewMode} from '../../types/index.js';
import {
    saveIcon,
    undoIcon,
    redoIcon,
    boldIcon,
    italicIcon,
    codeIcon,
    linkIcon,
    eyeIcon,
    columnsIcon,
    editIcon,
} from '../../icons/index.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';

/** 格式化类型 */
type FormatType = 'bold' | 'italic' | 'code' | 'link';

@customElement('rtc-editor-toolbar')
export class RtcEditorToolbar extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Properties ── */

    /** 保存按钮是否可用 */
    @property({type: Boolean, attribute: 'can-save'})
    canSave = false;

    /** 撤销按钮是否可用 */
    @property({type: Boolean, attribute: 'can-undo'})
    canUndo = false;

    /** 重做按钮是否可用 */
    @property({type: Boolean, attribute: 'can-redo'})
    canRedo = false;

    /** 当前视图模式 */
    @property({type: String, attribute: 'view-mode'})
    viewMode: EditorViewMode = 'split';

    /** 主题 */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Event Handlers ── */

    private _handleSave() {
        if (!this.canSave) return;
        this.dispatchEvent(
            new CustomEvent('editor-save', {
                bubbles: true,
                composed: true,
            })
        );
    }

    private _handleUndo() {
        if (!this.canUndo) return;
        this.dispatchEvent(
            new CustomEvent('editor-undo', {
                bubbles: true,
                composed: true,
            })
        );
    }

    private _handleRedo() {
        if (!this.canRedo) return;
        this.dispatchEvent(
            new CustomEvent('editor-redo', {
                bubbles: true,
                composed: true,
            })
        );
    }

    private _handleFormat(format: FormatType) {
        this.dispatchEvent(
            new CustomEvent('editor-format', {
                bubbles: true,
                composed: true,
                detail: {format},
            })
        );
    }

    private _handleViewModeChange(mode: EditorViewMode) {
        if (this.viewMode === mode) return;
        this.dispatchEvent(
            new CustomEvent('editor-view-mode-change', {
                bubbles: true,
                composed: true,
                detail: {viewMode: mode},
            })
        );
    }

    /* ── Main Render ── */

    render() {
        return html`
            <div class="toolbar" role="toolbar" aria-label="Editor toolbar">
                <!-- 保存（主按钮） -->
                <button
                    class="toolbar-btn primary"
                    ?disabled=${!this.canSave}
                    title="保存 (Ctrl+S)"
                    aria-label="保存"
                    @click=${this._handleSave}
                >
                    ${saveIcon}
                    <span>保存</span>
                </button>

                <span class="separator" role="separator"></span>

                <!-- 撤销 / 重做 -->
                <button
                    class="toolbar-btn"
                    ?disabled=${!this.canUndo}
                    title="撤销 (Ctrl+Z)"
                    aria-label="撤销"
                    @click=${this._handleUndo}
                >${undoIcon}</button>
                <button
                    class="toolbar-btn"
                    ?disabled=${!this.canRedo}
                    title="重做 (Ctrl+Shift+Z)"
                    aria-label="重做"
                    @click=${this._handleRedo}
                >${redoIcon}</button>

                <span class="separator" role="separator"></span>

                <!-- 格式化 -->
                <button
                    class="toolbar-btn"
                    title="加粗"
                    aria-label="加粗"
                    @click=${() => this._handleFormat('bold')}
                >${boldIcon}</button>
                <button
                    class="toolbar-btn"
                    title="斜体"
                    aria-label="斜体"
                    @click=${() => this._handleFormat('italic')}
                >${italicIcon}</button>
                <button
                    class="toolbar-btn"
                    title="代码"
                    aria-label="代码"
                    @click=${() => this._handleFormat('code')}
                >${codeIcon}</button>
                <button
                    class="toolbar-btn"
                    title="链接"
                    aria-label="链接"
                    @click=${() => this._handleFormat('link')}
                >${linkIcon}</button>

                <!-- 弹性空间 -->
                <span class="spacer"></span>

                <!-- 视图切换 -->
                <div class="view-toggle" role="group" aria-label="视图模式">
                    <button
                        class="view-toggle-btn ${this.viewMode === 'edit' ? 'active' : ''}"
                        title="编辑模式"
                        aria-label="编辑模式"
                        aria-pressed=${this.viewMode === 'edit'}
                        @click=${() => this._handleViewModeChange('edit')}
                    >${editIcon}</button>
                    <button
                        class="view-toggle-btn ${this.viewMode === 'preview' ? 'active' : ''}"
                        title="预览模式"
                        aria-label="预览模式"
                        aria-pressed=${this.viewMode === 'preview'}
                        @click=${() => this._handleViewModeChange('preview')}
                    >${eyeIcon}</button>
                    <button
                        class="view-toggle-btn ${this.viewMode === 'split' ? 'active' : ''}"
                        title="分屏模式"
                        aria-label="分屏模式"
                        aria-pressed=${this.viewMode === 'split'}
                        @click=${() => this._handleViewModeChange('split')}
                    >${columnsIcon}</button>
                </div>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-editor-toolbar': RtcEditorToolbar;
    }

    interface HTMLElementEventMap {
        'editor-save': CustomEvent<void>;
        'editor-undo': CustomEvent<void>;
        'editor-redo': CustomEvent<void>;
        'editor-format': CustomEvent<{format: FormatType}>;
        'editor-view-mode-change': CustomEvent<{viewMode: EditorViewMode}>;
    }
}
