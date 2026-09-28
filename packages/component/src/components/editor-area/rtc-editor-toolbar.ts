/**
 * Editor Toolbar Component
 *
 * VS Code-style editor toolbar.
 *
 * Layout:
 * [💾 Save] │ [↶] [↷] │ [flex spacer] │ [🔄 Restore Default] │ [Edit|Preview|Split]
 *
 * Pure UI component: only dispatches events, does not operate VFS. State is driven by EditorController.
 *
 * @element rtc-editor-toolbar
 *
 * @fires editor-save - Fired when save is clicked
 * @fires editor-undo - Fired when undo is clicked
 * @fires editor-redo - Fired when redo is clicked
 * @fires editor-format - Format action (detail: { format: 'bold' | 'italic' | 'code' | 'link' })
 * @fires editor-view-mode-change - View mode switch (detail: { viewMode: EditorViewMode })
 * @fires editor-restore-default - Fired when restore default is clicked
 *
 * ## Styling
 * Uses project design tokens (--rtc-color-*), supports light/dark themes.
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {localized, msg, str} from '@lit/localize';
import {consume} from '@lit/context';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
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
    refreshIcon,
} from '../../icons/index.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('EditorToolbar');

/** Format type */
type FormatType = 'bold' | 'italic' | 'code' | 'link';

@localized()
@customElement('rtc-editor-toolbar')
export class RtcEditorToolbar extends LitElement {
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

    /** Whether the save button is enabled */
    @property({type: Boolean, attribute: 'can-save'})
    canSave = false;

    /** Whether the undo button is enabled */
    @property({type: Boolean, attribute: 'can-undo'})
    canUndo = false;

    /** Whether the redo button is enabled */
    @property({type: Boolean, attribute: 'can-redo'})
    canRedo = false;

    /** Whether the restore default button is enabled (only shown for system-generated files) */
    @property({type: Boolean, attribute: 'can-restore'})
    canRestore = false;

    /** Current view mode */
    @property({type: String, attribute: 'view-mode'})
    viewMode: EditorViewMode = 'edit';

    /** Theme */
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

    private _handleRestoreDefault() {
        if (!this.canRestore) return;
        this.dispatchEvent(
            new CustomEvent('editor-restore-default', {
                bubbles: true,
                composed: true,
            })
        );
    }

    /* ── Main Render ── */

    render() {
        void this._localeCtx.locale;
        return html`
            <div class="toolbar" role="toolbar" aria-label="Editor toolbar">
                <!-- Save (primary button) -->
                <button
                    class="toolbar-btn primary"
                    ?disabled=${!this.canSave}
                    title=${msg(str`保存 (Ctrl+S)`)}
                    aria-label=${msg('保存')}
                    @click=${this._handleSave}
                >
                    ${saveIcon}
                    <span>${msg('保存')}</span>
                </button>

                <span class="separator" role="separator"></span>

                <!-- Undo / Redo -->
                <button
                    class="toolbar-btn"
                    ?disabled=${!this.canUndo}
                    title=${msg(str`撤销 (Ctrl+Z)`)}
                    aria-label=${msg('撤销')}
                    @click=${this._handleUndo}
                >${undoIcon}</button>
                <button
                    class="toolbar-btn"
                    ?disabled=${!this.canRedo}
                    title=${msg(str`重做 (Ctrl+Shift+Z)`)}
                    aria-label=${msg('重做')}
                    @click=${this._handleRedo}
                >${redoIcon}</button>

                <span class="separator" role="separator"></span>

                <!-- Formatting -->
                <!-- Not yet supported
                <button
                    class="toolbar-btn"
                    title=${msg('加粗')}
                    aria-label=${msg('加粗')}
                    @click=${() => this._handleFormat('bold')}
                >${boldIcon}</button>
                <button
                    class="toolbar-btn"
                    title=${msg('斜体')}
                    aria-label=${msg('斜体')}
                    @click=${() => this._handleFormat('italic')}
                >${italicIcon}</button>
                <button
                    class="toolbar-btn"
                    title=${msg('代码')}
                    aria-label=${msg('代码')}
                    @click=${() => this._handleFormat('code')}
                >${codeIcon}</button>
                <button
                    class="toolbar-btn"
                    title=${msg('链接')}
                    aria-label=${msg('链接')}
                    @click=${() => this._handleFormat('link')}
                >${linkIcon}</button>
                 -->
                <!-- Flexible spacer -->
                <span class="spacer"></span>

                <!-- Restore default (only shown for system-generated files) -->
                ${this.canRestore ? html`
                    <button
                        class="toolbar-btn"
                        title=${msg('恢复默认内容')}
                        aria-label=${msg('恢复默认')}
                        @click=${this._handleRestoreDefault}
                    >${refreshIcon}</button>
                ` : nothing}

                <!-- View mode toggle -->
                <div class="view-toggle" role="group" aria-label=${msg('视图模式')}>
                    <button
                        class="view-toggle-btn ${this.viewMode === 'edit' ? 'active' : ''}"
                        title=${msg('编辑模式')}
                        aria-label=${msg('编辑模式')}
                        aria-pressed=${this.viewMode === 'edit'}
                        @click=${() => this._handleViewModeChange('edit')}
                    >${editIcon}</button>
                    <button
                        class="view-toggle-btn ${this.viewMode === 'preview' ? 'active' : ''}"
                        title=${msg('预览模式')}
                        aria-label=${msg('预览模式')}
                        aria-pressed=${this.viewMode === 'preview'}
                        @click=${() => this._handleViewModeChange('preview')}
                    >${eyeIcon}</button>
                    <button
                        class="view-toggle-btn ${this.viewMode === 'split' ? 'active' : ''}"
                        title=${msg('分屏模式')}
                        aria-label=${msg('分屏模式')}
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
        'editor-restore-default': CustomEvent<void>;
    }
}
