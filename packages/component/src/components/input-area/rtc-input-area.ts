/**
 * RTC Input Area Component
 *
 * Message textarea with bottom toolbar (attach, tool, mode, send buttons).
 * Layout: file preview area on top (when files are attached), textarea in middle,
 * toolbar on bottom (matches Claude Code UI).
 * Enter to submit, Shift+Enter for newline.
 * Supports file paste upload: paste images or files from clipboard.
 *
 * The mode panel is rendered inside this component's shadow DOM and positioned
 * with @floating-ui/dom relative to the mode button, so it never overflows
 * the rtc-agent window boundary.
 *
 * @element rtc-input-area
 * @fires rtc-input-submit - User submitted message (detail: { contentData })
 * @fires rtc-command-requested - User submitted a slash command (detail: { name, args })
 * @fires rtc-voice-input-requested - User clicked voice input button
 * @csspart textarea - The textarea element
 * @csspart toolbar - The toolbar row
 * @csspart mode-btn - The mode button
 * @csspart send-btn - The send button
 * @csspart voice-btn - The voice input button
 */
import {LitElement, html} from 'lit';
import {customElement, property, state, query} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {FloatingPanelController} from '../../utils/floating-panel-controller.js';
import {styles} from './rtc-input-area.styles.js';
import {ModeContext, type ModeContextValue} from '../../contexts/mode.js';
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import {TurnCountContext, type TurnCountContextValue} from '../../contexts/turn-count.js';
import {MessageContext, type MessageContextValue} from '../../contexts/message.js';
import {SettingsContext, type SettingsContextValue} from '../../contexts/settings.js';
import {FileStorageContext, type FileStorageContextValue} from '../../contexts/file-storage.js';
import {attachIcon, toolIcon, sendIcon, stopIcon, micIcon, checklistIcon} from '../../icons/index.js';
import {parseCommand} from '../../utils/command-parser.js';
import type {ScenarioRef, ContentData, FileAttachment} from '../../types/index.js';
import '../overlay/rtc-mode-panel.js';
import '../overlay/rtc-command-panel.js';
import '../overlay/rtc-scenario-panel.js';
import '../token-usage/rtc-token-usage.js';
import '../file-preview/rtc-file-preview-area.js';

// UIUpdateBus is used to listen for new message events
import {getUIUpdateBus, type UIUpdateEvent} from '@rtc-agent/persistence';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('InputArea');

@localized()
@customElement('rtc-input-area')
export class RtcInputArea extends LitElement {
    static styles = styles;

    /** Theme mode */
    @property({ type: String, reflect: true })
    theme: 'light' | 'dark' | 'system' = 'system';

    /**
     * Optional session ID override.
     * When provided, this takes precedence over SessionContext.currentSessionId.
     * Used in multi-tab layouts where each tab has its own input-area instance.
     */
    @property({type: String})
    sessionId: string | null = null;

    /**
     * Transient initial value for the input area.
     * Set by tab's initialInputValue via property binding (e.g., fork content).
     * Consumed in updated() and synced to internal _value.
     */
    @property({type: String})
    initialValue: string | undefined = undefined;

    /**
     * Version counter incremented on each setTransientParams call.
     * Monitored in updated() to force-sync initialValue even when value is unchanged
     * (defends against Lit dirty-check skipping same-value updates).
     */
    @property({type: Number})
    initialValueVersion = 0;

    /**
     * Returns the effective session ID:
     * - sessionId property if explicitly set
     * - Otherwise, falls back to SessionContext.currentSessionId
     */
    private get _effectiveSessionId(): string | null {
        return this.sessionId ?? this._sessionCtx.state.currentSessionId;
    }

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

    @consume({context: ModeContext, subscribe: true})
    @state()
    private _modeCtx: ModeContextValue = {
        state: {currentMode: 'manual'},
        actions: {setMode: () => {}},
    };

    @consume({context: SessionContext, subscribe: true})
    @state()
    private _sessionCtx: SessionContextValue = {
        state: {sessions: [], currentSessionId: null},
        actions: {
            createSession: () => '',
            switchSession: () => {},
            renameSession: async () => ({ok: true}),
            deleteSession: async () => ({ok: true}),
            closeSession: async () => ({ok: true}),
            reopenSession: async () => ({ok: true}),
            reset: () => {},
            clearCurrentSession: () => {},
            setCurrentSession: () => {},
            setSessions: () => {},
        },
    };

