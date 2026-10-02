/**
 * RTC Chat Layout Component
 *
 * Two-column chat layout page:
 * - Left column: rtc-session-tree (session tree)
 * - Right column: rtc-session-tab-bar (tab bar) + chat content area
 *
 * Clicking a session tree node → opens/switches tab → chat content area displays that session's messages.
 *
 * The chat content area reuses existing components (rtc-content-area / rtc-notice-bar /
 * rtc-input-area / rtc-overlay-manager). It switches between sessions via
 * currentSessionId from SessionContext, and passes MessageRepository to
 * rtc-content-area → rtc-message-list through the messageController property,
 * achieving independent message instances per tab.
 *
 * @element rtc-chat-layout
 * @fires rtc-chat-layout-session-select - User clicks a session tree node (detail: { sessionId })
 * @fires rtc-chat-layout-tab-activate - User switches tab (detail: { sessionId })
 * @fires rtc-chat-layout-tab-close - User closes tab (detail: { sessionId })
 * @fires rtc-fork-initiated - Fork request orchestration complete (detail: { oldSessionClientId, oldMessageClientId, newSessionClientId, content })
 * @fires rtc-new-session - New session (including auto-create after all tabs closed)
 */
import {LitElement, html, type PropertyValues} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {consume} from '@lit/context';
import {localized, msg, str} from '@lit/localize';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('ChatLayout');
import {styles} from './rtc-chat-layout.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {STORAGE_KEYS} from '../../config/auth.js';

// Contexts
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import {SessionTabContext, type SessionTabContextValue} from '../../contexts/session-tab.js';

// Child components
import '../session-tree/rtc-session-tree.js';
import '../session-tree/rtc-session-tab-bar.js';
import '../content-area/rtc-content-area.js';
import '../notice-bar/rtc-notice-bar.js';
import '../input-area/rtc-input-area.js';
import '../file-preview/rtc-file-preview-area.js';
import type {MessageController} from '../../controllers/message.controller.js';
import '../overlay/rtc-overlay-manager.js';
import '../drawer/rtc-drawer.js';

import type {FileAttachment} from '../../types/index.js';

