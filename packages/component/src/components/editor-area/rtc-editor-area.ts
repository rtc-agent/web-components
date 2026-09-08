/**
 * Editor Area Component
 *
 * VS Code 风格编辑器区域，组合 Tab + Toolbar + Markdown Editor。
 *
 * 布局：
 * ┌──────────────────────────────────┐
 * │ Tabs (横向滚动，多标签)           │
 * ├──────────────────────────────────┤
 * │ Toolbar (保存/撤销/格式化/视图)   │
 * ├──────────────────────────────────┤
 * │ Editor Content (编辑/预览/分屏)   │
 * └──────────────────────────────────┘
 *
 * 无打开文件时显示 Welcome Screen。
 *
 * 纯 UI 组件：只发事件，不直接操作 VFS。
 * 状态由 EditorAreaController 驱动（或 Debug HTML 手动驱动）。
 *
 * @element rtc-editor-area
 *
 * @fires editor-area-save - 保存当前文件 (detail: { filePath })
 * @fires editor-area-undo - 撤销
 * @fires editor-area-redo - 重做
 * @fires editor-area-format - 格式化 (detail: { format: 'bold' | 'italic' | 'code' | 'link' })
 * @fires editor-area-view-mode-change - 视图切换 (detail: { filePath, viewMode })
 * @fires editor-area-content-change - 内容变更 (detail: { filePath, content })
 * @fires editor-area-tab-select - 切换标签 (detail: { filePath })
 * @fires editor-area-tab-close - 关闭标签 (detail: { filePath })
 * @fires editor-area-cursor-move - 光标移动 (detail: { line, column })
 *
 * ## 样式
 * 使用项目 design tokens（--rtc-color-*），支持亮色/暗色主题。
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {styles} from './rtc-editor-area.styles.js';
import type {EditorTab, EditorViewMode} from '../../types/index.js';
import {fileMarkdownIcon} from '../../icons/index.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';

// Sub-components
import './rtc-editor-tab.js';
import './rtc-editor-toolbar.js';
import '../markdown-editor/rtc-markdown-editor.js';

/** 格式化类型（与 toolbar 一致） */
type FormatType = 'bold' | 'italic' | 'code' | 'link';

