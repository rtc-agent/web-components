/**
 * Event Binding Controller
 *
 * Centralizes all DOM event listener bindings for <rtc-agent>. This controller
 * manages the lifecycle of 30+ event handlers, ensuring proper cleanup and
 * reducing the root component's size by ~300 lines.
 *
 * ## Architecture
 *
 * The controller receives dependencies via constructor injection (all controllers
 * and callbacks needed by event handlers) and provides:
 * - Bound handler references (arrow functions stored as instance fields)
 * - `bindEvents(element)` to attach all listeners in connectedCallback
 * - `unbindEvents(element)` to detach all listeners in disconnectedCallback
 *
 * ## Event Categories
 *
 * - Window control: minimize, maximize, restore
 * - Authentication: login requested, logout
 * - Session management: new session, delete, rename
 * - Message handling: input submit, stop, resend, fork
 * - Toast notifications: requested, close
 * - Slash commands: command requested
 * - VS Code layout: activity change, file select, folder toggle
 * - Editor area: save, tab close/select, content change, view mode, cursor, restore
 * - Chat layout: session select, tab activate/close
 * - UI interactions: keydown, wheel, drawer close, file explorer refresh
 *
 * @module EventBindingController
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {Activity, ContentData} from '../types/index.js';
import type {WindowStateController} from './window-state.controller.js';
import type {AuthController} from './auth.controller.js';
import type {SessionController} from './session.controller.js';
import type {MessageController} from './message.controller.js';
import type {ToolCallController} from './tool-call.controller.js';
import type {WindowInteractionController} from './window-interaction.controller.js';
import type {PersistenceController} from './persistence.controller.js';
import type {SkillController} from './skill.controller.js';
import type {ToastController} from './toast.controller.js';
import type {ForkController} from './fork.controller.js';
import type {ActivityController} from './activity.controller.js';
import type {FileExplorerController} from './file-explorer.controller.js';
import type {EditorAreaController} from './editor-area.controller.js';
import type {StatusBarController} from './status-bar.controller.js';
import type {SessionTreeController} from './session-tree.controller.js';
import type {SessionTabController} from './session-tab.controller.js';
import type {SettingsController} from './settings.controller.js';
import type {NotificationController} from './notification.controller.js';
import type {Logger} from '@rtc-agent/client';

/**
 * Dependencies required by EventBindingController.
 *
 * All controllers and callbacks needed by event handlers are injected here.
 * This avoids circular dependencies and keeps the controller decoupled from
 * the root component's internal state.
 */
export interface EventBindingDeps {
    // Controllers
    windowState: WindowStateController;
    auth: AuthController;
    session: SessionController;
    message: MessageController;
    toolCall: ToolCallController;
    interaction: WindowInteractionController;
    persistence: PersistenceController;
    skill: SkillController;
    toast: ToastController;
    fork: ForkController;
    activity: ActivityController;
    fileExplorer: FileExplorerController;
    editorArea: EditorAreaController;
    statusBar: StatusBarController;
    sessionTree: SessionTreeController;
    sessionTab: SessionTabController;
    settings: SettingsController;
    notification: NotificationController;

    // State accessors (for logout handler)
    autoSaveTimers: Map<string, ReturnType<typeof setTimeout>>;
    getRtcProcessor: () => any;
    setRtcProcessor: (value: any) => void;
    getUnsubConnection: () => (() => void) | undefined;
    setUnsubConnection: (value: (() => void) | undefined) => void;
    getConnectGeneration: () => number;
    bumpConnectGeneration: () => void;
    getConnecting: () => Promise<void> | undefined;
    setConnecting: (value: Promise<void> | undefined) => void;

    // File tree state
    fileTreeLoaded: () => boolean;
    setFileTreeLoaded: (value: boolean) => void;
    initialSessionLoadDone: () => boolean;
    setInitialSessionLoadDone: (value: boolean) => void;

