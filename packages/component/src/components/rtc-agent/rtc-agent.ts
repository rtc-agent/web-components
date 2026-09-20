/**
 * RTC Agent — Root Component
 *
 * The only public custom element exposed by the library. This component is a
 * pure "assembler": it creates Reactive Controllers, wires each controller's
 * value to a @lit/context provider, and renders the top-level shell UI.
 *
 * All state logic (session, message, tool call, auth, mode, window state,
 * toast, fork) is delegated to controllers in `src/controllers/`. This keeps
 * the root component lean and well within the 300-line limit.
 *
 * @element rtc-agent
 *
 * @cssprop [--rtc-window-default-width=420px] - Default window width
 * @cssprop [--rtc-window-default-height=640px] - Default window height
 * @cssprop [--rtc-bubble-size=40px] - Minimized bubble diameter
 * @cssprop [--rtc-bubble-bg] - Bubble background (defaults to --rtc-color-bg-secondary)
 *
 * @attr {string} [theme=system] - Theme: 'light' | 'dark' | 'system'
 * @attr {string} [app-label=RTC Agent] - Application label (title bar + bubble tooltip)
 * @attr {string} [bubble-icon] - SVG/HTML string rendered inside the minimized bubble
 * @attr {string} [scenarios-url] - URL to load scenario documents from (auto-loads manifest.json + .md files)
 * @attr {string} [server-url] - Backend server URL (overrides VITE_SERVER_URL env and the default http://localhost:28080)
 *
 * @attr {string} [data-mode='normal'|'maximized'|'minimized'] - Reflected window state
 *
 * ## Event Naming Convention
 *
 * All public events dispatched by <rtc-agent> follow the pattern:
 *   `rtc-<domain>-<action>-<past-tense>`
 *
 * Examples: rtc-session-created, rtc-message-sent, rtc-auth-login-requested
 *
 * ### Event prefix taxonomy:
 * - `rtc-*`         : Public API events (external developers listen to these)
 * - No prefix       : Internal component events (may change without notice)
 * - `demo-*`        : Demo/test-only events (not for production use)
 *
 * ### Architecture — Reactive Controller Pattern:
 * - Each controller encapsulates one context's state + actions
 * - Root creates controllers and wires them to context providers
 * - Controllers call `host.requestUpdate()` after state mutations
 * - Root syncs controller.value to provider via `updated()` lifecycle + `updateComplete` Promise
 * - Using `updateComplete` ensures Context consumers update after host finishes, avoiding change-in-update warnings
 * - Cross-controller communication (e.g., session switch -> clear messages)
 *   is handled by the root via callbacks
 *
 * Window-state events (rtc-window-{minimize,maximize,restore}) flow from
 * <rtc-title-bar> → <rtc-agent> listener → controller → reflected `data-mode`
 * attribute → CSS :host([data-mode=...]) visual state.
 */