@localized()
@customElement('rtc-chat-layout')
export class RtcChatLayout extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Properties ── */

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            log.warn('Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    /** Theme: light / dark / system */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /**
     * Whether the session tree (.sidebar) is visible
     *
     * Passed through from parent rtc-agent based on ActivityController.sidebarVisible:
     * - Click "chat" activity bar icon → toggleSidebar → false → hide
     * - Click again → toggleSidebar → true → expand
     */
    @property({type: Boolean, reflect: true, attribute: 'session-tree-visible'})
    sessionTreeVisible = true;

    /** Message controller for repository access (passed to rtc-content-area). */
    @property({attribute: false})
    messageController?: MessageController;

    /* ── Resize State ── */

    /** Whether currently dragging the resize handle */
    private _isResizing = false;

    /** Y coordinate when drag started */
    private _resizeStartY = 0;

    /** input-area height when drag started */
    private _resizeStartHeight = 0;

    /** Session ID of the current drag operation */
    private _resizeSessionId: string | null = null;

    /** Minimum input-area height */
    private static readonly MIN_INPUT_HEIGHT = 80;

    /** Maximum input-area height */
    private static readonly MAX_INPUT_HEIGHT = 400;

    /**
     * Set of sessions that have already had their saved height applied
     *
     * Used to avoid repeated application: each session's input-area height is
     * applied only once on first render. When a session is newly created
     * (not in the set), the saved height is applied.
     */
    private _heightAppliedSessions = new Set<string>();

    /* ── File State (per session, for preview-area rendering) ── */

    /** File state per session: Map<sessionId, {files, uploadProgress, uploadStates, localPreviews}> */
    @state()
    private _fileStates = new Map<string, {
        files: FileAttachment[];
        uploadProgress: Map<string, number>;
        uploadStates: Map<string, string>;
        localPreviews: Map<string, string>;
    }>();

    /* ── Context ── */

    @consume({context: SessionContext, subscribe: true})
    @property({attribute: false})
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

    @consume({context: SessionTabContext, subscribe: true})
    @property({attribute: false})
    private _tabCtx: SessionTabContextValue = {
        state: {tabs: [], activeSessionId: null},
        actions: {
            openOrActivate: () => {},
            closeTab: () => {},
            setActiveTab: () => {},
            clearAll: () => {},
            updateTabTitles: () => {},
            syncTabStatuses: () => {},
            markSaved: () => {},
            findUnsavedTab: () => undefined,
            updateTabStatus: () => {},
            setTransientParams: () => {},
            clearTransientParams: () => {},
            restoreActiveFromStorage: () => false,
            getStoredActiveSessionId: () => null,
        },
    };

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();
        // Listen for rtc-message-sent: event dispatched from rtc-agent (parent component),
        // bubbles up to document. chat-layout must listen on document because
        // the event does not propagate down into shadow DOM child components.
        document.addEventListener('rtc-message-sent', this._boundOnMessageSent);
        // Listen for fork requests: event bubbles up from message components in the chat content area,
        // intercepted on chat-layout itself to orchestrate unsaved tab + dispatch rtc-fork-initiated
        this.addEventListener('rtc-fork-requested', this._boundOnForkRequested);
        // Listen for rtc-session-tree-new: captures event bubbling up from session-header "+" button
        // (takes effect after Phase 6 changes to session-header; Phase 3 wires up the listener first)
        this.addEventListener('rtc-session-tree-new', this._handleSessionTreeNew);
        // Listen for rtc-clear-active-input: dispatched by rtc-agent when Escape key cancels a fork
        this.addEventListener('rtc-clear-active-input', this._boundOnClearActiveInput);
        // Listen for rtc-notification-click: event dispatched from rtc-agent (parent component),
        // must listen on document (same as rtc-message-sent)
        document.addEventListener('rtc-notification-click', this._handleNotificationClick);
        // Listen for global mousemove/mouseup for resize handle drag
        document.addEventListener('mousemove', this._boundOnResizeMouseMove);
        document.addEventListener('mouseup', this._boundOnResizeMouseUp);

        // Phase 4: Set initial visibility for tabs after first render
        this.updateComplete.then(() => {
            const activeSessionId = this._tabCtx?.state?.activeSessionId;
            if (activeSessionId) {
                this._updateTabVisibility(activeSessionId);
            }
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('rtc-message-sent', this._boundOnMessageSent);
        this.removeEventListener('rtc-fork-requested', this._boundOnForkRequested);
        this.removeEventListener('rtc-session-tree-new', this._handleSessionTreeNew);
        this.removeEventListener('rtc-clear-active-input', this._boundOnClearActiveInput);
        document.removeEventListener('rtc-notification-click', this._handleNotificationClick);
        document.removeEventListener('mousemove', this._boundOnResizeMouseMove);
        document.removeEventListener('mouseup', this._boundOnResizeMouseUp);
    }

    /**
     * After component update, check whether saved input-area height needs to be applied
     *
     * After each update, iterate all tabs and apply the saved height from localStorage
     * for sessions that haven't had it applied yet. This ensures:
     * 1. On initial load, saved height is applied immediately after tabs render
     * 2. When creating a new tab, saved height is also applied
     * 3. Each session has height applied only once, avoiding overwriting user's drag adjustments
     */
    protected updated(_changedProperties: PropertyValues): void {
        super.updated(_changedProperties);

        // Check if any tabs are rendered
        const tabs = this._tabCtx?.state?.tabs;
        if (!tabs || tabs.length === 0) return;

        const savedHeight = this._loadInputAreaHeight();
        if (savedHeight === null) return;

        // Apply saved height to each session that hasn't had it applied yet
        for (const tab of tabs) {
            if (this._heightAppliedSessions.has(tab.sessionId)) continue;

            const inputArea = this._getInputAreaBySession(tab.sessionId);
            if (inputArea) {
                inputArea.style.height = `${savedHeight}px`;
                this._heightAppliedSessions.add(tab.sessionId);
            }
        }
    }

    /** Clear the active tab's input box (called for Escape key, etc.) */
    private _boundOnClearActiveInput = () => this.clearActiveInput();

    /** Clear the active tab's input box */
    public clearActiveInput(): void {
        const activeId = this._tabCtx.state.activeSessionId;
        if (!activeId) return;
        for (const el of Array.from(
            this.shadowRoot?.querySelectorAll('rtc-input-area') ?? []
        )) {
            if ((el as HTMLElement & { sessionId: string | null }).sessionId === activeId) {
                (el as HTMLElement & { clearValue: () => void }).clearValue();
                break;
            }
        }
    }

    /* ── File State Methods ── */

    /** Handle file state change from input-area */
    private _handleFilesChanged(e: CustomEvent, sessionId: string): void {
        const detail = e.detail;
        log.debug('[ChatLayout] Received rtc-files-changed for session:', sessionId, {
            files: detail.files.map((f: FileAttachment) => f.fileid),
            states: Array.from(detail.uploadStates.entries()),
        });
        this._fileStates = new Map(this._fileStates).set(sessionId, {
            files: detail.files,
            uploadProgress: detail.uploadProgress,
            uploadStates: detail.uploadStates,
            localPreviews: detail.localPreviews,
        });
    }

    /** Handle file removal from preview-area */
    private _handleFileRemove(e: CustomEvent, sessionId: string): void {
        const inputArea = this._getInputAreaBySession(sessionId);
        if (!inputArea) return;
        const detail = e.detail;
        (inputArea as unknown as { removeFile: (file: FileAttachment, index: number) => void })
            .removeFile(detail.file, detail.index);
    }

    /** Handle file preview request from preview-area */
    private _handleFilePreview(e: CustomEvent, _sessionId: string): void {
        // TODO: Implement file preview modal
        log.debug('File preview requested:', e.detail.file);
    }

    /* ── Resize Handle Methods ── */

    /**
     * Begin dragging resize handle
     *
     * Records initial state, sets drag flag.
     */
    private _handleResizeStart(e: MouseEvent, sessionId: string): void {
        e.preventDefault();
        const inputArea = this._getInputAreaBySession(sessionId);
        if (!inputArea) return;

        this._isResizing = true;
        this._resizeStartY = e.clientY;
        this._resizeStartHeight = inputArea.offsetHeight;
        this._resizeSessionId = sessionId;

        // Add dragging style
        const handle = e.target as HTMLElement;
        handle.classList.add('dragging');

        // Set global styles
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    }

    /** Global mousemove handler */
    private _boundOnResizeMouseMove = (e: MouseEvent): void => {
        if (!this._isResizing || !this._resizeSessionId) return;

        const inputArea = this._getInputAreaBySession(this._resizeSessionId);
        if (!inputArea) return;

        // Calculate new height: drag up = clientY decreases = height increases
        const deltaY = this._resizeStartY - e.clientY;
        const newHeight = Math.max(
            RtcChatLayout.MIN_INPUT_HEIGHT,
            Math.min(RtcChatLayout.MAX_INPUT_HEIGHT, this._resizeStartHeight + deltaY)
        );

        inputArea.style.height = `${newHeight}px`;
    };

    /** Global mouseup handler */
    private _boundOnResizeMouseUp = (): void => {
        if (!this._isResizing) return;

        // Save height to localStorage
        const inputArea = this._resizeSessionId
            ? this._getInputAreaBySession(this._resizeSessionId)
            : null;
        if (inputArea) {
            this._saveInputAreaHeight(inputArea.offsetHeight);
        }

        this._isResizing = false;
        this._resizeSessionId = null;

        // Remove dragging style
        const handles = this.shadowRoot?.querySelectorAll('.resize-handle.dragging');
        handles?.forEach(h => h.classList.remove('dragging'));

        // Restore global styles
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    /**
     * Save input-area height to localStorage
     *
     * Height is a global setting (shared across all tabs), not per-session.
     */
    private _saveInputAreaHeight(height: number): void {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            window.localStorage.setItem(STORAGE_KEYS.inputAreaHeight, String(height));
        } catch {
            // localStorage unavailable (private mode / quota exceeded), ignore
        }
    }

    /**
     * Load input-area height from localStorage
     *
     * Returns null if no saved height exists, use default value.
     */
    private _loadInputAreaHeight(): number | null {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return null;
            const stored = window.localStorage.getItem(STORAGE_KEYS.inputAreaHeight);
            if (!stored) return null;
            const height = parseInt(stored, 10);
            if (isNaN(height)) return null;
            // Ensure within valid range
            return Math.max(
                RtcChatLayout.MIN_INPUT_HEIGHT,
                Math.min(RtcChatLayout.MAX_INPUT_HEIGHT, height)
            );
        } catch {
            return null;
        }
    }

    /**
     * Apply saved height to specified session's input-area
     */
    private _applyStoredHeight(sessionId: string): void {
        const savedHeight = this._loadInputAreaHeight();
        if (savedHeight === null) return;

        const inputArea = this._getInputAreaBySession(sessionId);
        if (inputArea) {
            inputArea.style.height = `${savedHeight}px`;
        }
    }

    /** Get the input-area element for a given sessionId */
    private _getInputAreaBySession(sessionId: string): HTMLElement | null {
        const inputAreas = this.shadowRoot?.querySelectorAll('rtc-input-area');
        if (!inputAreas) return null;

        for (const el of Array.from(inputAreas)) {
            if ((el as HTMLElement & { sessionId: string | null }).sessionId === sessionId) {
                return el as HTMLElement;
            }
        }
        return null;
    }

    /**
     * Core orchestration: ensure an unsaved tab exists
     *
     * - Already has unsaved tab → activate it, return its sessionId
     * - None exists → create new session + open unsaved tab, return newId
     *
     * Synchronous method (no await), ensures double-click "+" is idempotent:
     * second call finds existing tab via findUnsavedTab immediately.
     *
     * @param params Optional transient UI parameters (fork content, notice message, etc.)
     */
    private _ensureUnsavedSession(params?: { initialInputValue?: string; noticeMessage?: string }): string {
        const existing = this._tabCtx.actions.findUnsavedTab();
        if (existing) {
            // Reuse: update transient params
            if (params) {
                this._tabCtx.actions.setTransientParams(existing.sessionId, params);
            }
            this._sessionCtx.actions.switchSession(existing.sessionId);
            this._tabCtx.actions.setActiveTab(existing.sessionId);
            log.debug('Reusing unsaved tab:', existing.sessionId);
            return existing.sessionId;
        }
        // createSession returns new ID synchronously (avoids issue where context async propagation can't read the new currentSessionId)
        const newId = this._sessionCtx.actions.createSession();
        // Key: trigger onSessionSwitch to load new session's messages (empty) and clear old messages
        // createSession itself does not call onSessionSwitch, need to manually trigger switchSession
        this._sessionCtx.actions.switchSession(newId);
        this._tabCtx.actions.openOrActivate(newId, msg('未命名'), {isUnsaved: true, ...params});
        log.debug('Created new unsaved tab:', newId);
        return newId;
    }

    private _boundOnForkRequested = (e: Event) => {
        // Fork flow: user submitted a fork conversation message
        // 1. Reuse/create unsaved tab via _ensureUnsavedSession, passing fork content as transient params
        // 2. Dispatch rtc-fork-initiated with full fork metadata, for rtc-agent to wire to ForkController
        // 3. Lit renders transient params to input-area / notice-bar via property binding
        const {oldMessageClientId, content} = (e as CustomEvent).detail ?? {};
        const oldSessionClientId = this._sessionCtx?.state?.currentSessionId;
        if (!oldSessionClientId) {
            log.warn('No current session, ignoring fork');
            return;
        }
        const truncatedContent = content.length > 30 ? content.slice(0, 30) + '...' : content;
        const newSessionClientId = this._ensureUnsavedSession({
            initialInputValue: content,
            noticeMessage: msg(str`🔀 从「${truncatedContent}」分叉`),
        });
        this.dispatchEvent(
            new CustomEvent('rtc-fork-initiated', {
                bubbles: true,
                composed: true,
                detail: {
                    oldSessionClientId,
                    oldMessageClientId,
                    newSessionClientId,
                    content,
                },
            })
        );
        log.debug('Dispatched rtc-fork-initiated, newSession=', newSessionClientId);
    };

    private _boundOnMessageSent = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        const sessionClientId = detail?.message?.session_client_id;
        if (!sessionClientId) return;

        // Mark tab as saved (unsaved → saved one-way transition)
        this._tabCtx.actions.markSaved(sessionClientId);

        // Fallback: ensure tab exists (covers scenario opened from session tree click but tab not yet created)
        this._ensureTabForSession(sessionClientId);
    };

    /** session-header / session-tree "+" button event forwarded to _handleNewSession */
    private _handleSessionTreeNew = () => {
        log.debug('Event received, calling _handleNewSession');
        this._handleNewSession();
    };

    /** Toast notification click: navigate to corresponding session (with reopen check) */
    private _handleNotificationClick = (e: Event) => {
        const {sessionId} = (e as CustomEvent).detail;
        if (sessionId) {
            void this._openWithReopenCheck(sessionId);
        }
    };

    /**
     * Open or activate tab for specified session
     *
     * Looks up session from SessionContext's sessions list to get the title.
     * If session doesn't exist (e.g., newly created session not yet persisted), uses 'Untitled' as placeholder title.
     * `_loadSessions` will sync real titles later via `updateTabTitles`.
     */
    private _ensureTabForSession(sessionId: string) {
        const session = this._sessionCtx?.state?.sessions.find(
            s => s.clientId === sessionId
        );
        const title = session?.title || msg('未命名');
        this._tabCtx.actions.openOrActivate(sessionId, title);
        log.debug('Opened tab:', sessionId, 'title:', `"${title}"`);
    }

    /* ── Event Handlers ── */

    /**
     * Session tree node click
     *
     * 1. Check session status, if closed then call reopenSession first
     * 2. Open/switch to corresponding tab
     * 3. Switch SessionContext's currentSessionId (triggers chat content refresh)
     */
    private _handleTreeSelect(e: CustomEvent) {
        const {sessionId} = e.detail;
        void this._openWithReopenCheck(sessionId);
    }

    /**
     * Open session (with transparent reopen check)
     *
     * If session status is closed, call reopenSession to reopen it first.
     * After success, perform UI operations (open tab + switch session).
     */
    private async _openWithReopenCheck(sessionId: string) {
        const session = this._sessionCtx?.state?.sessions.find(s => s.clientId === sessionId);

        // Transparent reopen: if session is closed, call openSession first
        if (session?.status === 'closed') {
            const result = await this._sessionCtx.actions.reopenSession(sessionId);
            if (!result.ok) {
                // Show toast notification on failure
                this.dispatchEvent(new CustomEvent('rtc-toast-requested', {
                    bubbles: true,
                    composed: true,
                    detail: {
                        message: msg('重新打开会话失败，请重试'),
                        type: 'error',
                    },
                }));
                return; // Don't open tab
            }
        }

        // Success (or no reopen needed) → perform UI operations synchronously
        this._ensureTabForSession(sessionId);
        this._sessionCtx.actions.switchSession(sessionId);

        this.dispatchEvent(
            new CustomEvent('rtc-chat-layout-session-select', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    /**
     * Expand/collapse click (handled internally by SessionTreeController, no extra logic needed here)
     */
    private _handleTreeToggle() {
        // no-op
    }

    /**
     * New session button click
     *
     * Uses _ensureUnsavedSession to ensure unsaved tab uniqueness:
     * - Already has unsaved tab → focus it
     * - None exists → create new session + open unsaved tab
     *
     * Dispatches rtc-new-session, rtc-agent clears fork state.
     */
    private _handleNewSession() {
        this._ensureUnsavedSession();
        this.dispatchEvent(
            new CustomEvent('rtc-new-session', {bubbles: true, composed: true})
        );
    }

    /**
     * Switch tab
     *
     * Switches SessionContext's currentSessionId.
     */
    private _handleTabActivate(e: CustomEvent) {
        const {sessionId} = e.detail;
        const oldSessionId = this._sessionCtx?.state?.currentSessionId;
        // Clear old tab's transient params (to prevent notice bar residue)
        if (oldSessionId && oldSessionId !== sessionId) {
            this._tabCtx.actions.clearTransientParams(oldSessionId);
        }
        this._sessionCtx.actions.switchSession(sessionId);

        // Phase 4: Notify message lists of visibility changes
        // This prevents skeletonization in hidden tabs and triggers slice checks in visible tabs
        this._updateTabVisibility(sessionId);

        // Apply stored height to the newly activated tab
        // Wait for DOM update to ensure input-area is rendered
        this.updateComplete.then(() => {
            this._applyStoredHeight(sessionId);
        });

        this.dispatchEvent(
            new CustomEvent('rtc-chat-layout-tab-activate', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    /**
     * Phase 4: Update visibility state for all tab message lists.
     * Called when tab switches to notify virtual scroll of visibility changes.
     *
     * @param activeSessionId - The newly activated tab's session ID
     */
    private _updateTabVisibility(activeSessionId: string): void {
        if (!this.shadowRoot) return;

        // Find all tab-content elements and update their message list visibility
        const tabContents = this.shadowRoot.querySelectorAll('.tab-content');
        for (const tabContent of Array.from(tabContents)) {
            const contentArea = tabContent.querySelector('rtc-content-area') as HTMLElement & {
                sessionId?: string | null;
            } | null;
            if (!contentArea) continue;

            const messageList = contentArea.shadowRoot?.querySelector('rtc-message-list') as HTMLElement & {
                onTabVisibilityChange?: (visible: boolean) => void;
            } | null;

            if (messageList && typeof messageList.onTabVisibilityChange === 'function') {
                const isVisible = contentArea.sessionId === activeSessionId;
                messageList.onTabVisibilityChange(isVisible);
            }
        }
    }

    /**
     * Close tab
     *
     * SessionTabController automatically handles adjacent tab activation.
     * If closing the currently active session, need to switch to the newly activated tab;
     * if no tabs remain (requirement 4), immediately call _handleNewSession to create a new unsaved tab.
     *
     * Note: cannot read post-close state via this._tabCtx.state,
     * because @consume context updates are asynchronous (wait for Lit's next render cycle).
     * Here we synchronously calculate remaining tabs to determine next step.
     */
    /**
     * Handle tab close event: close session on backend, switch to adjacent tab,
     * or create new unsaved tab if no tabs remain.
     *
     * Fix 44: If closeSession fails, restore the tab and show error toast.
     */
    private async _handleTabClose(e: CustomEvent) {
        const {sessionId} = e.detail;
        const wasActive = this._sessionCtx?.state?.currentSessionId === sessionId;

        // Save tab snapshot before closing (for potential restore on failure)
        const tabSnapshot = this._tabCtx.state.tabs.find(t => t.sessionId === sessionId);

        // ── Notify backend to close session (only for saved sessions; unsaved tabs have no backend session) ──
        if (tabSnapshot && !tabSnapshot.isUnsaved) {
            // Close tab optimistically (UI updates immediately)
            this.dispatchEvent(
                new CustomEvent('rtc-chat-layout-tab-close', {
                    bubbles: true,
                    composed: true,
                    detail: {sessionId},
                })
            );

            // Notify MessageController to evict this session's cache (prevent memory leak)
            this.messageController?.evictSession(sessionId);

            try {
                await this._sessionCtx.actions.closeSession(sessionId);
            } catch (err) {
                log.error('closeSession failed, restoring tab:', err);

                // Fix: Wrap restore logic in try/catch to prevent unhandled rejection
                // if the component unmounts during the await or restore fails
                try {
                    // Restore the tab
                    if (tabSnapshot && this._tabCtx) {
                        this._tabCtx.actions.openOrActivate(
                            sessionId,
                            tabSnapshot.title,
                            { activate: true }
                        );
                    }

                    // Notify user
                    this.dispatchEvent(new CustomEvent('rtc-toast-requested', {
                        bubbles: true,
                        composed: true,
                        detail: {
                            message: msg('关闭会话失败，请重试'),
                            type: 'error',
                        },
                    }));
                } catch (restoreErr) {
                    log.error('Failed to restore tab after closeSession error:', restoreErr);
                }
                return;
            }
        } else {
            // Unsaved tab or no tab found - just close without backend call
            this.dispatchEvent(
                new CustomEvent('rtc-chat-layout-tab-close', {
                    bubbles: true,
                    composed: true,
                    detail: {sessionId},
                })
            );

            // Notify MessageController to evict this session's cache (prevent memory leak)
            this.messageController?.evictSession(sessionId);
        }

        if (wasActive) {
            // Synchronously calculate: how many tabs remain after closing this one
            const remainingTabs = this._tabCtx.state.tabs.filter(
                t => t.sessionId !== sessionId
            );

            if (remainingTabs.length > 0) {
                // Still have tabs: activate adjacent one
                let closedIndex = this._tabCtx.state.tabs.findIndex(
                    t => t.sessionId === sessionId
                );
                // closeTab() may have already removed the tab before this handler runs,
                // so findIndex can return -1. Fall back to the end of remaining list.
                if (closedIndex < 0) {
                    closedIndex = remainingTabs.length;
                }
                const nextIndex = Math.min(closedIndex, remainingTabs.length - 1);
                const nextSessionId = remainingTabs[nextIndex].sessionId;
                this._sessionCtx.actions.switchSession(nextSessionId);
            } else {
                // Requirement 4: all closed → immediately create new unsaved session
                // First clear old session's messages/selection state (clearCurrentSession triggers onSessionSwitch to clear messages)
                this._sessionCtx.actions.clearCurrentSession();
                this._handleNewSession();
            }
        }
    }

    /* ── Render ── */

    private _renderFilePreview(sessionId: string) {
        const fileState = this._fileStates.get(sessionId);
        if (!fileState || fileState.files.length === 0) {
            return '';
        }
        return html`
            <rtc-file-preview-area
                .files=${fileState.files}
                .uploadProgress=${fileState.uploadProgress}
                .uploadStates=${fileState.uploadStates}
                .localPreviews=${fileState.localPreviews}
                @rtc-file-remove=${(e: CustomEvent) => this._handleFileRemove(e, sessionId)}
                @rtc-file-preview=${(e: CustomEvent) => this._handleFilePreview(e, sessionId)}
            ></rtc-file-preview-area>
        `;
    }

    private _renderChatContent() {
        // Guard: wait for tab context to be available
        if (!this._tabCtx?.state) {
            return html`
                <div class="tab-content-wrapper">
                    <div class="no-session-hint">
                        ${msg('打开一个会话即可开始')}
                    </div>
                </div>
            `;
        }

        const {tabs, activeSessionId} = this._tabCtx.state;

        // When no tabs are open (theoretically shouldn't happen, as closing all auto-creates a new tab)
        // Show hint text
        if (tabs.length === 0) {
            return html`
                <div class="tab-content-wrapper">
                    <div class="no-session-hint">
                        ${msg('打开一个会话即可开始')}
                    </div>
                </div>
            `;
        }

        // Render all open tabs, each with its own content-area instance
        // Non-active tabs use content-visibility: hidden to preserve state
        // Use repeat() directive to ensure stable identity for each tab-content
        // This prevents DOM recycling issues when tabs array changes (e.g., closing a tab)
        return html`
            <div class="tab-content-wrapper">
                ${repeat(tabs, tab => tab.sessionId, tab => html`
                    <div class="tab-content ${tab.sessionId === activeSessionId ? 'active' : ''}">
                        <rtc-content-area
                            theme=${this.theme}
                            .sessionId=${tab.sessionId}
                            ?is-unsaved=${tab.isUnsaved}
                            .messageController=${this.messageController}
                        ></rtc-content-area>
                        <rtc-notice-bar
                            .message=${tab.noticeMessage ?? ''}
                        ></rtc-notice-bar>
                        <div
                            class="resize-handle"
                            @mousedown=${(e: MouseEvent) => this._handleResizeStart(e, tab.sessionId)}
                            title="Drag to resize"
                        ></div>
                        ${this._renderFilePreview(tab.sessionId)}
                        <rtc-input-area
                            theme=${this.theme}
                            .sessionId=${tab.sessionId}
                            .initialValue=${tab.initialInputValue}
                            .initialValueVersion=${tab.initialValueVersion ?? 0}
                            @rtc-files-changed=${(e: CustomEvent) => this._handleFilesChanged(e, tab.sessionId)}
                        ></rtc-input-area>
                        <rtc-overlay-manager></rtc-overlay-manager>
                    </div>
                `)}
            </div>
        `;
    }

    render() {
        void this._localeCtx.locale;
        return html`
            <!-- Left column: session tree (implemented via rtc-drawer overlay) -->
            <rtc-drawer ?open=${this.sessionTreeVisible}>
                <rtc-session-tree
                    theme=${this.theme}
                    selected-session-id=${this._sessionCtx?.state?.currentSessionId ?? ''}
                    @rtc-session-tree-select=${this._handleTreeSelect}
                    @rtc-session-tree-toggle=${this._handleTreeToggle}
                ></rtc-session-tree>
            </rtc-drawer>

            <!-- Right column: tabs + chat content -->
            <div class="main">
                <div class="tab-bar">
                    <rtc-session-tab-bar
                        theme=${this.theme}
                        @rtc-session-tab-bar-activate=${this._handleTabActivate}
                        @rtc-session-tab-bar-close=${this._handleTabClose}
                    ></rtc-session-tab-bar>
                </div>
                ${this._renderChatContent()}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-chat-layout': RtcChatLayout;
    }

    interface HTMLElementEventMap {
        'rtc-chat-layout-session-select': CustomEvent<{sessionId: string}>;
        'rtc-chat-layout-tab-activate': CustomEvent<{sessionId: string}>;
        'rtc-chat-layout-tab-close': CustomEvent<{sessionId: string}>;
    }
}