    // Callbacks
    loadFileTree: () => Promise<void>;
    loadFolderChildren: (path: string) => Promise<void>;
    handleFileOpen: (path: string) => Promise<void>;
    handleEditorSave: (path: string) => Promise<void>;
    handleRestoreDefault: (path: string) => Promise<{success: boolean; error?: string}>;
    loadSessions: () => Promise<void>;
    handleCommand: (name: string, args?: string) => Promise<void>;
    beforeMessageSend: (detail: {message: {content: string; metadata?: Record<string, unknown>}}) => Promise<boolean>;
    showRestoreConfirmDialog: (path: string, root: ShadowRoot) => Promise<boolean>;
    handleLoginRequested: (event: Event) => void;
    dispatchClearActiveInput: () => void;
    getShadowRoot: () => ShadowRoot;
    findScrollableParent: (el: Element) => Element | null;
    scheduleAutoSave: (filePath: string) => void;

    // Logger
    log: Logger;
}

/**
 * EventBindingController centralizes all DOM event listener management.
 *
 * Reduces rtc-agent.ts size by ~300 lines by extracting:
 * - 30+ bound handler declarations (arrow functions as class fields)
 * - Event listener attachment in connectedCallback
 * - Event listener removal in disconnectedCallback
 *
 * @example
 * ```typescript
 * // In rtc-agent.ts connectedCallback:
 * this._eventBindings = new EventBindingController(this, deps);
 * this._eventBindings.bindEvents(this);
 *
 * // In disconnectedCallback:
 * this._eventBindings.unbindEvents(this);
 * ```
 */
export class EventBindingController implements ReactiveController {
    host: ReactiveControllerHost;
    private deps: EventBindingDeps;

    // ── Bound Event Handlers ──
    // Each handler is an arrow function to preserve `this` context.
    // Stored as instance fields so we can remove them in unbindEvents.

    // Window control
    private _boundOnMinimize!: () => void;
    private _boundOnMaximize!: () => void;
    private _boundOnRestore!: () => void;

    // Authentication
    private _boundOnLoginRequested!: (event: Event) => void;
    private _boundOnLogout!: () => void;
    private _boundOnAccountBanned!: () => void;

    // Session management
    private _boundOnNewSession!: () => void;
    private _boundOnSessionDeleteRequested!: (e: Event) => Promise<void>;
    private _boundOnSessionRenameConfirmed!: (e: Event) => Promise<void>;

    // Message handling
    private _boundOnInputSubmit!: (e: Event) => Promise<void>;
    private _boundOnForkInitiated!: (e: Event) => void;
    private _boundOnStopRequested!: (e: Event) => void;
    private _boundOnResendMessage!: (e: Event) => void;

    // Toast notifications
    private _boundOnToastRequested!: (e: Event) => void;
    private _boundOnToastClose!: (e: Event) => void;

    // Slash commands
    private _boundOnCommandRequested!: (e: Event) => void;

    // VS Code layout
    private _boundOnActivityChange!: (e: Event) => void;
    private _boundOnFileSelect!: (e: Event) => void;
    private _boundOnFolderToggle!: (e: Event) => void;
    private _boundOnFileExplorerRefresh!: () => void;

    // Editor area (9 handlers)
    private _boundOnEditorAreaSave!: (e: Event) => void;
    private _boundOnEditorAreaTabClose!: (e: Event) => void;
    private _boundOnEditorAreaTabSelect!: (e: Event) => void;
    private _boundOnEditorAreaContentChange!: (e: Event) => void;
    private _boundOnEditorAreaViewModeChange!: (e: Event) => void;
    private _boundOnEditorAreaCursorMove!: (e: Event) => void;
    private _boundOnEditorAreaRestoreDefault!: (e: Event) => Promise<void>;

    // Chat layout (3 handlers)
    private _boundOnChatLayoutSessionSelect!: (e: Event) => void;
    private _boundOnChatLayoutTabActivate!: (e: Event) => void;
    private _boundOnChatLayoutTabClose!: (e: Event) => void;