import {LitElement, html, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {ContextProvider} from '@lit/context';
import {styles} from './rtc-agent.styles.js';
import type {WindowMode, ContentData, SessionStatus, Activity} from '../../types/index.js';

// Styles
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';

// Contexts (for provider keys)
import {WindowStateContext} from '../../contexts/window-state.js';
import {AuthContext} from '../../contexts/auth.js';
import {SessionContext} from '../../contexts/session.js';
import {SessionTreeContext} from '../../contexts/session-tree.js';
import {SessionTabContext} from '../../contexts/session-tab.js';
import {MessageContext} from '../../contexts/message.js';
import {ModeContext} from '../../contexts/mode.js';
import {ToolCallContext} from '../../contexts/tool-call.js';
import {TurnCountContext, DEFAULT_TURN_COUNT} from '../../contexts/turn-count.js';
import {SkillContext, DEFAULT_SKILL_STATE} from '../../contexts/skill.js';
import {ActivityContext} from '../../contexts/activity.js';
import {FileExplorerContext} from '../../contexts/file-explorer.js';
import {SettingsContext} from '../../contexts/settings.js';
import {NotificationContext} from '../../contexts/notification.js';

// Controllers
import {WindowStateController} from '../../controllers/window-state.controller.js';
import {AuthController} from '../../controllers/auth.controller.js';
import {SessionController} from '../../controllers/session.controller.js';
import {MessageController} from '../../controllers/message.controller.js';
import {ModeController} from '../../controllers/mode.controller.js';
import {ToolCallController} from '../../controllers/tool-call.controller.js';
import {WindowInteractionController} from '../../controllers/window-interaction.controller.js';
import {PersistenceController} from '../../controllers/persistence.controller.js';
import {SkillController} from '../../controllers/skill.controller.js';
import {ToastController} from '../../controllers/toast.controller.js';
import {ForkController} from '../../controllers/fork.controller.js';
import {ActivityController} from '../../controllers/activity.controller.js';
import {FileExplorerController} from '../../controllers/file-explorer.controller.js';
import {EditorAreaController} from '../../controllers/editor-area.controller.js';
import {StatusBarController} from '../../controllers/status-bar.controller.js';
import {SessionTreeController} from '../../controllers/session-tree.controller.js';
import {SessionTabController} from '../../controllers/session-tab.controller.js';
import {SettingsController} from '../../controllers/settings.controller.js';
import {NotificationController} from '../../controllers/notification.controller.js';

// Scenario loading
import {setServerUrl, setRedirectUri} from '../../config/auth.js';
import {loadScenariosContent} from '../../core/scenario-loader.js';
import {defineRegistry} from '../../core/function-registry.js';
import type {FunctionRegistry} from '../../core/function-registry.js';

// Ready signal
import {_markReady} from '../../core/ready.js';

// i18n
import {initLocale, getLocale, localeContext, type LocaleContextValue, sourceLocale, targetLocales, switchLocale} from '../../core/i18n.js';
import {msg} from '@lit/localize';

// Logo
import {renderBubbleLogo} from '../../icons/logo.js';

// Declarative config types
import type {AgentConfig} from '../../types/agent-config.js';
import type {WindowConfig} from '../../types/window-config.js';
import {resolveWindowConfig} from '../../types/window-config.js';
import type {ActivityBarConfig} from '../../types/activity-bar-config.js';
import {resolveActivityBarConfig, type ResolvedActivityBarConfig} from '../../types/activity-bar-config.js';
// Side-effect import: extends HTMLElementEventMap with rtc-agent-ready event
import '../../types/events.js';

// UIUpdateBus (persistence-layer singleton for driving UI refreshes)
import {getUIUpdateBus, RtcProcessor} from '@rtc-agent/persistence';
import type {LocalRtc} from '@rtc-agent/persistence';

// Tool confirm dialog
import '../overlay/rtc-tool-confirm.js';
import '../overlay/rtc-ask-user.js';
// Child component registrations (side-effect imports)
import '../title-bar/rtc-title-bar.js';
import '../login/rtc-login-page.js';
import '../login/rtc-login-dialog.js';
import '../overlay/rtc-toast.js';

// VS Code-style layout components (Phase 3)
import '../activity-bar/rtc-activity-bar.js';
import '../file-explorer/rtc-file-explorer.js';
import '../editor-area/rtc-editor-area.js';
import '../status-bar/rtc-status-bar.js';

// Chat Layout component (conversation page refactor)
import '../chat-layout/rtc-chat-layout.js';

// Settings Layout component
import '../settings-layout/rtc-settings-layout.js';

// Drawer component (overlay slide-out panel)
import '../drawer/rtc-drawer.js';

// Toast types (re-exported from ToastController)
import type {ToastType} from '../overlay/rtc-toast.js';

// Debug API (dev/test only)
import {installDebugAPI} from '../../debug-api.js';

// Extracted helpers (keep rtc-agent.ts lean — business logic lives in helpers/)
import {handleCommand as dispatchCommand} from './helpers/command-handler.js';
import {showToolConfirmDialog, showAskUserDialog} from './helpers/dialog-helpers.js';
import {
    loadFileTree as vfsLoadFileTree,
    loadFolderChildren as vfsLoadFolderChildren,
    handleFileOpen as vfsHandleFileOpen,
    restoreEditorAreaContent as vfsRestoreEditorAreaContent,
    handleEditorSave as vfsHandleEditorSave,
    handleFileChange as vfsHandleFileChange,
} from './helpers/vfs-operations.js';
import {loadSessions as sessionLoadSessions} from './helpers/session-loader.js';
import {connectWithRetry} from './helpers/connection-setup.js';

// Connection state type
import type {ConnectionState} from '@rtc-agent/client';
import {createLogger} from '@rtc-agent/client';

// Aria-live announcements per mode transition
const log = createLogger('rtc-agent');

const MODE_ANNOUNCEMENTS: Record<WindowMode, string> = {
    normal: 'Window restored',
    maximized: 'Window maximized',
    minimized: 'Window minimized',
};

@customElement('rtc-agent')
export class RtcAgent extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Public Properties ── */

    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    @property({type: String, attribute: 'app-label'})
    appLabel = 'RTC Agent';

    // SVG/HTML rendered inside the minimized bubble; falls back to first letter of appLabel.
    //
    // Safety contract: this property is set by the host application developer via the
    // `bubble-icon` HTML attribute or the JS property. It MUST NOT receive unsanitized
    // end-user input. If the value ever comes from user input, the caller is responsible
    // for sanitizing it (e.g. via DOMPurify) BEFORE assignment.
    @property({type: String, attribute: 'bubble-icon'})
    bubbleIcon = '';

    /**
     * FunctionRegistry instance (host-app injection, advanced usage).
     *
     * On set, automatically:
     * 1. Injects the registry into SkillController (for UI use).
     * 2. Creates an rtcAgentAPI Proxy and injects it into ToolRegistry (for script tools).
     *
     * For simpler scenarios, prefer the `agentConfig` property (declarative API).
     */
    @property({attribute: false})
    set registry(value: FunctionRegistry | null) {
        if (value) {
            log.info('registry setter called, isConnected:', this._persistence.isConnected);
            this._skill.actions.setRegistry(value);

            // If persistence is connected (DB ready), generate docs immediately.
            // This handles a timing issue: connectedCallback() may run before the registry is set.
            if (this._persistence.isConnected && this._persistence.layer) {
                void this._regenerateDocsAfterRegistrySet();
            }
        }
    }
    get registry(): FunctionRegistry | null {
        return this._skill.actions.getRegistry();
    }

    /**
     * Generate docs after the registry property is set.
     *
     * Handles a timing issue: connectedCallback() may complete connect() before
     * the registry is injected, causing generateAllDocsContent() to return an empty
     * array. When the registry is set later, docs need to be regenerated.
     */
    private async _regenerateDocsAfterRegistrySet(): Promise<void> {
        const registry = this._skill.actions.getRegistry();
        if (!registry) return;

        try {
            const files = registry.generateAllDocsContent(0);
            await this._persistence.workerBridge!.core.batchWriteFiles(files);

            // If scenariosURL was set but scenarios haven't loaded yet, load them now.
            if (this._scenariosURL) {
                await this._loadScenarios(this._scenariosURL);
            }
        } catch (err) {
            log.warn('Failed to regenerate docs after registry set:', err);
        }
    }

    /**
     * Declarative agent configuration (recommended host integration approach).
     *
     * After setting, the component automatically:
     * 1. Builds a FunctionRegistry from config (with persona / groups / functions).
     * 2. Injects the registry into SkillController.
     * 3. Bridges the rtcAgent API to ToolRegistry (for script tool use).
     *
     * Host applications don't need to understand internal concepts like
     * FunctionRegistry / toolRegistry.
     *
     * @example
     * ```ts
     * const agent = document.querySelector<RtcAgent>('#agent')!;
     * agent.agentConfig = {
     *   name: 'MermaidEditor',
     *   persona: 'You are a helpful Mermaid diagram assistant...',
     *   groups: [{
     *     name: 'editor',
     *     description: 'Editor operations',
     *     functions: [
     *       { name: 'getCode', description: 'Get current code', handler: () => editorAPI.getCode() },
     *     ],
     *   }],
     * };
     * ```
     */
    @property({attribute: false})
    set agentConfig(value: AgentConfig | null) {
        this._agentConfig = value;
        if (value) {
            this.registry = this._buildRegistryFromConfig(value);
        }
    }
    get agentConfig(): AgentConfig | null {
        return this._agentConfig;
    }
    private _agentConfig: AgentConfig | null = null;

    /**
     * Backend server URL (overrides VITE_SERVER_URL env and the built-in default).
     *
     * Propagated to AUTH_CONFIG so OAuth / WebSocket endpoints pick it up.
     *
     * @example
     * <rtc-agent server-url="http://localhost:28080"></rtc-agent>
     */
    @property({type: String, attribute: 'server-url'})
    set serverURL(value: string) {
        this._serverURL = value;
        setServerUrl(value);
    }
    get serverURL(): string {
        return this._serverURL;
    }
    private _serverURL = '';

    /**
     * OAuth callback URL (overrides the default window.location.origin + '/auth/callback.html').
     *
     * Propagated to AUTH_CONFIG so OAuth flow uses the correct redirect URI.
     *
     * @example
     * <rtc-agent redirect-uri="https://example.com/auth/callback.html"></rtc-agent>
     */
    @property({type: String, attribute: 'redirect-uri'})
    set redirectURI(value: string) {
        this._redirectURI = value;
        setRedirectUri(value);
    }
    get redirectURI(): string {
        return this._redirectURI;
    }
    private _redirectURI = '';

    /**
     * Scenario documents URL (optional).
     *
     * When set, automatically loads scenario documents from the specified URL into VirtualFS.
     * The URL should point to a directory containing manifest.json.
     *
     * @example
     * <rtc-agent scenarios-url="./scenarios/"></rtc-agent>
     */
    @property({type: String, attribute: 'scenarios-url'})
    set scenariosURL(value: string) {
        this._scenariosURL = value;
        if (value) {
            // If persistence is connected, load scenarios immediately.
            if (this._persistence.isConnected && this._persistence.layer) {
                void this._loadScenarios(value);
            }
            // Otherwise, scenariosURL is stored in _scenariosURL and loaded later
            // in connectedCallback or the registry setter.
        }
    }
    get scenariosURL(): string {
        return this._scenariosURL;
    }
    private _scenariosURL = '';

    /**
     * Window configuration (optional).
     *
     * Controls the window's default state, dimensions, position, interaction limits, etc.
     *
     * @example
     * ```ts
     * agent.windowConfig = {
     *   defaultMode: 'maximized',
     *   embedded: true,  // Disable all window interactions
     *   showMinimize: false,
     *   showMaximize: false,
     * };
     * ```
     */
    @property({attribute: false})
    set windowConfig(value: WindowConfig | null) {
        this._windowConfig = value;
        const resolved = resolveWindowConfig(value ?? undefined);
        this._resolvedWindowConfig = resolved;

        // Update controller configuration.
        this._windowState.setConfig(resolved);
        this._interaction.setConfig({
            draggable: resolved.draggable,
            resizable: resolved.resizable,
        });

        // Trigger re-render.
        this.requestUpdate();
    }
    get windowConfig(): WindowConfig | null {
        return this._windowConfig;
    }
    private _windowConfig: WindowConfig | null = null;

    /**
     * Activity Bar configuration (optional).
     *
     * Controls visibility of activity buttons in the Activity Bar.
     * Note: the chat button is always visible and cannot be hidden.
     *
     * @example
     * ```ts
     * agent.activityBarConfig = {
     *   disabledActivities: ['files', 'settings'],  // Only show chat
     *   defaultActivity: 'chat',
     * };
     * ```
     */
    @property({attribute: false})
    set activityBarConfig(value: ActivityBarConfig | null) {
        this._activityBarConfig = value;
        this._resolvedActivityBarConfig = resolveActivityBarConfig(value ?? undefined);

        // If the current activity is disabled, switch to the default activity.
        const disabled = this._resolvedActivityBarConfig.disabledActivities;
        if (disabled.includes(this._activity.active as 'files' | 'settings')) {
            this._activity.actions.setActivity(this._resolvedActivityBarConfig.defaultActivity);
        }

        // Trigger re-render.
        this.requestUpdate();
    }
    get activityBarConfig(): ActivityBarConfig | null {
        return this._activityBarConfig;
    }
    private _activityBarConfig: ActivityBarConfig | null = null;
    private _resolvedActivityBarConfig: ResolvedActivityBarConfig = resolveActivityBarConfig();

    /**
     * Load scenarios into VirtualFS.
     *
     * Writes to the Worker's VirtualFS via WorkerBridge.
     */
    private async _loadScenarios(baseURL: string): Promise<void> {
        const files = await loadScenariosContent(baseURL);
        await this._persistence.workerBridge!.core.batchWriteFiles(files);
        log.info(`Loaded ${files.length} scenarios from ${baseURL}`);
    }

    /**
     * Build a FunctionRegistry from AgentConfig (internal use).
     *
     * Flow:
     * 1. Create FunctionRegistry using config.name / description / persona.
     * 2. Create groups from config.groups and register functions in each.
     * 3. If config.functions (flat) exists, auto-place them in a 'default' group.
     */
    private _buildRegistryFromConfig(config: AgentConfig): FunctionRegistry {
        const registry = defineRegistry({
            name: config.name ?? this.appLabel,
            description: config.description ?? '',
            persona: config.persona ?? '',
            onError: config.onError,
        });

        // Process groups.
        for (const groupConfig of config.groups ?? []) {
            const group = registry.createGroup({
                name: groupConfig.name,
                description: groupConfig.description ?? '',
            });
            for (const fn of groupConfig.functions) {
                group.register(fn);
            }
        }

        // Process flat functions (place in default group).
        if (config.functions && config.functions.length > 0) {
            const defaultGroup = registry.createGroup({
                name: 'default',
                description: 'Default functions',
            });
            for (const fn of config.functions) {
                defaultGroup.register(fn);
            }
        }

        return registry;
    }

    /* ── Reactive Controllers ── */

    /** Resolved window configuration. */
    private _resolvedWindowConfig = resolveWindowConfig();

    private _windowState = new WindowStateController(this, this._resolvedWindowConfig);
    private _auth = new AuthController(this);
    private _persistence = new PersistenceController(this, this._auth);
    private _session = new SessionController(this);
    private _message = new MessageController(this);
    private _mode = new ModeController(this);
    private _toolCall = new ToolCallController(this);
    private _interaction = new WindowInteractionController(this, {
        draggable: this._resolvedWindowConfig.draggable,
        resizable: this._resolvedWindowConfig.resizable,
    });
    private _skill = new SkillController(this, {
        onToast: (message, type) => this._toast.actions.show(message, type as ToastType),
        onConfirmRequest: (requestId, _path, message) => {
            // Use window.confirm as a simple UI (SkillController also has a fallback after 5s).
            const confirmed = window.confirm(message);
            this._skill.respondToConfirm(requestId, confirmed);
        },
    });
    private _toast = new ToastController(this);
    private _fork = new ForkController(this);
    private _activity = new ActivityController(this);
    private _fileExplorer = new FileExplorerController(this);
    private _editorArea = new EditorAreaController(this);
    private _statusBar = new StatusBarController(this, this._editorArea);
    private _sessionTree = new SessionTreeController(this);
    private _sessionTab = new SessionTabController(this);
    private _settings = new SettingsController(this);
    private _notification = new NotificationController(this);

    /** Whether the file tree has been loaded (loaded once on first entry to files activity). */
    private _fileTreeLoaded = false;

    /* ── Internal State ── */

    /** Mode announcement text for screen readers (updated on mode transition). */
    @state() private _modeAnnouncement = '';

    /** Show login dialog */
    @state() private _showLoginDialog = false;

    /** Selected OAuth2 provider for login dialog */
    @state() private _selectedProvider = 'mock';

    /** Connection state. */
    @state() private _connectionState: ConnectionState = 'disconnected';

    /** Connection state unsubscribe function. */
    private _unsubConnection?: () => void;

    /** Whether connection failed (used to show retry button). */
    @state() private _connectionFailed = false;

    /** Error message when connection failed. */
    @state() private _connectionError = '';

    /**
     * In-flight connection promise — prevents concurrent _connectWithRetry calls
     * from racing (e.g. connectedCallback + onLogin firing in quick succession).
     *
     * Without this guard, concurrent calls would create duplicate RTC processors,
     * duplicate connection listeners, and race on session list loading.
     */
    private _connecting?: Promise<void>;

    /**
     * Connection generation counter for race-condition prevention.
     *
     * When logout (or disconnect) clears `_connecting` while the underlying Promise
     * is still in-flight, a subsequent login can set a new `_connecting`. When the
     * OLD Promise finally resolves, its `finally` block would wrongly clear the NEW
     * `_connecting`, leaving the new connection attempt invisible to the concurrency
     * guard — leading to duplicate connection attempts and inconsistent state.
     *
     * Fix: each connection attempt captures the current generation; in `finally`,
     * we only clear `_connecting` if the generation still matches. Any code path
     * that invalidates an in-flight connection (logout, disconnect) bumps the
     * generation instead of clearing `_connecting`, so stale Promises self-inhibit.
     */
    private _connectGeneration = 0;

    /** Tracks the last mode we applied DOM side-effects for, to avoid redundant work. */
    private _appliedMode: WindowMode = 'normal';

    /**
     * Guard flag to prevent infinite loop when auto-creating unsaved tab
     *
     * Set to true before creating tab, false after. Prevents updated() from
     * recursively triggering itself when the newly created tab triggers another update.
     */
    private _creatingUnsavedTab = false;

    /** Tracks whether we've done the initial session load (for auto-select logic). */
    private _initialSessionLoadDone = false;

    /** Tracks whether locale has been initialized (only once). */
    private _localeInitialized = false;

    /** Auto-save debounce timers per file */
    private _autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /** Bound event handlers (stored so we can remove them in disconnectedCallback). */
    private _boundOnMinimize = () => this._windowState.actions.minimize();
    private _boundOnMaximize = () => this._windowState.actions.maximize();
    private _boundOnRestore = () => this._windowState.actions.restore();
    private _boundOnLoginRequested = (event: Event) => this._handleLoginRequested(event);
    private _boundOnNewSession = () => {
        this._fork.actions.clearFork();
        // Don't clear messages: _handleNewSession already created a new session via createSession()
        // and switched currentSessionId; the message list has been emptied by reload()
        // (new session has no messages). Only in the legacy scenario (sending after closing
        // the last tab) would we need to clear, but currentSessionId would be null then.
        if (!this._session.value.state.currentSessionId) {
            this._message.actions.clearMessages();
        }
    };
    private _boundOnLogout = () => {
        // Clear auto-save timers.
        for (const timer of this._autoSaveTimers.values()) {
            clearTimeout(timer);
        }
        this._autoSaveTimers.clear();

        // Reset state flags to ensure reload after re-login.
        this._fileTreeLoaded = false;
        this._initialSessionLoadDone = false;

        // Reset UI state.
        this._editorArea.actions.closeAll();
        this._sessionTab.actions.clearAll();
        this._activity.actions.setActivity('chat');

        // Clean up existing state.
        this._fork.actions.clearFork();
        this._rtcProcessor = undefined;
        // Invalidate any in-flight connection attempt: bumping the generation counter
        // causes the stale Promise's `finally` block to skip clearing `_connecting`,
        // so a subsequent login can safely start a fresh attempt without the old
        // Promise wiping out the new `_connecting` reference on resolution.
        this._connectGeneration++;
        this._connecting = undefined;
        void this._persistence.disconnect();
        this._session.actions.reset();
        this._message.actions.clearMessages();
    };
    private _boundOnInputSubmit = async (e: Event) => {
        const detail = (e as CustomEvent).detail;
        // Use contentData directly from rtc-input-area.
        const content: ContentData = detail.contentData;

        try {
            if (this._fork.isActive) {
                // Fork mode: call forkSession.
                await this._fork.actions.submitFork(content);
            } else {
                // Normal mode: call sendMessage.
                await this._message.actions.sendMessage(content);
            }

            // After successful send, promote the current unsaved tab to saved.
            const currentId = this._session.value.state.currentSessionId;
            if (currentId) {
                this._sessionTab.actions.markSaved(currentId);
            }
        } catch (err) {
            log.error('message submit failed:', err);
        }
    };
    private _boundOnForkInitiated = (e: Event) => {
        const {oldSessionClientId, oldMessageClientId, newSessionClientId, content} =
            (e as CustomEvent).detail;
        this._fork.actions.requestFork(
            oldSessionClientId, oldMessageClientId, newSessionClientId, content
        );
    };
    private _boundOnKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this._fork.isActive) {
            this._fork.actions.clearFork();
            // 派发事件由 chat-layout 监听并清空输入框（事件驱动，避免跨 shadow DOM 查询）
            this.dispatchEvent(new CustomEvent('rtc-clear-active-input'));
            return;
        }

        // Global shortcuts (only active in files mode).
        if (this._activity.active !== 'files') return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;

        if (e.key === 's' || e.key === 'S') {
            // Ctrl/Cmd+S: save current file.
            const activePath = this._editorArea.state.activeFilePath;
            if (activePath) {
                e.preventDefault();
                void this._handleEditorSave(activePath);
            }
        } else if (e.key === 'w' || e.key === 'W') {
            // Ctrl/Cmd+W: close current tab.
            const activePath = this._editorArea.state.activeFilePath;
            if (activePath) {
                e.preventDefault();
                this._editorArea.actions.closeFile(activePath);
            }
        }
    };
    private _boundOnStopRequested = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (this._persistence.layer) {
            void this._persistence.layer.stopTurn(detail.sessionClientId);
        }
    };
    private _boundOnResendMessage = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        const message = detail.message;
        if (message?.clientId && message?.content) {
            void this._message.actions.resendMessage(message.clientId, message.content);
        }
    };
    private _boundOnSessionDeleteRequested = async (e: Event) => {
        const {sessionId} = (e as CustomEvent).detail;
        log.debug('session delete requested:', sessionId);
        // Confirmation dialog.
        // const current = this._session.value.state.sessions.find(s => s.clientId === sessionId);
        // const title = current?.title ?? 'This session';
        // const confirmed = confirm(`Delete "${title}"? It can be recovered from the server.`);
        // if (!confirmed) return;

        const result = await this._session.actions.deleteSession(sessionId);
        if (result.ok) {
            this._toast.actions.show(msg('会话已删除'), 'success');
        } else {
            this._toast.actions.show(result.error ?? msg('删除失败'), 'error');
        }
    };
    private _boundOnSessionRenameRequested = async (e: Event) => {
        const {sessionId} = (e as CustomEvent).detail;
        // Simple prompt interaction: in production, replace with inline editing or a modal.
        const current = this._session.value.state.sessions.find(s => s.clientId === sessionId);
        const title = prompt('重命名会话', current?.title ?? '');
        if (title === null) return; // User cancelled.
        if (!title.trim()) {
            this._toast.actions.show(msg('标题不能为空'), 'info');
            return;
        }
        const result = await this._session.actions.renameSession(sessionId, title.trim());
        if (!result.ok) {
            this._toast.actions.show(result.error ?? msg('重命名失败'), 'error');
        }
    };
    private _boundOnSessionRenameConfirmed = async (e: Event) => {
        const {sessionId, title} = (e as CustomEvent).detail;
        // Inline edit confirmed — call renameSession directly.
        if (!title.trim()) return;
        const result = await this._session.actions.renameSession(sessionId, title.trim());
        if (!result.ok) {
            this._toast.actions.show(result.error ?? msg('重命名失败'), 'error');
        }
    };
    private _boundOnToastRequested = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        this._toast.actions.show(detail.message, detail.type);
    };
    private _boundOnToastClose = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        this._toast.actions.remove(detail.id);
    };
    private _boundOnCommandRequested = (e: Event) => {
        const detail = (e as CustomEvent).detail as { name: string; args?: string };
        void this._handleCommand(detail.name, detail.args);
    };
    private _boundOnActivityChange = (e: Event) => {
        const {activity, toggleSidebar} = (e as CustomEvent).detail as {
            activity: Activity;
            toggleSidebar: boolean;
        };
        if (toggleSidebar) {
            // Clicked current activity -> toggle sidebar.
            this._activity.actions.toggleSidebar();
        } else {
            // Switch to a different activity.
            this._activity.actions.setActivity(activity);
            // Load file tree on first entry to files activity.
            if (activity === 'files' && !this._fileTreeLoaded && this._persistence.isConnected) {
                void this._loadFileTree();
            }
        }
    };
    private _boundOnFileSelect = (e: Event) => {
        const {path} = (e as CustomEvent).detail as {path: string};
        void this._handleFileOpen(path);
    };
    private _boundOnFolderToggle = (e: Event) => {
        const {path} = (e as CustomEvent).detail as {path: string};
        // If expanded and children not yet loaded, trigger lazy load.
        // Note: toggleNode is already called in file-tree-item; not called here to avoid duplication.
        if (this._fileExplorer.value.isExpanded(path)) {
            log.debug('_boundOnFolderToggle: loading children for', path);
            void this._loadFolderChildren(path);
        }
    };
    private _boundOnEditorAreaSave = (e: Event) => {
        const {filePath} = (e as CustomEvent).detail as {filePath: string};
        void this._handleEditorSave(filePath);
    };
    private _boundOnEditorAreaTabClose = (e: Event) => {
        const {filePath} = (e as CustomEvent).detail as {filePath: string};
        // Clear auto-save timer if exists
        const timer = this._autoSaveTimers.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this._autoSaveTimers.delete(filePath);
        }
        this._editorArea.actions.closeFile(filePath);
    };
    private _boundOnEditorAreaTabSelect = (e: Event) => {
        const {filePath} = (e as CustomEvent).detail as {filePath: string};
        this._editorArea.actions.switchTab(filePath);
    };
    private _boundOnEditorAreaContentChange = (e: Event) => {
        const {filePath, content} = (e as CustomEvent).detail as {filePath: string; content: string};
        this._editorArea.actions.updateContent(filePath, content);

        // Auto-save if enabled
        if (this._settings.value.state.files.autoSave) {
            this._scheduleAutoSave(filePath);
        }
    };
    private _boundOnEditorAreaViewModeChange = (e: Event) => {
        const {filePath, viewMode} = (e as CustomEvent).detail as {filePath: string; viewMode: 'edit' | 'preview' | 'split'};
        this._editorArea.actions.setViewMode(filePath, viewMode);
    };
    private _boundOnEditorAreaCursorMove = (e: Event) => {
        const position = (e as CustomEvent).detail as {line: number; column: number};
        const filePath = this._editorArea.activeFilePath;
        if (filePath) {
            this._editorArea.actions.setCursorPosition(filePath, position);
        }
    };
    private _boundOnFileExplorerRefresh = () => {
        void this._loadFileTree();
    };
    private _boundOnChatLayoutSessionSelect = (e: Event) => {
        // ChatLayout internally already calls switchSession; this is just a log/extension point.
        const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
        log.debug('chat-layout session selected:', sessionId);
    };
    private _boundOnChatLayoutTabActivate = (e: Event) => {
        const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
        log.debug('chat-layout tab activated:', sessionId);
    };
    private _boundOnChatLayoutTabClose = (e: Event) => {
        const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
        log.debug('chat-layout tab closed:', sessionId);
    };
    private _boundOnDrawerClose = () => {
        this._activity.actions.hideSidebar();
    };

    /**
     * Wheel event handler to prevent scroll chaining to host page.
     *
     * When a scrollable container inside the shadow DOM reaches its boundary
     * (top/bottom for vertical, left/right for horizontal), continuing to scroll
     * would propagate the wheel event to the host page, causing it to scroll.
     * This handler:
     * 1. If a scrollable parent exists and is at its boundary, prevents propagation
     * 2. If no scrollable parent exists, always prevents propagation (wheel events
     *    inside the component should never affect the host page)
     *
     * Supports both vertical and horizontal scroll containers.
     */
    private _boundOnWheel = (e: WheelEvent) => {
        const target = e.composedPath()[0] as Element;
        const scrollable = this._findScrollableParent(target);

        // No scrollable container found — prevent all wheel events from reaching host page
        if (!scrollable) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const {scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth} = scrollable;

        // ── Vertical axis ──
        const atTop = scrollTop <= 0;
        const atBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight;
        const scrollingUp = e.deltaY < 0;
        const scrollingDown = e.deltaY > 0;
        const isVertScrollable = scrollHeight > clientHeight;

        // ── Horizontal axis ──
        const atLeft = scrollLeft <= 0;
        const atRight = Math.ceil(scrollLeft + clientWidth) >= scrollWidth;
        const scrollingLeft = e.deltaX < 0 || (e.shiftKey && e.deltaY < 0);
        const scrollingRight = e.deltaX > 0 || (e.shiftKey && e.deltaY > 0);
        const isHorizScrollable = scrollWidth > clientWidth;

        // If at boundary and continuing to scroll in that direction, prevent propagation
        const atVerticalBoundary = isVertScrollable && ((atTop && scrollingUp) || (atBottom && scrollingDown));
        const atHorizontalBoundary = isHorizScrollable && ((atLeft && scrollingLeft) || (atRight && scrollingRight));

        if (atVerticalBoundary || atHorizontalBoundary) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    /** UIUpdateBus unsubscribe reference (set in connectedCallback, cleared in disconnectedCallback). */
    private _busUnsubMessage?: () => void;

    /** RTC processor (instantiated after persistence connect). */
    private _rtcProcessor?: RtcProcessor;

    /* ── Public Controller Accessors ──
     *
     * Expose controllers as readonly for demo page and external consumers.
     * Note: AuthController exposes `login`/`logout` at top level (design exception,
     * see `contexts/auth.ts`); other controllers expose `actions.*`.
     */

    get windowStateController() { return this._windowState; }
    get authController() { return this._auth; }
    get persistenceController() { return this._persistence; }
    get sessionController() { return this._session; }
    get messageController() { return this._message; }
    get modeController() { return this._mode; }
    get toolCallController() { return this._toolCall; }
    get skillController() { return this._skill; }
    get toastController() { return this._toast; }
    get forkController() { return this._fork; }
    get activityController() { return this._activity; }
    get fileExplorerController() { return this._fileExplorer; }
    get editorAreaController() { return this._editorArea; }
    get statusBarController() { return this._statusBar; }
    get sessionTreeController() { return this._sessionTree; }
    get sessionTabController() { return this._sessionTab; }
    get settingsController() { return this._settings; }
    get notificationController() { return this._notification; }

    /* ── Public Methods ── */

    /**
     * Manually reconnect when connection fails.
     *
     * Call this when SharedWorker initialization fails or WebSocket connection
     * cannot be established.
     */
    async reconnect(): Promise<void> {
        if (this._persistence.isConnected) {
            log.warn('Already connected');
            return;
        }
        await this._connectWithRetry();
    }

    /**
     * Whether connection has failed.
     *
     * Used by UI components to show retry button or error message.
     */
    get connectionFailed(): boolean {
        return this._connectionFailed;
    }

    /**
     * Error message when connection failed.
     */
    get connectionError(): string {
        return this._connectionError;
    }

    /* ── Context Providers ── */

    private _sessionProvider = new ContextProvider(this, {context: SessionContext, initialValue: this._session.value});
    private _messageProvider = new ContextProvider(this, {context: MessageContext, initialValue: this._message.value});
    private _toolCallProvider = new ContextProvider(this, {context: ToolCallContext, initialValue: this._toolCall.value});
    private _authProvider = new ContextProvider(this, {context: AuthContext, initialValue: this._auth.value});
    private _modeProvider = new ContextProvider(this, {context: ModeContext, initialValue: this._mode.value});
    private _windowStateProvider = new ContextProvider(this, {context: WindowStateContext, initialValue: this._windowState.value});
    private _turnCountProvider = new ContextProvider(this, {context: TurnCountContext, initialValue: DEFAULT_TURN_COUNT});
    private _skillProvider = new ContextProvider(this, {context: SkillContext, initialValue: DEFAULT_SKILL_STATE});
    private _activityProvider = new ContextProvider(this, {context: ActivityContext, initialValue: this._activity.value});
    private _fileExplorerProvider = new ContextProvider(this, {context: FileExplorerContext, initialValue: this._fileExplorer.value});
    private _sessionTreeProvider = new ContextProvider(this, {context: SessionTreeContext, initialValue: this._sessionTree.value});
    private _sessionTabProvider = new ContextProvider(this, {context: SessionTabContext, initialValue: this._sessionTab.value});
    private _settingsProvider = new ContextProvider(this, {context: SettingsContext, initialValue: this._settings.value});
    private _notificationProvider = new ContextProvider(this, {context: NotificationContext, initialValue: this._notification.value});
    private _localeProvider = new ContextProvider(this, {context: localeContext, initialValue: {
        locale: sourceLocale,
        setLocale: switchLocale,
        locales: [sourceLocale, ...targetLocales],
    } as LocaleContextValue});

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();

        // Initialize i18n locale (once)
        if (!this._localeInitialized) {
            this._localeInitialized = true;
            void initLocale();
        }

        // Wire ForkController dependencies
        this._fork.setDeps({
            clearMessages: () => this._message.actions.clearMessages(),
            clearTransientParams: (sessionId) => this._sessionTab.actions.clearTransientParams(sessionId),
            executeFork: (params) => this._message.actions.forkSession(params),
        });

        // Cross-controller wiring: session switch -> reload messages for the new session
        this._session.onSessionSwitch = () => {
            log.debug('onSessionSwitch currentSessionId:', this._session.value.state.currentSessionId);
            this._fork.actions.clearFork();  // Clear fork state when switching sessions.
            // 注：tab transient params 的清除由 chat-layout._handleTabActivate 负责
            if (this._session.value.state.currentSessionId) {
                log.debug('onSessionSwitch calling message.reload()');
                void this._message.reload();
            } else {
                // currentSessionId is null (e.g. after closing the last Tab) -> clear messages.
                log.debug('onSessionSwitch clearing messages (no current session)');
                this._message.actions.clearMessages();
            }
            // Immediately sync turn count to new session's value on session switch.
            void this._refreshTurnCounts();
        };

        // Inject persistence layer and session controller into MessageController
        if (this._persistence.layer) {
            this._message.persistence = this._persistence.layer;
            // Inject persistence into SessionController (for rename/delete persistence).
            this._session.persistence = this._persistence.layer;
        }
        this._message.sessionController = this._session;

        // Inject dependencies into NotificationController
        this._notification.sessionController = this._session;
        this._notification.messageController = this._message;
        this._notification.toastController = this._toast;
        this._notification.windowStateController = this._windowState;
        this._notification.settingsController = this._settings;
        if (this._persistence.layer) {
            this._notification.persistence = this._persistence.layer;
        }

        // Listen for window-control events from <rtc-title-bar> (composed + bubbling).
        this.addEventListener('rtc-window-minimize', this._boundOnMinimize);
        this.addEventListener('rtc-window-maximize', this._boundOnMaximize);
        this.addEventListener('rtc-window-restore', this._boundOnRestore);

        // Listen for login requested (from login page button click)
        this.addEventListener('rtc-login-requested', this._boundOnLoginRequested);

        // Listen for new session requested (reset to initial state)
        this.addEventListener('rtc-new-session', this._boundOnNewSession);

        // Listen for logout (from AuthController when refresh fails or user logs out)
        this.addEventListener('rtc-auth-logout', this._boundOnLogout);

        // Listen for input submit (from input area send action)
        this.addEventListener('rtc-input-submit', this._boundOnInputSubmit);

        // Listen for stop requested (from input area stop button)
        this.addEventListener('rtc-stop-requested', this._boundOnStopRequested);

        // Listen for resend message (from user message resend button)
        this.addEventListener('rtc-user-message-resend', this._boundOnResendMessage);

        // Listen for session delete / rename requests (from sidebar or session panel)
        this.addEventListener('rtc-session-delete-requested', this._boundOnSessionDeleteRequested);
        this.addEventListener('rtc-session-rename-requested', this._boundOnSessionRenameRequested);
        // Listen for inline rename confirmation (from session tree item)
        this.addEventListener('rtc-session-rename-confirmed', this._boundOnSessionRenameConfirmed);

        // Listen for fork initiated (from chat-layout after unsaved tab orchestration)
        this.addEventListener('rtc-fork-initiated', this._boundOnForkInitiated);

        // Listen for toast requested (from various components)
        this.addEventListener('rtc-toast-requested', this._boundOnToastRequested);

        // Listen for toast close (from toast component)
        this.addEventListener('rtc-toast-close', this._boundOnToastClose);

        // Listen for command requested (from input area slash commands)
        this.addEventListener('rtc-command-requested', this._boundOnCommandRequested);

        // Listen for VS Code-style layout events (Phase 3).
        this.addEventListener('activity-change', this._boundOnActivityChange);
        this.addEventListener('file-select', this._boundOnFileSelect);
        this.addEventListener('folder-toggle', this._boundOnFolderToggle);
        this.addEventListener('editor-area-save', this._boundOnEditorAreaSave);
        this.addEventListener('editor-area-tab-close', this._boundOnEditorAreaTabClose);
        this.addEventListener('editor-area-tab-select', this._boundOnEditorAreaTabSelect);
        this.addEventListener('editor-area-content-change', this._boundOnEditorAreaContentChange);
        this.addEventListener('editor-area-view-mode-change', this._boundOnEditorAreaViewModeChange);
        this.addEventListener('editor-area-cursor-move', this._boundOnEditorAreaCursorMove);
        this.addEventListener('refresh-requested', this._boundOnFileExplorerRefresh);

        // Chat Layout events.
        this.addEventListener('rtc-chat-layout-session-select', this._boundOnChatLayoutSessionSelect);
        this.addEventListener('rtc-chat-layout-tab-activate', this._boundOnChatLayoutTabActivate);
        this.addEventListener('rtc-chat-layout-tab-close', this._boundOnChatLayoutTabClose);

        // Drawer close event (from any rtc-drawer in child components).
        this.addEventListener('rtc-drawer-close', this._boundOnDrawerClose);

        // Listen for Escape key to cancel fork mode
        this.addEventListener('keydown', this._boundOnKeydown);

        // Prevent scroll chaining: when inner scrollable reaches boundary,
        // don't propagate wheel event to host page
        this.addEventListener('wheel', this._boundOnWheel, {passive: false});

        // Subscribe to UIUpdateBus for persistence-driven UI refreshes
        const bus = getUIUpdateBus();
        this._busUnsubMessage = bus.subscribe((event) => {
            if (event.entity === 'message') {
                // Use efficient single-message update instead of full reload.
                // Return the Promise so UIUpdateBus can queue events for the same
                // messageId, preventing race conditions where stale DB reads
                // overwrite newer state (e.g., streaming content or sync_status).
                return this._message.updateMessageFromBus(event.entityId);
            } else if (event.entity === 'session') {
                // Session updates: distinguish structural changes from lightweight field changes.
                // Structural changes (title, status, deleted_at) require full session list reload.
                // Lightweight changes (turn counts, token stats) are handled by dedicated handlers below.
                const SESSION_STRUCTURAL_FIELDS = new Set([
                    'title', 'status', 'deleted_at', 'root_client_session_id',
                    'created_at', 'updated_at',
                ]);
                if (event.action === 'created' || !event.field || SESSION_STRUCTURAL_FIELDS.has(event.field)) {
                    void this._loadSessions();
                }
                // Status change -> sync to SessionTab (active/idle/closed drives dot animation).
                if (event.field === 'status') {
                    const oldStatus = event.oldValue as SessionStatus | undefined;
                    const newStatus = event.newValue as SessionStatus | undefined;
                    const sessionId = event.entityId;

                    if (newStatus) {
                        // Scenario 1: session closed (open -> closed) -> close tab.
                        // Tab count monitoring and unsaved tab auto-creation are handled by updated() lifecycle.
                        if (newStatus === 'closed') {
                            log.debug('Session closed, closing tab:', sessionId);
                            this._sessionTab.actions.closeTab(sessionId);
                        }
                        // Scenario 2: session reopened (closed -> idle) -> create tab but don't activate.
                        else if (oldStatus === 'closed' && (newStatus === 'idle' || newStatus === 'active')) {
                            log.debug('Session reopened, creating tab:', sessionId);
                            // Get title from session list.
                            const session = this._session.value.state.sessions.find(s => s.clientId === sessionId);
                            const title = session?.title || 'Untitled';
                            this._sessionTab.actions.openOrActivate(sessionId, title, {activate: false});
                            // Note: don't call switchSession, keep current activeSessionId unchanged.
                        }
                        // Other status changes -> only update status dot.
                        else {
                            this._sessionTab.actions.updateTabStatus(sessionId, newStatus);
                        }
                    }
                }
                // Turn count field changed -> push active turn count for current session into context.
                if (
                    event.field === 'pending_turn_count' ||
                    event.field === 'running_turn_count'
                ) {
                    void this._refreshTurnCounts();
                }
            } else if (event.entity === 'rtc') {
                // RTC update: only Master Tab triggers RtcProcessor processing loop.
                // Skip when masterLock exists and isMaster=false.
                if (this._persistence.masterLock?.isMaster === false) {
                    return;
                }
                this._rtcProcessor?.onRtcUpdate();
            } else if (event.entity === 'file') {
                // VFS file change (from write/delete in other tabs).
                void this._handleFileChange(event.entityId, event.field);
            }
        });

        // Window interaction callbacks — delegate to WindowStateController
        this._interaction.onPositionChange = (x, y) => {
            this._windowState.actions.setPosition({x, y});
        };
        this._interaction.onSizeChange = (width, height) => {
            this._windowState.actions.setSize({width, height});
        };

        // WindowStateController viewport resize callback
        this._windowState.onViewportTooSmall = () => {
            this._windowState.actions.minimize();
        };

        // Reflect initial mode attribute.
        this.setAttribute('data-mode', this._windowState.value.state.mode);

        // Set auth login callback to trigger WebSocket connection.
        // This fixes the race condition where tokens are expired on page load:
        // _loadTokens() starts async refresh, but connectedCallback() runs before
        // refresh completes, so isLoggedIn is still false. When refresh succeeds,
        // onLogin fires and triggers connection.
        this._auth.onLogin = () => {
            void this._connectWithRetry();
        };

        // If tokens were restored from localStorage (e.g. page refresh),
        // connect persistence layer immediately.
        // Note: If tokens were expired and refresh is in-flight, this check will be false,
        // but onLogin callback will trigger connection when refresh completes.
        if (this._auth.state.isLoggedIn) {
            void this._connectWithRetry();
        }

        // Install debug API in dev/test builds (exposes window.rtcAgentDebug for E2E tests).
        if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
            installDebugAPI();
        }
    }

    /**
     * Connect to the persistence layer with error handling and retry.
     *
     * If the connection fails, sets _connectionFailed state so the user
     * can see the error in the UI and manually retry.
     *
     * Delegates to connection-setup helper for the heavy orchestration.
     *
     * Concurrency guard: if a connection is already in-flight, returns the
     * existing promise instead of starting a new one. This prevents duplicate
     * initialization when connectedCallback and onLogin fire in quick succession.
     */
    private _connectWithRetry(): Promise<void> {
        if (this._connecting) {
            log.debug('_connectWithRetry already in-flight, reusing existing promise');
            return this._connecting;
        }

        this._connecting = this._doConnectWithRetry();
        return this._connecting;
    }

    private async _doConnectWithRetry(): Promise<void> {
        // Capture the current generation so we can detect stale resolution:
        // if logout bumps _connectGeneration while this Promise is still in-flight,
        // the finally block must NOT clear _connecting (it belongs to a newer attempt).
        const gen = this._connectGeneration;
        try {
            this._connectionFailed = false;
            this._connectionError = '';

            const result = await connectWithRetry({
                persistence: this._persistence as unknown as Parameters<typeof connectWithRetry>[0]['persistence'],
                message: this._message as unknown as Parameters<typeof connectWithRetry>[0]['message'],
                session: this._session as unknown as Parameters<typeof connectWithRetry>[0]['session'],
                notification: this._notification as unknown as Parameters<typeof connectWithRetry>[0]['notification'],
                activity: this._activity,
                fileExplorer: this._fileExplorer as unknown as Parameters<typeof connectWithRetry>[0]['fileExplorer'],
                toast: this._toast.actions,
                skill: this._skill as unknown as Parameters<typeof connectWithRetry>[0]['skill'],
                mode: this._mode,
                scenariosURL: this._scenariosURL,
                loadFileTree: () => this._loadFileTree(),
                restoreEditorAreaContent: () => this._restoreEditorAreaContent(),
                showToolConfirm: (rtc) => this._showToolConfirm(rtc),
                showAskUser: (rtc) => this._showAskUser(rtc),
                loadSessions: () => { void this._loadSessions(); },
                onConnectionStateChange: (state) => { this._connectionState = state; },
                logger: log,
            });

            this._connectionFailed = result.connectionFailed;
            this._connectionError = result.connectionError;
            if (result.rtcProcessor) {
                this._rtcProcessor = result.rtcProcessor;
            }
            if (result.unsubConnection) {
                this._unsubConnection?.();
                this._unsubConnection = result.unsubConnection;
            }
            this._connectionState = result.connectionState;
        } finally {
            // Only clear _connecting if no newer attempt has superseded us.
            // If _connectGeneration was bumped (e.g. by logout), this Promise is
            // stale — leave the current _connecting alone so the new attempt stays
            // visible to the concurrency guard in _connectWithRetry.
            if (this._connectGeneration === gen) {
                this._connecting = undefined;
            } else {
                log.debug('Stale connection attempt resolved, skipping _connecting cleanup');
            }
        }
    }

    /** Show tool confirmation dialog (delegated to dialog-helpers). */
    private _showToolConfirm(rtc: LocalRtc): Promise<boolean> {
        return showToolConfirmDialog(rtc, this.shadowRoot!);
    }

    /**
     * Show AskUser multi-select dialog (delegated to dialog-helpers).
     *
     * Returns the user's answer dict ({answers, annotations?, metadata?}) or null if dismissed.
     */
    private _showAskUser(rtc: LocalRtc): Promise<{
        answers: Record<string, string>;
        annotations?: Record<string, { preview?: string; notes?: string }>;
        metadata?: { source?: string };
    } | null> {
        return showAskUserDialog(rtc, this.shadowRoot!) as Promise<{
            answers: Record<string, string>;
            annotations?: Record<string, { preview?: string; notes?: string }>;
            metadata?: { source?: string };
        } | null>;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('rtc-window-minimize', this._boundOnMinimize);
        this.removeEventListener('rtc-window-maximize', this._boundOnMaximize);
        this.removeEventListener('rtc-window-restore', this._boundOnRestore);
        this.removeEventListener('rtc-login-requested', this._boundOnLoginRequested);
        this.removeEventListener('rtc-new-session', this._boundOnNewSession);
        this.removeEventListener('rtc-auth-logout', this._boundOnLogout);
        this.removeEventListener('rtc-input-submit', this._boundOnInputSubmit);
        this.removeEventListener('rtc-stop-requested', this._boundOnStopRequested);
        this.removeEventListener('rtc-user-message-resend', this._boundOnResendMessage);
        this.removeEventListener('rtc-fork-initiated', this._boundOnForkInitiated);
        this.removeEventListener('rtc-session-delete-requested', this._boundOnSessionDeleteRequested);
        this.removeEventListener('rtc-session-rename-requested', this._boundOnSessionRenameRequested);
        this.removeEventListener('rtc-session-rename-confirmed', this._boundOnSessionRenameConfirmed);
        this.removeEventListener('rtc-toast-requested', this._boundOnToastRequested);
        this.removeEventListener('rtc-toast-close', this._boundOnToastClose);
        this.removeEventListener('rtc-command-requested', this._boundOnCommandRequested);
        this.removeEventListener('activity-change', this._boundOnActivityChange);
        this.removeEventListener('file-select', this._boundOnFileSelect);
        this.removeEventListener('folder-toggle', this._boundOnFolderToggle);
        this.removeEventListener('editor-area-save', this._boundOnEditorAreaSave);
        this.removeEventListener('editor-area-tab-close', this._boundOnEditorAreaTabClose);
        this.removeEventListener('editor-area-tab-select', this._boundOnEditorAreaTabSelect);
        this.removeEventListener('editor-area-content-change', this._boundOnEditorAreaContentChange);
        this.removeEventListener('editor-area-view-mode-change', this._boundOnEditorAreaViewModeChange);
        this.removeEventListener('editor-area-cursor-move', this._boundOnEditorAreaCursorMove);
        this.removeEventListener('refresh-requested', this._boundOnFileExplorerRefresh);
        this.removeEventListener('rtc-chat-layout-session-select', this._boundOnChatLayoutSessionSelect);
        this.removeEventListener('rtc-chat-layout-tab-activate', this._boundOnChatLayoutTabActivate);
        this.removeEventListener('rtc-chat-layout-tab-close', this._boundOnChatLayoutTabClose);
        this.removeEventListener('rtc-drawer-close', this._boundOnDrawerClose);
        this.removeEventListener('keydown', this._boundOnKeydown);
        this.removeEventListener('wheel', this._boundOnWheel);
        this._busUnsubMessage?.();
        this._rtcProcessor = undefined;
        this._unsubConnection?.();
        this._auth.onLogin = undefined;  // Clear auth callback to prevent leaks

        // Invalidate any in-flight connection attempt (see _connectGeneration docs).
        this._connectGeneration++;
        this._connecting = undefined;

        // Clear all auto-save timers
        for (const timer of this._autoSaveTimers.values()) {
            clearTimeout(timer);
        }
        this._autoSaveTimers.clear();
    }

    updated() {
        // Sync controller values to context providers after host update completes
        // Using updateComplete ensures we don't trigger change-in-update warnings
        void this.updateComplete.then(() => {
            this._sessionProvider.setValue(this._session.value);
            this._messageProvider.setValue(this._message.value);
            this._toolCallProvider.setValue(this._toolCall.value);
            this._authProvider.setValue(this._auth.value);
            this._modeProvider.setValue(this._mode.value);
            this._windowStateProvider.setValue(this._windowState.value);
            this._skillProvider.setValue(this._skill.value);
            this._activityProvider.setValue(this._activity.value);
            this._fileExplorerProvider.setValue(this._fileExplorer.value);
            this._sessionTreeProvider.setValue(this._sessionTree.value);
            this._sessionTabProvider.setValue(this._sessionTab.value);
            this._settingsProvider.setValue(this._settings.value);
            this._notificationProvider.setValue(this._notification.value);
            this._localeProvider.setValue({
                locale: getLocale() as typeof sourceLocale | typeof targetLocales[number],
                setLocale: switchLocale,
                locales: [sourceLocale, ...targetLocales],
            });
        }).catch(err => {
            log.error('Context provider sync failed:', err);
        });

        // Monitor tab count: when all tabs are closed, auto-create a new unsaved tab.
        // This is a reactive design: listens to state changes via Lit's updated() lifecycle.
        // No need to duplicate logic in every tab-close handler.
        // Note: skip auto-creation before initial load completes (_initialSessionLoadDone === false)
        // to avoid racing with _loadSessions' restore logic and polluting localStorage.
        const tabCount = this._sessionTab.value.state.tabs.length;
        if (tabCount === 0 && !this._creatingUnsavedTab && this._initialSessionLoadDone) {
            log.debug('No tabs left, auto-creating unsaved tab');
            this._creatingUnsavedTab = true;
            try {
                const newId = this._session.actions.createSession();
                this._session.actions.switchSession(newId);
                this._sessionTab.actions.openOrActivate(newId, 'Untitled', {isUnsaved: true});
            } finally {
                this._creatingUnsavedTab = false;
            }
        }

        // Sync work mode to RtcProcessor
        if (this._rtcProcessor) {
            this._rtcProcessor.setMode(this._mode.value.state.currentMode);
        }

        // Apply DOM side-effects for mode transitions (data-mode, position, focus).
        const mode = this._windowState.value.state.mode;
        if (mode !== this._appliedMode) {
            this._appliedMode = mode;
            this.setAttribute('data-mode', mode);
            this._handleModeTransition(mode);
        }

        // Sync interaction state with window mode
        if (mode !== 'normal') {
            this._interaction.value.actions.disable();
        } else {
            this._interaction.value.actions.enable();
        }

        // Apply window geometry to DOM (state → inline styles) — delegated to controller
        this._windowState.applyGeometry(this);
    }

    firstUpdated() {
        // Set initial position only when no persisted state exists
        if (!this._windowState.restored) {
            const margin = 20;
            const defaultWidth = parseInt(getComputedStyle(this).getPropertyValue('--rtc-window-default-width')) || 420;
            const defaultHeight = parseInt(getComputedStyle(this).getPropertyValue('--rtc-window-default-height')) || 640;
            const initialX = window.innerWidth - defaultWidth - margin;
            const initialY = window.innerHeight - defaultHeight - margin;
            this._windowState.actions.setPosition({x: initialX, y: initialY});
        }

        // Bind elements after Shadow DOM is ready
        const titleBarElement = this.shadowRoot?.querySelector('rtc-title-bar');
        if (titleBarElement) {
            this._interaction.bindElements(this, titleBarElement as HTMLElement);
            // Enable if in normal mode
            if (this._windowState.value.state.mode === 'normal') {
                this._interaction.value.actions.enable();
            }
        }

        // Signal readiness to host applications
        // 1. Resolve the whenReady() Promise (for ES module importers)
        _markReady();
        // 2. Dispatch rtc-agent-ready event (for addEventListener listeners)
        this.dispatchEvent(new CustomEvent<void>('rtc-agent-ready', {
            bubbles: true,
            composed: true,
        }));
    }

    /* ── Connection Retry Handler ── */

    /**
     * Handle user clicking the retry button.
     *
     * When SharedWorker initialization fails or WebSocket connection cannot be established,
     * the user can click the retry button in the title bar to trigger this method.
     */
    private _handleConnectionRetry() {
        log.info('Connection retry requested by user');
        void this.reconnect();
    }

    /* ── Mode Transition Side-Effects ── */

    private _handleModeTransition(mode: WindowMode) {
        // Move focus after the render completes.
        this.updateComplete.then(() => {
            if (mode === 'minimized') {
                const bubble = this.shadowRoot?.querySelector<HTMLElement>('.bubble');
                bubble?.focus();
            } else {
                const titleBar = this.shadowRoot?.querySelector<HTMLElement>('rtc-title-bar');
                titleBar?.focus();
            }
        });

        // When restoring from minimized, clear notification animation and unread count.
        if (this._appliedMode === 'minimized' && mode !== 'minimized') {
            this._notification.actions.markAsRead();
        }

        // Announce to screen readers.
        this._modeAnnouncement = MODE_ANNOUNCEMENTS[mode];
    }

    /* ── Bubble Handlers ── */

    private _handleBubbleClick() {
        this._windowState.actions.restore();
        // Clear notification animation and unread count when restoring from minimized.
        this._notification.actions.markAsRead();
    }

    private _handleBubbleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._windowState.actions.restore();
            this._notification.actions.markAsRead();
        }
    }

    /**
     * Find the nearest scrollable ancestor of an element within the component.
     *
     * Traverses up the DOM tree (crossing shadow DOM boundaries via composedPath)
     * to find the first element with overflow-y: auto|scroll that has scrollable
     * content (scrollHeight > clientHeight).
     */
    private _findScrollableParent(el: Element): Element | null {
        let current: Element | null = el;

        while (current && current !== this) {
            const style = getComputedStyle(current);
            const overflowY = style.overflowY;
            const overflowX = style.overflowX;

            const isVertScrollable = (overflowY === 'auto' || overflowY === 'scroll') &&
                current.scrollHeight > current.clientHeight;
            const isHorizScrollable = (overflowX === 'auto' || overflowX === 'scroll') &&
                current.scrollWidth > current.clientWidth;

            if (isVertScrollable || isHorizScrollable) {
                return current;
            }

            // Move to parent, handling shadow DOM boundaries
            if (current.parentElement) {
                current = current.parentElement;
            } else {
                const root = current.getRootNode();
                if (root instanceof ShadowRoot && root.host !== this) {
                    current = root.host;
                } else {
                    break;
                }
            }
        }

        return null;
    }

    /* ── Login Dialog Handlers ── */

    private _handleLoginRequested(event: Event) {
        const customEvent = event as CustomEvent<{provider?: string}>;
        const provider = customEvent?.detail?.provider ?? 'mock';
        this._selectedProvider = provider;
        this._showLoginDialog = true;
    }

    private _handleLoginComplete(event: CustomEvent) {
        const {accessToken, refreshToken, userId, expiresIn} = event.detail;

        // Call controller.setTokens() directly (not via Context)
        // setTokens() internally calls onLogin callback which triggers _connectWithRetry()
        this._auth.setTokens({
            accessToken,
            refreshToken,
            userId,
            expiresIn,
        });

        this._showLoginDialog = false;
    }

    private _handleLoginDialogClose() {
        this._showLoginDialog = false;
    }

    /* ── Session & Turn Count ── */

    /**
     * Read current session's pending_turn_count / running_turn_count from persistence,
     * write to TurnCountContext for <rtc-input-area> to render send/stop buttons.
     *
     * Pushes zero values when there's no currentSessionId or persistence isn't ready.
     */
    private async _refreshTurnCounts() {
        const currentId = this._session.value.state.currentSessionId;
        if (!currentId || !this._persistence.layer) {
            this._turnCountProvider.setValue(DEFAULT_TURN_COUNT);
            return;
        }
        const session = await this._persistence.layer.getSession(currentId);
        if (!session) {
            this._turnCountProvider.setValue(DEFAULT_TURN_COUNT);
            return;
        }
        this._turnCountProvider.setValue({
            pendingTurnCount: session.pending_turn_count,
            runningTurnCount: session.running_turn_count,
        });
    }

    /**
     * Load sessions list from persistence and sync into SessionController (delegated to session-loader).
     * On initial load (after refresh), auto-selects the most recently updated session if none selected.
     */
    private async _loadSessions() {
        const result = await sessionLoadSessions(this._initialSessionLoadDone, {
            persistenceLayer: this._persistence.layer,
            session: this._session,
            sessionTree: this._sessionTree,
            sessionTab: this._sessionTab,
            logger: log,
        });
        this._initialSessionLoadDone = result;
    }

    /* ── Slash Command Handling ── */

    /**
     * Handle slash commands (delegated to command-handler helper).
     *
     * Currently supported commands:
     * - /compact [custom_instruction]: compress current session context
     */
    private async _handleCommand(name: string, args?: string): Promise<void> {
        await dispatchCommand(name, args, {
            persistenceLayer: this._persistence.layer,
            currentSessionId: this._session.value.state.currentSessionId,
            toast: this._toast.actions,
            logger: log,
        });
    }

    /* ── VFS Integration (Phase 3/4) ── */

    /** VFS dependency adapter (created lazily, reused across calls). */
    private get _vfsDeps() {
        return {
            persistenceIsConnected: this._persistence.isConnected,
            fileExplorer: this._fileExplorer,
            editorArea: this._editorArea,
            toast: this._toast.actions,
            settingsDefaultViewMode: this._settings.value.state.files.defaultViewMode,
            logger: log,
        };
    }

    /**
     * Load file tree from virtualFS (delegated to vfs-operations helper).
     */
    private async _loadFileTree(): Promise<void> {
        const success = await vfsLoadFileTree(this._vfsDeps);
        if (success) this._fileTreeLoaded = true;
    }

    /**
     * Lazy-load children of a directory (delegated to vfs-operations helper).
     */
    private async _loadFolderChildren(path: string): Promise<void> {
        await vfsLoadFolderChildren(path, this._vfsDeps);
    }

    /**
     * Open a file: read content from VFS and open in editor (delegated to vfs-operations).
     */
    private async _handleFileOpen(filePath: string): Promise<void> {
        await vfsHandleFileOpen(filePath, this._vfsDeps);
    }

    /**
     * Restore Editor Area content for open files after page refresh (delegated to vfs-operations).
     */
    private async _restoreEditorAreaContent(): Promise<void> {
        await vfsRestoreEditorAreaContent(this._fileTreeLoaded, this._vfsDeps);
    }

    /**
     * Save file: write editor content to VFS (delegated to vfs-operations).
     */
    private async _handleEditorSave(filePath: string): Promise<void> {
        // Clear auto-save timer if exists
        const timer = this._autoSaveTimers.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this._autoSaveTimers.delete(filePath);
        }
        await vfsHandleEditorSave(filePath, this._vfsDeps);
    }

    /**
     * Schedule auto-save (debounced).
     */
    private _scheduleAutoSave(filePath: string): void {
        // Clear existing timer for this file
        const existingTimer = this._autoSaveTimers.get(filePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Schedule new save after 1 second of inactivity
        const timer = setTimeout(() => {
            this._autoSaveTimers.delete(filePath);
            void this._handleEditorSave(filePath);
        }, 1000);

        this._autoSaveTimers.set(filePath, timer);
    }

    /**
     * Handle file change events from other tabs (delegated to vfs-operations).
     */
    private async _handleFileChange(filePath: string, field: string): Promise<void> {
        await vfsHandleFileChange(
            filePath,
            field,
            this._fileTreeLoaded,
            this._vfsDeps,
            () => this._loadFileTree(),
            (path) => this._loadFolderChildren(path),
        );
    }

    /* ── Render ── */

    /**
     * Sanitize and render bubble icon content.
     *
     * Uses DOMPurify (already loaded by rtc-message for Markdown) to strip
     * any script/event-handler attributes, preventing XSS even if the value
     * accidentally contains unsanitized user input.
     */
    private async _sanitizeBubbleIcon(raw: string): Promise<string> {
        try {
            const {default: DOMPurify} = await import('dompurify');
            return DOMPurify.sanitize(raw, {ALLOWED_TAGS: ['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'use'], ALLOWED_ATTR: ['viewBox', 'd', 'xmlns', 'fill', 'stroke', 'stroke-width', 'class', 'width', 'height', 'transform', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'dx', 'dy', 'text-anchor', 'font-size', 'href']});
        } catch {
            // DOMPurify not available — strip all tags as a safe fallback
            const el = document.createElement('div');
            el.textContent = raw;
            return el.innerHTML;
        }
    }

    private _renderBubbleContent() {
        if (this.bubbleIcon) {
            // Sanitize on each render — bubbleIcon is typically short and static,
            // so the async overhead is negligible. For hot paths, cache the result.
            return html`<span class="bubble-icon" .innerHTML=${this._sanitizedBubbleIcon}></span>`;
        }
        // Default: use a simplified version of the product logo.
        return html`<span class="bubble-logo">${renderBubbleLogo(this.theme === 'dark')}</span>`;
    }

    /** Cached sanitized bubble icon HTML. */
    private _sanitizedBubbleIcon = '';

    /** Recompute sanitized icon when bubbleIcon changes. */
    willUpdate(changed: Map<string, unknown>) {
        if (changed.has('bubbleIcon') && this.bubbleIcon) {
            void this._sanitizeBubbleIcon(this.bubbleIcon).then(sanitized => {
                this._sanitizedBubbleIcon = sanitized;
                this.requestUpdate();
            }).catch(err => {
                log.error('Bubble icon sanitization failed:', err);
                this._sanitizedBubbleIcon = '';
            });
        }
    }

    render() {
        const isLoggedIn = this._auth.value.state.isLoggedIn;
        const mode = this._windowState.value.state.mode;
        const active = this._activity.active;
        const sidebarVisible = this._activity.sidebarVisible;

        return html`
      <div class="window-container">
        <rtc-title-bar
          app-label=${this.appLabel}
          .windowMode=${mode}
          .connectionState=${this._connectionState}
          ?connection-failed=${this._connectionFailed}
          connection-error=${this._connectionError}
          ?show-minimize=${this._resolvedWindowConfig.showMinimize}
          ?show-maximize=${this._resolvedWindowConfig.showMaximize}
          @rtc-connection-retry=${this._handleConnectionRetry}
        ></rtc-title-bar>
        ${isLoggedIn
          ? this._renderMainLayout(active, sidebarVisible)
          : html`<div class="content-area"><rtc-login-page theme=${this.theme}></rtc-login-page></div>`}
        <rtc-toast .toasts=${this._toast.toasts}></rtc-toast>
      </div>
      <div class="bubble"
          role="button"
          tabindex="0"
          title=${this.appLabel}
          aria-label="Restore ${this.appLabel}"
          @click=${this._handleBubbleClick}
          @keydown=${this._handleBubbleKeydown}>
        ${this._renderBubbleContent()}
      </div>
      <span class="sr-only" aria-live="polite" role="status">${this._modeAnnouncement}</span>
      ${this._showLoginDialog
        ? html`<rtc-login-dialog
            .provider=${this._selectedProvider}
            @rtc-login-complete=${this._handleLoginComplete}
            @rtc-login-dialog-close=${this._handleLoginDialogClose}
          ></rtc-login-dialog>`
        : null}
    `;
    }

    /**
     * Render the main layout (after login).
     *
     * Chat mode: Activity Bar + Chat Layout (containing drawer + Tab + chat).
     * Files mode: Activity Bar + [Drawer(file tree)] + Editor Area + Status Bar.
     * Settings mode: Activity Bar + Settings Layout (containing drawer + settings content).
     *
     * All side panels use <rtc-drawer> overlay drawers uniformly, without squeezing the main content area.
     */
    private _renderMainLayout(active: Activity, sidebarVisible: boolean) {
        const isFiles = active === 'files';
        const isChat = active === 'chat';
        const isSettings = active === 'settings';
        const showSidebar = sidebarVisible && (isFiles || isChat || isSettings);
        const disabled = this._resolvedActivityBarConfig.disabledActivities;

        return html`
      <div class="main-layout">
        <rtc-activity-bar
          .active=${active}
          theme=${this.theme}
          ?show-files=${!disabled.includes('files')}
          ?show-settings=${!disabled.includes('settings')}
        ></rtc-activity-bar>
        ${isFiles
          ? html`<rtc-drawer ?open=${showSidebar} style="--rtc-drawer-left: 48px">
              <rtc-file-explorer theme=${this.theme}></rtc-file-explorer>
            </rtc-drawer>`
          : nothing}
        ${isFiles
          ? html`<div class="editor-area-wrapper">
              <rtc-editor-area
                .tabs=${this._editorArea.state.tabs}
                active-file-path=${this._editorArea.state.activeFilePath}
                theme=${this.theme}
              ></rtc-editor-area>
              <rtc-status-bar
                .fileInfo=${this._statusBar.info}
                theme=${this.theme}
              ></rtc-status-bar>
            </div>`
          : isChat
            ? html`<rtc-chat-layout theme=${this.theme} .sessionTreeVisible=${sidebarVisible} .messageController=${this._message}></rtc-chat-layout>`
            : isSettings
              ? html`<rtc-settings-layout theme=${this.theme} .sidebarVisible=${sidebarVisible}></rtc-settings-layout>`
              : nothing}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-agent': RtcAgent;
    }

    /**
     * Debug API available in dev/test builds.
     *
     * Provides state inspection, data manipulation, auth bypass, event simulation,
     * VirtualFS access, and UI control for Playwright E2E tests.
     *
     * Only present when import.meta.env.DEV or import.meta.env.MODE === 'test'.
     */
    interface Window {
        rtcAgentDebug?: import('../../debug-api.js').RtcAgentDebugAPI;
    }
}