    @consume({context: TurnCountContext, subscribe: true})
    @state()
    private _turnCount: TurnCountContextValue = {pendingTurnCount: 0, runningTurnCount: 0};

    @consume({context: MessageContext, subscribe: true})
    @state()
    private _messageCtx: MessageContextValue = {
        state: {messages: [], hasMore: false, isLoadingMore: false},
        actions: {
            sendMessage: async () => {},
            resendMessage: async () => {},
            forkSession: async () => {},
            appendToLastMessage: () => {},
            finalizeLastMessage: () => {},
            clearMessages: () => {},
        },
    };

    @consume({context: SettingsContext, subscribe: true})
    @state()
    private _settingsCtx: SettingsContextValue = {
        state: {
            appearance: {theme: 'system', fontSize: 14},
            chat: {sendShortcut: 'Enter', density: 'comfortable'},
            files: {autoSave: true, defaultViewMode: 'split'},
            notifications: {soundEnabled: true, toastEnabled: true},
        },
        actions: {
            updateAppearance: () => {},
            updateChat: () => {},
            updateFiles: () => {},
            updateNotifications: () => {},
            resetAll: () => {},
        },
    };

    @consume({context: FileStorageContext, subscribe: true})
    @state()
    private _fileStorageCtx: FileStorageContextValue = {
        fileStorage: null,
    };

    @state()
    private _pendingFiles: FileAttachment[] = [];

    @state()
    private _uploadProgress: Map<string, number> = new Map();

    @state()
    private _uploadStates: Map<string, string> = new Map();

    @state()
    private _localPreviews: Map<string, string> = new Map();

    @state()
    private _value = '';

    @state()
    private _showModePanel = false;

    @state()
    private _showCommandPanel = false;

    @state()
    private _showScenarioPanel = false;

    @state()
    private _selectedScenarios: ScenarioRef[] = [];

    // Token usage data (injected by rtc-chat-layout via setter)
    @state()
    private _tokenEstimatedNext = 0;
    @state()
    private _tokenTotalTokens = 0;
    @state()
    private _tokenTotalCostUsd = 0;
    @state()
    private _tokenCompressionThreshold = 0;
    @state()
    private _tokenCompressionProgress = 0;
    @state()
    private _tokenRoundsUntilCompression = -1;
    @state()
    private _tokenDetails?: {
        input?: number;
        output?: number;
        cachedRead?: number;
        cachedWrite?: number;
        reasoning?: number;
    };

    /**
     * Update token display data based on current session
     *
     * Finds the session matching sessionId from SessionContext,
     * extracts token-related fields and updates internal state.
     */
    private _updateTokenDisplay() {
        const sessionId = this._effectiveSessionId;
        if (!sessionId) {
            // No session, clear display
            this._tokenEstimatedNext = 0;
            this._tokenTotalTokens = 0;
            this._tokenTotalCostUsd = 0;
            this._tokenCompressionThreshold = 0;
            this._tokenCompressionProgress = 0;
            this._tokenRoundsUntilCompression = -1;
            this._tokenDetails = undefined;
            return;
        }

        // Find target session from sessions array
        const session = this._sessionCtx.state.sessions.find(s => s.clientId === sessionId);
        if (!session) {
            // Session not found, keep current display (data may not have arrived yet on first load)
            return;
        }

        // Extract token-related fields
        this._tokenEstimatedNext = session.estimatedNextRoundTokens ?? 0;
        this._tokenTotalTokens = session.totalTokens ?? 0;
        this._tokenTotalCostUsd = session.totalCostUsd ?? 0;
        this._tokenCompressionThreshold = session.compressionThreshold ?? 0;
        this._tokenCompressionProgress = session.compressionProgress ?? 0;
        this._tokenRoundsUntilCompression = session.roundsUntilCompression ?? -1;

        // Build details object
        if (session.totalInputTokens !== undefined ||
            session.totalOutputTokens !== undefined ||
            session.totalCachedReadTokens !== undefined ||
            session.totalCachedWriteTokens !== undefined ||
            session.totalReasoningTokens !== undefined) {
            this._tokenDetails = {
                input: session.totalInputTokens,
                output: session.totalOutputTokens,
                cachedRead: session.totalCachedReadTokens,
                cachedWrite: session.totalCachedWriteTokens,
                reasoning: session.totalReasoningTokens,
            };
        } else {
            this._tokenDetails = undefined;
        }
    }