    // UI interactions
    private _boundOnKeydown!: (e: KeyboardEvent) => void;
    private _boundOnWheel!: (e: WheelEvent) => void;
    private _boundOnDrawerClose!: () => void;

    constructor(host: ReactiveControllerHost, deps: EventBindingDeps) {
        this.host = host;
        this.deps = deps;
        this.host.addController(this);

        // Initialize all bound handlers
        this._initializeHandlers();
    }

    hostConnected() {}
    hostDisconnected() {
        // Auto-cleanup when host is disconnected
        this.unbindEvents(this.host as unknown as Element);
    }

    /**
     * Initialize all bound event handlers.
     *
     * Each handler is an arrow function that captures `this` and delegates
     * to the appropriate controller or callback. Handlers are stored as
     * instance fields so they can be removed in unbindEvents.
     */
    private _initializeHandlers() {
        const {
            windowState, auth, session, message, persistence, toast, fork, activity,
            fileExplorer, editorArea, settings, sessionTab, autoSaveTimers,
            getRtcProcessor, setRtcProcessor,
            getUnsubConnection, setUnsubConnection,
            bumpConnectGeneration,
            setConnecting,
            fileTreeLoaded, setFileTreeLoaded,
            setInitialSessionLoadDone,
            loadFileTree, loadFolderChildren, handleFileOpen, handleEditorSave,
            handleRestoreDefault, handleCommand, beforeMessageSend,
            showRestoreConfirmDialog, handleLoginRequested, dispatchClearActiveInput,
            getShadowRoot, findScrollableParent, scheduleAutoSave, log
        } = this.deps;

        // ── Window Control ──
        this._boundOnMinimize = () => windowState.actions.minimize();
        this._boundOnMaximize = () => windowState.actions.maximize();
        this._boundOnRestore = () => windowState.actions.restore();

        // ── Authentication ──
        this._boundOnLoginRequested = (event: Event) => {
            handleLoginRequested(event);
        };

        this._boundOnLogout = () => {
            // Clear auto-save timers
            for (const timer of autoSaveTimers.values()) {
                clearTimeout(timer);
            }
            autoSaveTimers.clear();

            // Reset state flags
            setFileTreeLoaded(false);
            setInitialSessionLoadDone(false);

            // Reset UI state
            editorArea.actions.closeAll();
            sessionTab.actions.clearAll();
            activity.actions.setActivity('chat');

            // Clean up existing state
            fork.actions.clearFork();
            // FIX #61: Cancel any running processLoop before clearing reference
            const rtcProcessor = getRtcProcessor();
            rtcProcessor?.cancel();
            setRtcProcessor(undefined);

            // Unsubscribe connection state listener
            const unsubConnection = getUnsubConnection();
            unsubConnection?.();
            setUnsubConnection(undefined);

            // Invalidate in-flight connection attempt
            bumpConnectGeneration();
            setConnecting(undefined);

            void persistence.disconnect();
            session.actions.reset();
            message.actions.clearMessages();
        };

        // Handle account banned (disconnect code 4501)
        this._boundOnAccountBanned = () => {
            log.warn('account banned, triggering logout');
            // Show error toast
            toast.actions.show('您的账号已被封禁，请联系管理员', 'error');
            // Call auth logout to update auth state and trigger the full logout flow
            auth.actions.logout();
        };

        // ── Session Management ──
        this._boundOnNewSession = () => {
            fork.actions.clearFork();
            // Don't clear messages: _handleNewSession already created a new session
            if (!session.value.state.currentSessionId) {
                message.actions.clearMessages();
            }
        };

        this._boundOnSessionDeleteRequested = async (e: Event) => {
            const {sessionId} = (e as CustomEvent).detail;
            log.debug('session delete requested:', sessionId);

            const result = await session.actions.deleteSession(sessionId);
            if (result.ok) {
                toast.actions.show('会话已删除', 'success');
            } else {
                const errorMap: Record<string, string> = {
                    'delete-failed': '删除失败，请稍后重试',
                };
                toast.actions.show(errorMap[result.error ?? ''] ?? result.error ?? '删除失败', 'error');
            }
        };

        this._boundOnSessionRenameConfirmed = async (e: Event) => {
            const {sessionId, title} = (e as CustomEvent).detail;
            if (!title.trim()) return;
            const result = await session.actions.renameSession(sessionId, title.trim());
            if (!result.ok) {
                const errorMap: Record<string, string> = {
                    'rename-failed': '重命名失败，请稍后重试',
                };
                toast.actions.show(errorMap[result.error ?? ''] ?? result.error ?? '重命名失败', 'error');
            }
        };

        // ── Message Handling ──
        this._boundOnInputSubmit = async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const contentData: ContentData = detail.contentData;

            // Apply beforeMessageSend interception
            const extractText = (data: unknown): string =>
                typeof data === 'string' ? data : '';
            const currentText = extractText(contentData.data);
            const messageDetail = {
                message: {
                    content: currentText,
                    metadata: undefined as Record<string, unknown> | undefined,
                },
            };
            const shouldSend = await beforeMessageSend(messageDetail);
            if (!shouldSend) {
                return;
            }
            if (messageDetail.message.content !== currentText) {
                contentData.data = messageDetail.message.content;
            }

            try {
                if (fork.isActive) {
                    await fork.actions.submitFork(contentData);
                } else {
                    await message.actions.sendMessage(contentData);
                }

                // Promote unsaved tab to saved
                const currentId = session.value.state.currentSessionId;
                if (currentId) {
                    sessionTab.actions.markSaved(currentId);
                }
            } catch (err) {
                log.error('message submit failed:', err);
            }
        };