@localized()
@customElement('rtc-editor-area')
export class RtcEditorArea extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── i18n ── */

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[rtc-editor-area] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** 打开的文件标签列表 */
    @property({type: Array})
    tabs: EditorTab[] = [];

    /** 当前活动文件路径 */
    @property({type: String, attribute: 'active-file-path'})
    activeFilePath = '';

    /** 主题 */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Computed ── */

    /** 获取当前活动的 tab */
    private get _activeTab(): EditorTab | undefined {
        return this.tabs.find(t => t.filePath === this.activeFilePath);
    }

    /** 保存按钮是否可用（有活动文件且有未保存修改） */
    private get _canSave(): boolean {
        return this._activeTab?.isDirty ?? false;
    }

    /* ── Event Handlers — Tabs ── */

    private _handleTabSelect(e: Event) {
        const {filePath} = (e as CustomEvent).detail;
        this.dispatchEvent(
            new CustomEvent('editor-area-tab-select', {
                bubbles: true,
                composed: true,
                detail: {filePath},
            })
        );
    }

    private _handleTabClose(e: Event) {
        const {filePath} = (e as CustomEvent).detail;
        this.dispatchEvent(
            new CustomEvent('editor-area-tab-close', {
                bubbles: true,
                composed: true,
                detail: {filePath},
            })
        );
    }

    /* ── Event Handlers — Toolbar ── */

    private _handleSave() {
        if (!this._activeTab) return;
        this.dispatchEvent(
            new CustomEvent('editor-area-save', {
                bubbles: true,
                composed: true,
                detail: {filePath: this._activeTab.filePath},
            })
        );
    }

    private _handleUndo() {
        this.dispatchEvent(
            new CustomEvent('editor-area-undo', {
                bubbles: true,
                composed: true,
            })
        );
    }

    private _handleRedo() {
        this.dispatchEvent(
            new CustomEvent('editor-area-redo', {
                bubbles: true,
                composed: true,
            })
        );
    }

    private _handleFormat(e: Event) {
        const {format} = (e as CustomEvent).detail as {format: FormatType};
        this.dispatchEvent(
            new CustomEvent('editor-area-format', {
                bubbles: true,
                composed: true,
                detail: {format},
            })
        );
    }

    private _handleViewModeChange(e: Event) {
        if (!this._activeTab) return;
        const {viewMode} = (e as CustomEvent).detail as {viewMode: EditorViewMode};
        this.dispatchEvent(
            new CustomEvent('editor-area-view-mode-change', {
                bubbles: true,
                composed: true,
                detail: {
                    filePath: this._activeTab.filePath,
                    viewMode,
                },
            })
        );
    }

    /* ── Event Handlers — Editor ── */

    private _handleContentChange(e: Event) {
        if (!this._activeTab) return;
        const {content} = (e as CustomEvent).detail;
        this.dispatchEvent(
            new CustomEvent('editor-area-content-change', {
                bubbles: true,
                composed: true,
                detail: {
                    filePath: this._activeTab.filePath,
                    content,
                },
            })
        );
    }

    private _handleCursorMove(e: Event) {
        const detail = (e as CustomEvent).detail;
        this.dispatchEvent(
            new CustomEvent('editor-area-cursor-move', {
                bubbles: true,
                composed: true,
                detail,
            })
        );
    }

    /* ── Render Helpers ── */

    private _renderTabs() {
        if (this.tabs.length === 0) return nothing;

        return html`
            <div class="tabs-bar" role="tablist" aria-label="Open files">
                ${this.tabs.map(tab => html`
                    <rtc-editor-tab
                        file-path=${tab.filePath}
                        file-name=${this._getFileName(tab.filePath)}
                        ?active=${tab.filePath === this.activeFilePath}
                        ?dirty=${tab.isDirty}
                        theme=${this.theme}
                        @editor-tab-select=${this._handleTabSelect}
                        @editor-tab-close=${this._handleTabClose}
                    ></rtc-editor-tab>
                `)}
            </div>
        `;
    }

    private _renderToolbar() {
        if (!this._activeTab) return nothing;

        return html`
            <div class="toolbar-area">
                <rtc-editor-toolbar
                    ?can-save=${this._canSave}
                    ?can-undo=${false}
                    ?can-redo=${false}
                    view-mode=${this._activeTab.viewMode}
                    theme=${this.theme}
                    @editor-save=${this._handleSave}
                    @editor-undo=${this._handleUndo}
                    @editor-redo=${this._handleRedo}
                    @editor-format=${this._handleFormat}
                    @editor-view-mode-change=${this._handleViewModeChange}
                ></rtc-editor-toolbar>
            </div>
        `;
    }

    private _renderEditor() {
        if (!this._activeTab) return this._renderWelcome();

        return html`
            <div class="editor-content">
                <rtc-markdown-editor
                    .content=${this._activeTab.content}
                    view-mode=${this._activeTab.viewMode}
                    theme=${this.theme}
                    @editor-content-change=${this._handleContentChange}
                    @editor-cursor-move=${this._handleCursorMove}
                ></rtc-markdown-editor>
            </div>
        `;
    }

    private _renderWelcome() {
        return html`
            <div class="welcome-screen">
                <div class="welcome-icon">${fileMarkdownIcon}</div>
                <div class="welcome-title">RTC Agent Editor</div>
                <div class="welcome-hint">${msg('从文件树中选择文件以开始编辑')}</div>
            </div>
        `;
    }

    /**
     * 从路径提取文件名
     */
    private _getFileName(filePath: string): string {
        const parts = filePath.split('/');
        return parts[parts.length - 1] || filePath;
    }

    /* ── Main Render ── */

    render() {
        void this._localeCtx.locale;
        return html`
            ${this._renderTabs()}
            ${this._renderToolbar()}
            ${this._renderEditor()}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-editor-area': RtcEditorArea;
    }

    interface HTMLElementEventMap {
        'editor-area-save': CustomEvent<{filePath: string}>;
        'editor-area-undo': CustomEvent<void>;
        'editor-area-redo': CustomEvent<void>;
        'editor-area-format': CustomEvent<{format: FormatType}>;
        'editor-area-view-mode-change': CustomEvent<{filePath: string; viewMode: EditorViewMode}>;
        'editor-area-content-change': CustomEvent<{filePath: string; content: string}>;
        'editor-area-tab-select': CustomEvent<{filePath: string}>;
        'editor-area-tab-close': CustomEvent<{filePath: string}>;
        'editor-area-cursor-move': CustomEvent<{line: number; column: number}>;
    }
}