    // History navigation state
    @state()
    private _userMessageHistory: string[] = [];
    @state()
    private _historyIndex = -1;
    private _draft = '';

    // UIUpdateBus subscription cleanup function
    private _busUnsub?: () => void;

    @query('.mode-btn')
    private _modeBtn!: HTMLElement;

    @query('rtc-mode-panel')
    private _modePanel?: HTMLElement;

    @query('.tool-btn')
    private _commandBtn!: HTMLElement;

    @query('rtc-command-panel')
    private _commandPanel?: HTMLElement;

    @query('.scenario-btn')
    private _scenarioBtn!: HTMLElement;

    @query('rtc-scenario-panel')
    private _scenarioPanel?: HTMLElement;

    private _modePanelCtrl = new FloatingPanelController({
        host: this,
        getButton: () => this._modeBtn,
        getPanel: () => this._modePanel,
        placement: 'top-end',
    });
    private _commandPanelCtrl = new FloatingPanelController({
        host: this,
        getButton: () => this._commandBtn,
        getPanel: () => this._commandPanel,
        placement: 'top-start',
    });
    private _scenarioPanelCtrl = new FloatingPanelController({
        host: this,
        getButton: () => this._scenarioBtn,
        getPanel: () => this._scenarioPanel,
        placement: 'top-end',
    });

    private get _textarea(): HTMLTextAreaElement | null {
        return this.shadowRoot?.querySelector('.input-textarea') ?? null;
    }

    private _handleVoice() {
        this.dispatchEvent(
            new CustomEvent('rtc-voice-input-requested', {bubbles: true, composed: true})
        );
    }

    /**
     * Handle paste event: extract files from clipboard and upload them
     */
    private async _handlePaste(e: ClipboardEvent) {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        const files: File[] = [];
        for (let i = 0; i < clipboardData.items.length; i++) {
            const item = clipboardData.items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        }

        if (files.length > 0) {
            e.preventDefault();
            await this._uploadFiles(files);
        }
    }

    /**
     * Upload files: create FileAttachment entries immediately for instant display,
     * then upload in parallel and update fileid when complete
     */
    private async _uploadFiles(files: File[]) {
        const fileStorage = this._fileStorageCtx.fileStorage;
        if (!fileStorage) {
            log.error('FileStorage not available');
            return;
        }

        // Generate temporary IDs and create FileAttachment entries immediately
        const tempEntries: Array<{tempId: string; file: File; attachment: FileAttachment}> = [];

        for (const file of files) {
            const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            // Create blob URL for image preview
            if (file.type.startsWith('image/')) {
                const blobUrl = URL.createObjectURL(file);
                this._localPreviews.set(tempId, blobUrl);
            }

            const attachment: FileAttachment = {
                mimetype: file.type || 'application/octet-stream',
                fileid: tempId,
                extra: {
                    name: file.name,
                    size: file.size,
                },
            };

            tempEntries.push({tempId, file, attachment});
        }

        // Add all attachments to _pendingFiles immediately for instant display
        this._pendingFiles = [...this._pendingFiles, ...tempEntries.map(e => e.attachment)];

        // Set initial upload states
        for (const {tempId} of tempEntries) {
            this._uploadStates.set(tempId, 'uploading');
            this._uploadProgress.set(tempId, 0);
        }
        this._uploadStates = new Map(this._uploadStates);
        this._uploadProgress = new Map(this._uploadProgress);

        // Upload all files in parallel
        const uploadPromises = tempEntries.map(async ({tempId, file, attachment}) => {
            try {
                const fileInfo = await fileStorage.upload({
                    file,
                    filename: file.name,
                    contentType: file.type,
                    onProgress: (loaded, total) => {
                        const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
                        this._uploadProgress.set(tempId, progress);
                        this._uploadProgress = new Map(this._uploadProgress);
                    },
                });

                // Generate real fileid from md5 and extension
                const realFileid = `${fileInfo.md5}.${fileInfo.ext}`;

                // Migrate local preview URL from tempId to realFileid
                const blobUrl = this._localPreviews.get(tempId);
                if (blobUrl) {
                    this._localPreviews.delete(tempId);
                    this._localPreviews.set(realFileid, blobUrl);
                }

                // Update attachment with real fileid
                attachment.fileid = realFileid;
                this._uploadStates.set(tempId, 'loaded');
                this._uploadStates.set(realFileid, 'loaded');
                this._uploadProgress.set(tempId, 100);
                this._uploadProgress.set(realFileid, 100);

                // Trigger re-render
                this._pendingFiles = [...this._pendingFiles];
                this._uploadStates = new Map(this._uploadStates);
                this._uploadProgress = new Map(this._uploadProgress);
                this._localPreviews = new Map(this._localPreviews);

            } catch (error) {
                log.error('File upload failed:', error);
                this._uploadStates.set(tempId, 'error');
                this._uploadStates = new Map(this._uploadStates);
            }
        });

        await Promise.all(uploadPromises);
    }