        this._boundOnForkInitiated = (e: Event) => {
            const {oldSessionClientId, oldMessageClientId, newSessionClientId, content} =
                (e as CustomEvent).detail;
            fork.actions.requestFork(
                oldSessionClientId, oldMessageClientId, newSessionClientId, content
            );
        };

        this._boundOnStopRequested = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (persistence.layer) {
                void persistence.layer.stopTurn(detail.sessionClientId);
            }
        };

        this._boundOnResendMessage = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const msg = detail.message;
            if (msg?.clientId && msg?.content) {
                void message.actions.resendMessage(msg.clientId, msg.content);
            }
        };

        // ── Toast Notifications ──
        this._boundOnToastRequested = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            toast.actions.show(detail.message, detail.type);
        };

        this._boundOnToastClose = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            toast.actions.remove(detail.id);
        };

        // ── Slash Commands ──
        this._boundOnCommandRequested = (e: Event) => {
            const detail = (e as CustomEvent).detail as {name: string; args?: string};
            void handleCommand(detail.name, detail.args);
        };

        // ── VS Code Layout ──
        this._boundOnActivityChange = (e: Event) => {
            const {activity: activityName, toggleSidebar} = (e as CustomEvent).detail as {
                activity: Activity;
                toggleSidebar: boolean;
            };
            if (toggleSidebar) {
                activity.actions.toggleSidebar();
            } else {
                activity.actions.setActivity(activityName);
                if (activityName === 'settings') {
                    activity.actions.showSidebar();
                }
                if (activityName === 'files' && !fileTreeLoaded() && persistence.isConnected) {
                    void loadFileTree();
                }
            }
        };

        this._boundOnFileSelect = (e: Event) => {
            const {path} = (e as CustomEvent).detail as {path: string};
            void handleFileOpen(path);
        };

        this._boundOnFolderToggle = (e: Event) => {
            const {path} = (e as CustomEvent).detail as {path: string};
            if (fileExplorer.value.isExpanded(path)) {
                log.debug('_boundOnFolderToggle: loading children for', path);
                void loadFolderChildren(path);
            }
        };

        this._boundOnFileExplorerRefresh = () => {
            void loadFileTree();
        };

        // ── Editor Area ──
        this._boundOnEditorAreaSave = (e: Event) => {
            const {filePath} = (e as CustomEvent).detail as {filePath: string};
            void handleEditorSave(filePath);
        };

        this._boundOnEditorAreaTabClose = (e: Event) => {
            const {filePath} = (e as CustomEvent).detail as {filePath: string};
            const timer = autoSaveTimers.get(filePath);
            if (timer) {
                clearTimeout(timer);
                autoSaveTimers.delete(filePath);
            }
            editorArea.actions.closeFile(filePath);
        };

        this._boundOnEditorAreaTabSelect = (e: Event) => {
            const {filePath} = (e as CustomEvent).detail as {filePath: string};
            editorArea.actions.switchTab(filePath);
        };

        this._boundOnEditorAreaContentChange = (e: Event) => {
            const {filePath, content} = (e as CustomEvent).detail as {filePath: string; content: string};
            editorArea.actions.updateContent(filePath, content);

            if (settings.value.state.files.autoSave) {
                scheduleAutoSave(filePath);
            }
        };

        this._boundOnEditorAreaViewModeChange = (e: Event) => {
            const {filePath, viewMode} = (e as CustomEvent).detail as {filePath: string; viewMode: 'edit' | 'preview' | 'split'};
            editorArea.actions.setViewMode(filePath, viewMode);
        };

        this._boundOnEditorAreaCursorMove = (e: Event) => {
            const position = (e as CustomEvent).detail as {line: number; column: number};
            const activeFilePath = editorArea.activeFilePath;
            if (activeFilePath) {
                editorArea.actions.setCursorPosition(activeFilePath, position);
            }
        };

        this._boundOnEditorAreaRestoreDefault = async (e: Event) => {
            const {filePath} = (e as CustomEvent).detail as {filePath: string};

            const confirmed = await showRestoreConfirmDialog(filePath, getShadowRoot());
            if (!confirmed) return;

            const result = await handleRestoreDefault(filePath);

            if (result.success) {
                toast.actions.show('已恢复默认内容', 'success');
            } else {
                toast.actions.show(result.error ?? '恢复失败', 'error');
            }
        };

        // ── Chat Layout ──
        this._boundOnChatLayoutSessionSelect = (e: Event) => {
            const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
            log.debug('chat-layout session selected:', sessionId);
        };

        this._boundOnChatLayoutTabActivate = (e: Event) => {
            const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
            log.debug('chat-layout tab activated:', sessionId);
        };

        this._boundOnChatLayoutTabClose = (e: Event) => {
            const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
            log.debug('chat-layout tab closed:', sessionId);
        };

        // ── UI Interactions ──
        this._boundOnKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && fork.isActive) {
                fork.actions.clearFork();
                dispatchClearActiveInput();
                return;
            }

            if (activity.active !== 'files') return;
            const mod = e.metaKey || e.ctrlKey;
            if (!mod) return;

            if (e.key === 's' || e.key === 'S') {
                const activePath = editorArea.state.activeFilePath;
                if (activePath) {
                    e.preventDefault();
                    void handleEditorSave(activePath);
                }
            } else if (e.key === 'w' || e.key === 'W') {
                const activePath = editorArea.state.activeFilePath;
                if (activePath) {
                    e.preventDefault();
                    editorArea.actions.closeFile(activePath);
                }
            }
        };

        this._boundOnWheel = (e: WheelEvent) => {
            const rawTarget = e.composedPath()[0];
            const target = rawTarget instanceof Element ? rawTarget : null;
            const scrollable = target ? findScrollableParent(target) : null;

            if (!scrollable) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const {scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth} = scrollable;

            const atTop = scrollTop <= 0;
            const atBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight;
            const scrollingUp = e.deltaY < 0;
            const scrollingDown = e.deltaY > 0;
            const isVertScrollable = scrollHeight > clientHeight;

            const atLeft = scrollLeft <= 0;
            const atRight = Math.ceil(scrollLeft + clientWidth) >= scrollWidth;
            const scrollingLeft = e.deltaX < 0 || (e.shiftKey && e.deltaY < 0);
            const scrollingRight = e.deltaX > 0 || (e.shiftKey && e.deltaY > 0);
            const isHorizScrollable = scrollWidth > clientWidth;

            const atVerticalBoundary = isVertScrollable && ((atTop && scrollingUp) || (atBottom && scrollingDown));
            const atHorizontalBoundary = isHorizScrollable && ((atLeft && scrollingLeft) || (atRight && scrollingRight));

            if (atVerticalBoundary || atHorizontalBoundary) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        this._boundOnDrawerClose = () => {
            activity.actions.hideSidebar();
        };
    }

    /**
     * Bind all event listeners to the specified element.
     *
     * Call this in connectedCallback after controllers are initialized.
     *
     * @param element The element to attach listeners to (typically `this` in rtc-agent.ts)
     */
    bindEvents(element: Element) {
        // Window control
        element.addEventListener('rtc-window-minimize', this._boundOnMinimize);
        element.addEventListener('rtc-window-maximize', this._boundOnMaximize);
        element.addEventListener('rtc-window-restore', this._boundOnRestore);

        // Authentication
        // FIX: Use consistent event name 'rtc-auth-login-requested' as defined in types/events.ts
        element.addEventListener('rtc-auth-login-requested', this._boundOnLoginRequested);
        element.addEventListener('rtc-auth-logout', this._boundOnLogout);
        element.addEventListener('rtc-account-banned', this._boundOnAccountBanned);

        // Session management
        element.addEventListener('rtc-new-session', this._boundOnNewSession);
        element.addEventListener('rtc-session-delete-requested', this._boundOnSessionDeleteRequested);
        element.addEventListener('rtc-session-rename-confirmed', this._boundOnSessionRenameConfirmed);

        // Message handling
        element.addEventListener('rtc-input-submit', this._boundOnInputSubmit);
        element.addEventListener('rtc-fork-initiated', this._boundOnForkInitiated);
        element.addEventListener('rtc-stop-requested', this._boundOnStopRequested);
        element.addEventListener('rtc-user-message-resend', this._boundOnResendMessage);

        // Toast notifications
        element.addEventListener('rtc-toast-requested', this._boundOnToastRequested);
        element.addEventListener('rtc-toast-close', this._boundOnToastClose);

        // Slash commands
        element.addEventListener('rtc-command-requested', this._boundOnCommandRequested);

        // VS Code layout
        element.addEventListener('activity-change', this._boundOnActivityChange);
        element.addEventListener('file-select', this._boundOnFileSelect);
        element.addEventListener('folder-toggle', this._boundOnFolderToggle);
        element.addEventListener('refresh-requested', this._boundOnFileExplorerRefresh);

        // Editor area
        element.addEventListener('editor-area-save', this._boundOnEditorAreaSave);
        element.addEventListener('editor-area-tab-close', this._boundOnEditorAreaTabClose);
        element.addEventListener('editor-area-tab-select', this._boundOnEditorAreaTabSelect);
        element.addEventListener('editor-area-content-change', this._boundOnEditorAreaContentChange);
        element.addEventListener('editor-area-view-mode-change', this._boundOnEditorAreaViewModeChange);
        element.addEventListener('editor-area-cursor-move', this._boundOnEditorAreaCursorMove);
        element.addEventListener('editor-area-restore-default', this._boundOnEditorAreaRestoreDefault);

        // Chat layout
        element.addEventListener('rtc-chat-layout-session-select', this._boundOnChatLayoutSessionSelect);
        element.addEventListener('rtc-chat-layout-tab-activate', this._boundOnChatLayoutTabActivate);
        element.addEventListener('rtc-chat-layout-tab-close', this._boundOnChatLayoutTabClose);

        // UI interactions
        element.addEventListener('rtc-drawer-close', this._boundOnDrawerClose);
        element.addEventListener('keydown', this._boundOnKeydown as EventListener);
        element.addEventListener('wheel', this._boundOnWheel as EventListener, {passive: false});
    }

    /**
     * Unbind all event listeners from the specified element.
     *
     * Call this in disconnectedCallback to prevent memory leaks.
     *
     * @param element The element to detach listeners from (typically `this` in rtc-agent.ts)
     */
    unbindEvents(element: Element) {
        // Window control
        element.removeEventListener('rtc-window-minimize', this._boundOnMinimize);
        element.removeEventListener('rtc-window-maximize', this._boundOnMaximize);
        element.removeEventListener('rtc-window-restore', this._boundOnRestore);

        // Authentication
        // FIX: Use consistent event name 'rtc-auth-login-requested' as defined in types/events.ts
        element.removeEventListener('rtc-auth-login-requested', this._boundOnLoginRequested);
        element.removeEventListener('rtc-auth-logout', this._boundOnLogout);
        element.removeEventListener('rtc-account-banned', this._boundOnAccountBanned);

        // Session management
        element.removeEventListener('rtc-new-session', this._boundOnNewSession);
        element.removeEventListener('rtc-session-delete-requested', this._boundOnSessionDeleteRequested);
        element.removeEventListener('rtc-session-rename-confirmed', this._boundOnSessionRenameConfirmed);

        // Message handling
        element.removeEventListener('rtc-input-submit', this._boundOnInputSubmit);
        element.removeEventListener('rtc-fork-initiated', this._boundOnForkInitiated);
        element.removeEventListener('rtc-stop-requested', this._boundOnStopRequested);
        element.removeEventListener('rtc-user-message-resend', this._boundOnResendMessage);

        // Toast notifications
        element.removeEventListener('rtc-toast-requested', this._boundOnToastRequested);
        element.removeEventListener('rtc-toast-close', this._boundOnToastClose);

        // Slash commands
        element.removeEventListener('rtc-command-requested', this._boundOnCommandRequested);

        // VS Code layout
        element.removeEventListener('activity-change', this._boundOnActivityChange);
        element.removeEventListener('file-select', this._boundOnFileSelect);
        element.removeEventListener('folder-toggle', this._boundOnFolderToggle);
        element.removeEventListener('refresh-requested', this._boundOnFileExplorerRefresh);

        // Editor area
        element.removeEventListener('editor-area-save', this._boundOnEditorAreaSave);
        element.removeEventListener('editor-area-tab-close', this._boundOnEditorAreaTabClose);
        element.removeEventListener('editor-area-tab-select', this._boundOnEditorAreaTabSelect);
        element.removeEventListener('editor-area-content-change', this._boundOnEditorAreaContentChange);
        element.removeEventListener('editor-area-view-mode-change', this._boundOnEditorAreaViewModeChange);
        element.removeEventListener('editor-area-cursor-move', this._boundOnEditorAreaCursorMove);
        element.removeEventListener('editor-area-restore-default', this._boundOnEditorAreaRestoreDefault);

        // Chat layout
        element.removeEventListener('rtc-chat-layout-session-select', this._boundOnChatLayoutSessionSelect);
        element.removeEventListener('rtc-chat-layout-tab-activate', this._boundOnChatLayoutTabActivate);
        element.removeEventListener('rtc-chat-layout-tab-close', this._boundOnChatLayoutTabClose);

        // UI interactions
        element.removeEventListener('rtc-drawer-close', this._boundOnDrawerClose);
        element.removeEventListener('keydown', this._boundOnKeydown as EventListener);
        element.removeEventListener('wheel', this._boundOnWheel as EventListener);
    }

    /**
     * Get handler references for use in templates.
     *
     * Some handlers are used directly in templates (e.g., `@click=${handler}`).
     * This getter provides access to those handlers.
     */
    get handlers() {
        return {
            onLoginRequested: this._boundOnLoginRequested,
        };
    }
}
