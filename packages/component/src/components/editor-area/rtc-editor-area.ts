/**
 * Editor Area Component
 *
 * VS Code-style editor area, combining Tab + Toolbar + Markdown Editor.
 *
 * Layout:
 * ┌──────────────────────────────────┐
 * │ Tabs (horizontal scroll, multi-tab) │
 * ├──────────────────────────────────┤
 * │ Toolbar (save/undo/redo/view)    │
 * ├──────────────────────────────────┤
 * │ Editor Content (edit/preview/split) │
 * └──────────────────────────────────┘
 *
 * Shows Welcome Screen when no file is open.
 *
 * Pure UI component: dispatches events only, does not directly operate VFS.
 * State is driven by EditorAreaController (or manually by Debug HTML).
 *
 * @element rtc-editor-area
 *
 * @fires editor-area-save - Save current file (detail: { filePath })
 * @fires editor-area-undo - Undo
 * @fires editor-area-redo - Redo
 * @fires editor-area-format - Format (detail: { format: 'bold' | 'italic' | 'code' | 'link' })
 * @fires editor-area-view-mode-change - View mode switch (detail: { filePath, viewMode })
 * @fires editor-area-content-change - Content change (detail: { filePath, content })
 * @fires editor-area-tab-select - Tab switch (detail: { filePath })
 * @fires editor-area-tab-close - Tab close (detail: { filePath })
 * @fires editor-area-cursor-move - Cursor move (detail: { line, column })
 * @fires editor-area-restore-default - Restore default (detail: { filePath })
 *
 * ## Styling
 * Uses project design tokens (--rtc-color-*), supports light/dark themes.
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
import { createLogger } from '@rtc-agent/client';

const log = createLogger('EditorArea');

/** Format type (consistent with toolbar) */
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
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /* ── Properties ── */

    /** List of open file tabs */
    @property({type: Array})
    tabs: EditorTab[] = [];

    /** Current active file path */
    @property({type: String, attribute: 'active-file-path'})
    activeFilePath = '';

    /** Theme */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Computed ── */

    /** Get the currently active tab */
    private get _activeTab(): EditorTab | undefined {
        return this.tabs.find(t => t.filePath === this.activeFilePath);
    }

    /** Whether the save button is enabled (has active file with unsaved changes) */
    private get _canSave(): boolean {
        return this._activeTab?.isDirty ?? false;
    }

    /**
     * Whether the restore default button is enabled (shown only for system-generated files)
     *
     * System-generated files: /AGENT.md, /functions/*.md, /scenarios/*.md
     */
    private get _canRestore(): boolean {
        if (!this._activeTab) return false;
        const path = this._activeTab.filePath;
        return path === '/AGENT.md'
            || path.startsWith('/functions/')
            || path.startsWith('/scenarios/');
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

    private _handleRestoreDefault() {
        if (!this._activeTab) return;
        this.dispatchEvent(
            new CustomEvent('editor-area-restore-default', {
                bubbles: true,
                composed: true,
                detail: {filePath: this._activeTab.filePath},
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
                    ?can-restore=${this._canRestore}
                    view-mode=${this._activeTab.viewMode}
                    theme=${this.theme}
                    @editor-save=${this._handleSave}
                    @editor-undo=${this._handleUndo}
                    @editor-redo=${this._handleRedo}
                    @editor-format=${this._handleFormat}
                    @editor-view-mode-change=${this._handleViewModeChange}
                    @editor-restore-default=${this._handleRestoreDefault}
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
     * Extract filename from path
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
        'editor-area-restore-default': CustomEvent<{filePath: string}>;
    }
}