    /**
     * Handle file removal from pending list
     */
    private _handleFileRemove(e: CustomEvent) {
        const detail = e.detail;
        const file = detail.file as FileAttachment;
        const index = detail.index as number;

        // Revoke blob URL if exists
        const blobUrl = this._localPreviews.get(file.fileid);
        if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
            this._localPreviews.delete(file.fileid);
        }

        // Remove from pending files
        this._pendingFiles = this._pendingFiles.filter((_, i) => i !== index);
        this._uploadStates.delete(file.fileid);
        this._uploadProgress.delete(file.fileid);

        // Trigger re-render
        this._uploadStates = new Map(this._uploadStates);
        this._uploadProgress = new Map(this._uploadProgress);
        this._localPreviews = new Map(this._localPreviews);
    }

    /**
     * Handle file preview request
     */
    private _handleFilePreview(e: CustomEvent) {
        const detail = e.detail;
        const file = detail.file as FileAttachment;
        log.debug('File preview requested:', file);
        // TODO: Implement file preview modal
    }

    /**
     * Public method: set input box content (used for pre-filling in scenarios like fork)
     */
    public setValue(value: string) {
        this._value = value;
        // Wait for next render cycle before focusing
        this.updateComplete.then(() => {
            const textarea = this._textarea;
            if (textarea) {
                textarea.value = value;
                textarea.focus();
                // Don't adjust height, keep the fixed height controlled by CSS, use scrollbar when content overflows
            }
        }).catch(err => {
            log.error('setValue: focus after update failed:', err);
        });
    }

    /**
     * Public method: clear input box
     */
    public clearValue() {
        this._value = '';
        if (this._textarea) {
            this._textarea.value = '';
            this._textarea.style.height = '';
        }
    }

    private get _hasContent(): boolean {
        return this._value.trim().length > 0 || this._pendingFiles.length > 0;
    }

    private get _hasActiveTurns(): boolean {
        return this._turnCount.runningTurnCount > 0;
    }

    /** Current session has active turns and input is empty → show stop button; otherwise show send button. */
    private get _showStop(): boolean {
        return this._hasActiveTurns && !this._hasContent;
    }

    /**
     * Stop button click: send stop request event
     */
    private _handleStop() {
        const sessionId = this._effectiveSessionId;
        if (!sessionId) return;

        this.dispatchEvent(
            new CustomEvent('rtc-stop-requested', {
                bubbles: true,
                composed: true,
                detail: { sessionClientId: sessionId },
            })
        );
    }

    private _handleInput(e: Event) {
        this._value = (e.target as HTMLTextAreaElement).value;
    }

    private _handleKeydown(e: KeyboardEvent) {
        // Ignore key presses during IME composition (Chinese/Japanese/Korean input methods)
        if (e.isComposing || e.keyCode === 229) return;

        const shortcut = this._settingsCtx.state.chat.sendShortcut;

        if (shortcut === 'Ctrl+Enter') {
            // Ctrl/Cmd+Enter to send, Enter for newline
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._submit();
            }
        } else {
            // Enter to send (default), Shift+Enter for newline
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this._submit();
            }
        }

        if (e.key === 'ArrowUp' && this._isCursorOnFirstLine()) {
            e.preventDefault();
            this._navigateHistory('up');
        } else if (e.key === 'ArrowDown' && this._isCursorOnLastLine()) {
            e.preventDefault();
            this._navigateHistory('down');
        }
    }

    /**
     * Check if cursor is on the first line of textarea
     * Returns true if there's no newline before cursor (also returns true when empty)
     */
    private _isCursorOnFirstLine(): boolean {
        const textarea = this._textarea;
        if (!textarea) return true;
        const textBeforeCursor = this._value.substring(0, textarea.selectionStart);
        return !textBeforeCursor.includes('\n');
    }

    /**
     * Check if cursor is on the last line of textarea
     * Returns true if there's no newline after cursor (also returns true when empty)
     */
    private _isCursorOnLastLine(): boolean {
        const textarea = this._textarea;
        if (!textarea) return true;
        const textAfterCursor = this._value.substring(textarea.selectionEnd);
        return !textAfterCursor.includes('\n');
    }

    /**
     * History navigation: up arrow to go back, down arrow to go forward
     *
     * On first up arrow press, loads user message history from MessageContext,
     * and saves current input as draft to restore when returning to the latest position.
     */
    private async _navigateHistory(direction: 'up' | 'down') {
        // Load history messages on first history navigation
        if (this._historyIndex === -1 && direction === 'up') {
            this._draft = this._value;
            await this._loadUserMessageHistory();
        }

        if (this._userMessageHistory.length === 0) return;

        const maxIndex = this._userMessageHistory.length - 1;
        let newIndex: number;

        if (direction === 'up') {
            newIndex = this._historyIndex === -1 ? 0 : Math.min(this._historyIndex + 1, maxIndex);
        } else {
            if (this._historyIndex <= 0) {
                // Return to draft state
                newIndex = -1;
            } else {
                newIndex = this._historyIndex - 1;
            }
        }

        this._historyIndex = newIndex;
        this._value = newIndex === -1 ? this._draft : this._userMessageHistory[newIndex];

        // Sync DOM and move cursor to end
        const textarea = this._textarea;
        if (textarea) {
            textarea.value = this._value;
            textarea.selectionStart = textarea.selectionEnd = this._value.length;
        }
    }

    /**
     * Load user message history for current session from MessageContext
     */
    private async _loadUserMessageHistory() {
        const sessionId = this._effectiveSessionId;
        if (!sessionId) return;

        const fn = this._messageCtx.getUserMessageHistory;
        if (!fn) return;

        try {
            this._userMessageHistory = await fn.call(this._messageCtx, sessionId);
        } catch (error) {
            log.warn('_loadUserMessageHistory failed:', error);
        }
    }

    private _submit() {
        const text = this._value.trim();
        if (!text && this._pendingFiles.length === 0) return;

        // Exit history mode
        this._historyIndex = -1;
        this._draft = '';

        // Check if it's a slash command
        const parsed = parseCommand(text);
        // /goal and /loop are NOT front-end commands — they are plain messages
        // with a prefix that the backend recognizes. Let them fall through to
        // the rtc-input-submit path below.
        if (parsed.isCommand && parsed.name && parsed.name !== 'goal' && parsed.name !== 'loop') {
            this.dispatchEvent(
                new CustomEvent('rtc-command-requested', {
                    bubbles: true,
                    composed: true,
                    detail: {name: parsed.name, args: parsed.args},
                })
            );
            this._value = '';
            if (this._textarea) this._textarea.value = '';
            return;
        }

        // Optimistic update: insert current message at head of history (newest first)
        // Prevents UIUpdateBus delay from causing the just-sent message to be missing from history
        if (
            this._userMessageHistory.length === 0 ||
            this._userMessageHistory[0] !== text
        ) {
            this._userMessageHistory = [text, ...this._userMessageHistory];
        }

        // Build UserMessageContent
        const contentData: ContentData = {
            type: 'user_message',
            data: {
                text: text,
                files: this._pendingFiles.length > 0 ? this._pendingFiles : undefined,
                scenarios: this._selectedScenarios.length > 0 ? this._selectedScenarios : undefined,
            },
        };

        this.dispatchEvent(
            new CustomEvent('rtc-input-submit', {
                bubbles: true,
                composed: true,
                detail: {contentData},
            })
        );

        // Clean up blob URLs for pending files
        for (const file of this._pendingFiles) {
            const blobUrl = this._localPreviews.get(file.fileid);
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
            }
        }

        // Clear state
        this._value = '';
        this._selectedScenarios = [];
        this._pendingFiles = [];
        this._uploadProgress = new Map();
        this._uploadStates = new Map();
        this._localPreviews = new Map();
        if (this._textarea) this._textarea.value = '';
    }

    private get _currentModeLabel(): string {
        const mode = this._modeCtx.state.currentMode;
        switch (mode) {
            case 'manual': return msg('手动');
            case 'edit': return msg('编辑');
            case 'plan': return msg('计划');
            case 'auto': return msg('自动');
            case 'bypass': return msg('绕过权限');
            default: return mode;
        }
    }

    private _handleModeToggle() {
        this._showModePanel = !this._showModePanel;
        if (this._showModePanel) {
            this._modePanelCtrl.startPositioning();
        } else {
            this._modePanelCtrl.stopPositioning();
        }
        this._syncDocClickListener();
    }

    private _closeModePanel() {
        this._showModePanel = false;
        this._modePanelCtrl.stopPositioning();
        this._syncDocClickListener();
    }

    private _handleModeSelected(e: Event) {
        const detail = (e as CustomEvent).detail;
        this._modeCtx.actions.setMode(detail.mode);
        this._closeModePanel();
    }

    private _handleModePanelClose() {
        this._closeModePanel();
    }

    private _handleCommandToggle() {
        this._showCommandPanel = !this._showCommandPanel;
        if (this._showCommandPanel) {
            this._commandPanelCtrl.startPositioning();
        } else {
            this._commandPanelCtrl.stopPositioning();
        }
        this._syncDocClickListener();
    }

    private _closeCommandPanel() {
        this._showCommandPanel = false;
        this._commandPanelCtrl.stopPositioning();
        this._syncDocClickListener();
    }

    private _handleCommandSelected(e: Event) {
        const detail = (e as CustomEvent).detail;
        const commandName = detail.command;

        // /goal and /loop are draft-time commands: prepend "/<cmd> " to the
        // textarea and let the user finish typing. Do NOT dispatch
        // rtc-command-requested — the backend recognizes the prefix in
        // loadMessages / command handlers.
        if (commandName === 'goal' || commandName === 'loop') {
            this._closeCommandPanel();
            const textarea = this._textarea;
            if (textarea) {
                const prefix = `/${commandName} `;
                const current = textarea.value;
                const next = current.startsWith(prefix) ? current : prefix + current;
                textarea.value = next;
                this._value = next;
                textarea.focus();
                // Place caret at end of "/<cmd> "
                const caret = prefix.length;
                textarea.setSelectionRange(caret, caret);
            }
            return;
        }

        // Dispatch command requested event
        this.dispatchEvent(
            new CustomEvent('rtc-command-requested', {
                bubbles: true,
                composed: true,
                detail: {name: commandName},
            })
        );
        this._closeCommandPanel();
    }

    private _handleCommandPanelClose() {
        this._closeCommandPanel();
    }

    private _handleScenarioToggle() {
        this._showScenarioPanel = !this._showScenarioPanel;
        if (this._showScenarioPanel) {
            this._scenarioPanelCtrl.startPositioning();
        } else {
            this._scenarioPanelCtrl.stopPositioning();
        }
        this._syncDocClickListener();
    }

    private _closeScenarioPanel() {
        this._showScenarioPanel = false;
        this._scenarioPanelCtrl.stopPositioning();
        this._syncDocClickListener();
    }

    private _handleScenarioSelected(e: Event) {
        const detail = (e as CustomEvent).detail;
        const scenario: ScenarioRef = detail.scenario;
        const selected: boolean = detail.selected;

        if (!selected) {
            // Deselect
            const index = this._selectedScenarios.findIndex(s => s.filepath === scenario.filepath);
            if (index >= 0) {
                this._selectedScenarios = this._selectedScenarios.filter((_, i) => i !== index);
            }
        } else {
            // Select
            this._selectedScenarios = [...this._selectedScenarios, scenario];
        }

        // Auto-close panel after select/deselect
        this._closeScenarioPanel();
    }

    private _handleScenarioPanelClose() {
        this._closeScenarioPanel();
    }

    /**
     * Synchronize the document-level mousedown listener with panel state.
     *
     * Attaches the listener when any panel is open (so outside clicks dismiss it),
     * and detaches it when all panels are closed (avoiding unnecessary work on every
     * mousedown when no panel needs outside-click dismissal).
     */
    private _syncDocClickListener() {
        const anyPanelOpen = this._showModePanel || this._showCommandPanel || this._showScenarioPanel;
        if (anyPanelOpen) {
            // Use capture phase so we see the event before any stopPropagation() in the panel
            document.addEventListener('mousedown', this._onDocClick, true);
        } else {
            document.removeEventListener('mousedown', this._onDocClick, true);
        }
    }

    private _onDocClick = (e: MouseEvent) => {
        const path = e.composedPath();

        // Mode panel: close when clicking outside mode panel
        // Note: We intentionally don't check if the toggle button is in the path.
        // The button's click handler (_handleModeToggle) handles the toggle logic.
        // Since Lit renders are async, the panel remains in DOM briefly after
        // _closeModePanel sets the state to false, so path.includes(panel) correctly
        // prevents _onDocClick from interfering with the button's toggle.
        if (this._showModePanel) {
            const modePanel = this._modePanel;
            if (modePanel && !path.includes(modePanel)) {
                this._closeModePanel();
            }
        }

        // Command panel: close when clicking outside command panel
        if (this._showCommandPanel) {
            const commandPanel = this._commandPanel;
            if (commandPanel && !path.includes(commandPanel)) {
                this._closeCommandPanel();
            }
        }

        // Scenario panel: close when clicking outside scenario panel
        if (this._showScenarioPanel) {
            const scenarioPanel = this._scenarioPanel;
            if (scenarioPanel && !path.includes(scenarioPanel)) {
                this._closeScenarioPanel();
            }
        }
    };

    connectedCallback() {
        super.connectedCallback();
        // NOTE: document mousedown listener is attached lazily by _syncDocClickListener()
        // only when a panel is open, not unconditionally here. This avoids firing a
        // no-op callback on every mousedown when no panels need outside-click dismissal.

        // Subscribe to UIUpdateBus: clear history cache when a user message is received for current session, reload on next navigation
        const bus = getUIUpdateBus();
        this._busUnsub = bus.subscribe('message', (event: UIUpdateEvent) => {
            if (event.action !== 'created' || event.field !== 'role' || event.newValue !== 'user') {
                return;
            }
            // New user message written, clear cache, reload on next navigation
            // (Don't load immediately here to avoid frequent queries)
            this._userMessageHistory = [];
            this._historyIndex = -1;
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        // Always remove the listener in case a panel was open at disconnect time
        document.removeEventListener('mousedown', this._onDocClick, true);
        this._modePanelCtrl.stopPositioning();
        this._commandPanelCtrl.stopPositioning();
        this._scenarioPanelCtrl.stopPositioning();
        this._busUnsub?.();
        this._busUnsub = undefined;

        // Clean up blob URLs to prevent memory leaks
        for (const blobUrl of this._localPreviews.values()) {
            URL.revokeObjectURL(blobUrl);
        }
        this._localPreviews.clear();
    }

    updated(changed: Map<string | number | symbol, unknown>) {
        // Log turn count changes for debugging
        if (changed.has('_turnCount')) {
            log.debug('[InputArea] Turn count changed:', this._turnCount);
        }
        // Clear history cache on session switch, reload on next navigation
        if (changed.has('_sessionCtx') || changed.has('sessionId')) {
            // Defer @state mutations to avoid "change-in-update" warning.
            // _updateTokenDisplay() sets multiple @state properties (_tokenEstimatedNext,
            // _tokenTotalTokens, etc.) and the history resets set @state _userMessageHistory
            // and _historyIndex — all of which trigger requestUpdate() if done synchronously
            // inside updated(). queueMicrotask defers them to after the current update cycle.
            queueMicrotask(() => {
                this._userMessageHistory = [];
                this._historyIndex = -1;
                this._draft = '';
                this._updateTokenDisplay();
            });
        }
        // When initialValueVersion changes, force-sync initialValue to _value
        // Uses version instead of directly watching initialValue to defend against Lit skipping same-value updates
        if (changed.has('initialValueVersion') && this.initialValue !== undefined) {
            this._value = this.initialValue;
            this.updateComplete.then(() => {
                const textarea = this._textarea;
                if (textarea) {
                    textarea.value = this.initialValue ?? '';
                    textarea.focus();
                }
            }).catch(err => {
                log.error('initialValue sync: focus after update failed:', err);
            });
        }
    }

    render() {
        void this._localeCtx.locale;
        return html`
      <div class="input-inner">
        ${this._pendingFiles.length > 0 ? html`
          <rtc-file-preview-area
            .files=${this._pendingFiles}
            .uploadProgress=${this._uploadProgress}
            .uploadStates=${this._uploadStates}
            .localPreviews=${this._localPreviews}
            @rtc-file-remove=${this._handleFileRemove}
            @rtc-file-preview=${this._handleFilePreview}
          ></rtc-file-preview-area>
        ` : ''}
        <div class="textarea-container">
          <textarea
            class="input-textarea"
            part="textarea"
            .value=${this._value}
            placeholder=${msg('随便问...')}
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
            @paste=${this._handlePaste}
          ></textarea>
          <button class="voice-btn" part="voice-btn" title=${msg('语音输入')} disabled @click=${this._handleVoice}>
            ${micIcon}
          </button>
        </div>
        <div class="input-toolbar" part="toolbar">
          <button class="toolbar-btn" title=${msg('附加文件')} disabled>${attachIcon}</button>
          <button class="toolbar-btn tool-btn" title=${msg('命令')} @click=${this._handleCommandToggle}>${toolIcon}</button>
          <button class="toolbar-btn scenario-btn ${this._selectedScenarios.length > 0 ? 'scenario-btn--active' : ''}" title=${this._selectedScenarios.length > 0 ? msg(`场景 (${this._selectedScenarios.length} 个已选)`) : msg('场景')} @click=${this._handleScenarioToggle}>
            ${checklistIcon}
            ${this._selectedScenarios.length > 0 ? html`<span class="scenario-badge">${this._selectedScenarios.length}</span>` : ''}
          </button>
          <div class="toolbar-divider"></div>
          <rtc-token-usage
              theme=${this.theme}
              .estimatedNext=${this._tokenEstimatedNext}
              .totalTokens=${this._tokenTotalTokens}
              .totalCostUsd=${this._tokenTotalCostUsd}
              .compressionThreshold=${this._tokenCompressionThreshold}
              .compressionProgress=${this._tokenCompressionProgress}
              .roundsUntilCompression=${this._tokenRoundsUntilCompression}
              .details=${this._tokenDetails}
          ></rtc-token-usage>
          <span class="toolbar-spacer"></span>
          <button class="mode-btn" part="mode-btn" @click=${this._handleModeToggle}>
            ${this._currentModeLabel}
          </button>
          <button
            class="send-btn ${this._showStop ? 'send-btn--stop' : ''}"
            part="send-btn"
            title=${this._showStop ? msg('停止') : msg('发送')}
            ?disabled=${!this._showStop && !this._hasContent}
            @click=${this._showStop ? this._handleStop : this._submit}
          >${this._showStop ? stopIcon : sendIcon}</button>
        </div>
        ${this._showModePanel ? html`
          <rtc-mode-panel
            .modes=${['manual', 'edit', /*'plan', 'auto', */'bypass']}
            current-mode=${this._modeCtx.state.currentMode}
            @rtc-mode-selected=${this._handleModeSelected}
            @rtc-mode-panel-close=${this._handleModePanelClose}
          ></rtc-mode-panel>
        ` : ''}
        ${this._showCommandPanel ? html`
          <rtc-command-panel
            @rtc-command-selected=${this._handleCommandSelected}
            @rtc-command-panel-close=${this._handleCommandPanelClose}
          ></rtc-command-panel>
        ` : ''}
        ${this._showScenarioPanel ? html`
          <rtc-scenario-panel
            .initialSelectedPaths=${this._selectedScenarios.map(s => s.filepath)}
            @rtc-scenario-selected=${this._handleScenarioSelected}
            @rtc-scenario-panel-close=${this._handleScenarioPanelClose}
          ></rtc-scenario-panel>
        ` : ''}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-input-area': RtcInputArea;
    }
}
