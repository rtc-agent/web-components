/**
 * RTC Agent — Root Component
 *
 * The only public custom element exposed by the library. This component is a
 * pure "assembler": it creates Reactive Controllers, wires each controller's
 * value to a @lit/context provider, and renders the top-level shell UI.
 *
 * All state logic (session, message, tool call, auth, mode, window state,
 * toast, fork) is delegated to controllers in `src/controllers/`. The root
 * component handles cross-controller coordination, event routing, and
 * lifecycle management. Complex subscription logic (e.g., UIUpdateBus handling)
 * is extracted to `helpers/` for maintainability.
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
import {version} from '../../../package.json';
import {styles} from './rtc-agent.styles.js';
import type {WindowMode, Activity} from '../../types/index.js';

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
import {LogoContext, DEFAULT_LOGO} from '../../contexts/logo.js';

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
import {EventBindingController} from '../../controllers/event-binding.controller.js';

// Scenario loading
import {setServerUrl, setRedirectUri} from '../../config/auth.js';
import {loadScenariosContent} from '../../core/scenario-loader.js';
import {defineRegistry} from '../../core/function-registry.js';
import type {FunctionRegistry} from '../../core/function-registry.js';

// Ready signal
import {_markReady} from '../../core/ready.js';

// i18n
import {initLocale, getLocale, localeContext, type LocaleContextValue, sourceLocale, targetLocales, switchLocale, isValidLocale, type SupportedLocale} from '../../core/i18n.js';
import {msg} from '@lit/localize';

// Logo
import {renderBubbleLogo} from '../../icons/logo.js';

// Declarative config types
import type {AgentConfig} from '../../types/agent-config.js';
import type {WindowConfig} from '../../types/window-config.js';
import {resolveWindowConfig} from '../../types/window-config.js';
import type {ActivityBarConfig} from '../../types/activity-bar-config.js';
import {resolveActivityBarConfig, type ResolvedActivityBarConfig} from '../../types/activity-bar-config.js';
import type {StaticTokenAuth, DynamicTokenAuth, AuthProvider} from '../../types/factory.js';
// Side-effect import: extends HTMLElementEventMap with rtc-agent-ready event
import '../../types/events.js';

// UIUpdateBus (persistence-layer singleton for driving UI refreshes)
import {getUIUpdateBus, RtcProcessor} from '@rtc-agent/persistence';
import type {LocalRtc} from '@rtc-agent/persistence';

// Tool confirm dialog
import '../overlay/rtc-tool-confirm.js';
import '../overlay/rtc-ask-user.js';
import '../overlay/rtc-restore-confirm.js';
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

// Logo component (theme-aware, context-driven)
import '../logo/rtc-logo.js';

// Toast types (re-exported from ToastController)
import type {ToastType} from '../overlay/rtc-toast.js';

// Debug API (dev/test only)
import {installDebugAPI} from '../../debug-api.js';

// Extracted helpers (keep rtc-agent.ts lean — business logic lives in helpers/)
import {handleCommand as dispatchCommand} from './helpers/command-handler.js';
import {showToolConfirmDialog, showAskUserDialog, showRestoreConfirmDialog} from './helpers/dialog-helpers.js';
import {
    loadFileTree as vfsLoadFileTree,
    loadFolderChildren as vfsLoadFolderChildren,
    handleFileOpen as vfsHandleFileOpen,
    restoreEditorAreaContent as vfsRestoreEditorAreaContent,
    handleEditorSave as vfsHandleEditorSave,
    handleFileChange as vfsHandleFileChange,
    handleRestoreDefault as vfsHandleRestoreDefault,
} from './helpers/vfs-operations.js';
import {loadSessions as sessionLoadSessions} from './helpers/session-loader.js';
import {connectWithRetry} from './helpers/connection-setup.js';
import {handleBusEvent, type BusHandlerDeps, DebouncedSessionLoader} from './helpers/bus-handler.js';

// Connection state type
import type {ConnectionState} from '@rtc-agent/client';
import {createLogger} from '@rtc-agent/client';

// Aria-live announcements per mode transition
const log = createLogger('RtcAgent');

const MODE_ANNOUNCEMENTS: Record<WindowMode, string> = {
    normal: 'Window restored',
    maximized: 'Window maximized',
    minimized: 'Window minimized',
};

/** Debounce delay (ms) for auto-save after content changes. */
const AUTO_SAVE_DEBOUNCE_MS = 1000;

/** Margin (px) from viewport edge for initial window position in {@link RtcAgent.firstUpdated}. */
const INITIAL_POSITION_MARGIN_PX = 20;

@customElement('rtc-agent')
export class RtcAgent extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Public Properties ── */

    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /**
     * Language/locale for the component UI.
     *
     * Priority: HTML attribute > localStorage > browser language > default (zh-CN).
     *
     * Host applications can set this attribute declaratively:
     * ```html
     * <rtc-agent lang="en-US"></rtc-agent>
     * ```
     *
     * Or update dynamically:
     * ```js
     * rtcAgentEl.lang = 'en-US';
     * ```
     */
    @property({type: String, attribute: 'lang'})
    set lang(value: string) {
        const oldLang = this._lang;
        if (value && isValidLocale(value) && value !== oldLang) {
            this._lang = value;
            // Sync to i18n system (async, fire-and-forget)
            void switchLocale(value);
            // Update context provider
            this._localeProvider.setValue({
                locale: value as SupportedLocale,
                setLocale: switchLocale,
                locales: [sourceLocale, ...targetLocales],
            });
        }
    }
    get lang(): string {
        return this._lang || getLocale();
    }
    private _lang = '';

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
     * Custom logo for host application branding.
     *
     * When set, replaces the default RTC Agent logo everywhere it appears:
     * login page, empty state, settings "about" section.
     *
     * Provide separate SVG/HTML strings for light and dark themes:
     * ```ts
     * agent.logo = {
     *   light: '<svg>...</svg>',  // rendered in light theme
     *   dark: '<svg>...</svg>',   // rendered in dark theme
     * };
     * ```
     *
     * Either field can be omitted; missing variants fall back to the default logo.
     *
     * **Security note**: Same as `bubbleIcon` — callers should sanitize input
     * before assignment. The component does NOT sanitize this value.
     */
    @property({attribute: false})
    set logo(value: { light?: string; dark?: string } | null) {
        this._logo = value;
        this._logoProvider.setValue({
            light: value?.light ?? '',
            dark: value?.dark ?? '',
        });
    }
    get logo(): { light?: string; dark?: string } | null {
        return this._logo;
    }
    private _logo: { light?: string; dark?: string } | null = null;

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
            const { files, deletePaths } = await registry.generateAllDocsContent(0);
            await this._persistence.workerBridge!.core.batchWriteFiles(files, deletePaths);

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
     * Custom database name prefix (optional).
     *
     * When set, the database name becomes `${databaseName}-${userId}` instead of `rtc-agent-${userId}`.
     *
     * @example
     * <rtc-agent database-name="my-app"></rtc-agent>
     * // Creates database: my-app-{userId}
     */
    @property({ type: String, attribute: 'database-name' })
    set databaseName(value: string) {
        this._databaseName = value;
        this._persistence.databaseName = value || undefined;
    }
    get databaseName(): string {
        return this._databaseName;
    }
    private _databaseName = '';

    /**
     * Custom SharedWorker URL (optional).
     *
     * When the component is loaded from NPM, the worker file may not be accessible
     * from the default location. Use this to specify a custom URL where the worker
     * file is served (e.g., '/rtc-agent/shared-worker.js').
     *
     * Must be set before the element is mounted to the DOM.
     *
     * @example
     * <rtc-agent worker-url="/rtc-agent/shared-worker.js"></rtc-agent>
     *
     * @example
     * ```ts
     * agent.workerUrl = '/rtc-agent/shared-worker.js';
     * ```
     */
    @property({ type: String, attribute: 'worker-url' })
    set workerUrl(value: string) {
        this._workerUrl = value;
        this._persistence.workerUrl = value || undefined;
    }
    get workerUrl(): string {
        return this._workerUrl;
    }
    private _workerUrl = '';

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
     * @internal Pending auth configuration from factory function.
     *
     * Set by `createRtcAgent` factory when StaticTokenAuth is provided.
     * Applied in `connectedCallback` after controllers are initialized.
     * Cleared after application to prevent re-application on reconnect.
     */
    @property({attribute: false})
    _pendingAuthConfig?: StaticTokenAuth;

    /**
     * @internal Pending dynamic auth configuration from factory function.
     *
     * Set by `createRtcAgent` factory when DynamicTokenAuth is provided.
     * Applied in `connectedCallback` after controllers are initialized.
     */
    @property({attribute: false})
    _pendingDynamicAuth?: DynamicTokenAuth;

    /**
     * @internal Pending auth provider configuration from factory function.
     *
     * Set by `createRtcAgent` factory when AuthProvider is provided.
     * Applied in `connectedCallback` after controllers are initialized.
     */
    @property({attribute: false})
    _pendingAuthProvider?: AuthProvider;

    /**
     * Load scenarios into VirtualFS.
     *
     * Writes to the Worker's VirtualFS via WorkerBridge.
     */
    private async _loadScenarios(baseURL: string): Promise<void> {
        try {
            const { files, deletePaths } = await loadScenariosContent(baseURL);
            await this._persistence.workerBridge!.core.batchWriteFiles(files, deletePaths);
            log.info(`Loaded ${files.length} scenarios from ${baseURL}, deleted orphans: ${deletePaths.length}`);
        } catch (err) {
            log.error('Failed to load scenarios:', err);
            throw err;  // Re-throw so caller can handle if needed
        }
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

    /** Event binding controller (manages all DOM event listeners). */
    private _eventBindings!: EventBindingController;

    /** UIUpdateBus unsubscribe reference (set in connectedCallback, cleared in disconnectedCallback). */
    private _busUnsubMessage?: () => void;

    /** UIUpdateBus bulk update unsubscribe reference (set in connectedCallback, cleared in disconnectedCallback). */
    private _busUnsubBulkUpdate?: () => void;

    /** UIUpdateBus gap fill state unsubscribe reference (set in connectedCallback, cleared in disconnectedCallback). */
    private _busUnsubGapFill?: () => void;

    /** Debounced session loader to prevent multiple concurrent loadSessions calls (Fix 40). */
    private _sessionLoader?: DebouncedSessionLoader;

    /**
     * @internal Async beforeMessageSend hook, set by the `createRtcAgent` factory
     * when the `beforeMessageSend` callback is provided.
     *
     * Called before each message send. Returning `false` cancels the send.
     * The hook may also mutate the message detail in place.
     *
     * Cleared in disconnectedCallback to prevent leaks.
     */
    _beforeMessageSendHook?: (detail: {
        message: { content: string; metadata?: Record<string, unknown> };
    }) => boolean | Promise<boolean>;

    /** Whether gap fill syncing overlay is shown. */
    private _isSyncing = false;

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
    private _logoProvider = new ContextProvider(this, {context: LogoContext, initialValue: DEFAULT_LOGO});
    private _localeProvider = new ContextProvider(this, {context: localeContext, initialValue: {
        locale: sourceLocale,
        setLocale: switchLocale,
        locales: [sourceLocale, ...targetLocales],
    } as LocaleContextValue});

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();

        // Initialize i18n locale (once), passing host's lang attribute if set
        if (!this._localeInitialized) {
            this._localeInitialized = true;
            void initLocale(this._lang || undefined);
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
            // Note: clearing tab transient params is handled by chat-layout._handleTabActivate
            const sessionId = this._session.value.state.currentSessionId;
            if (sessionId) {
                const repoState = this._message.repository.getSessionState(sessionId);
                if (repoState.messages.length === 0) {
                    // First load or session was evicted: repository has no data, fetch from DB
                    log.debug('onSessionSwitch calling message.reload() (empty repository)');
                    void this._message.reload();
                } else {
                    // Repository already has data (kept in sync via WebSocket), skip reload
                    // This avoids unnecessary DB queries and DOM updates
                    log.debug(`onSessionSwitch skipping reload (repo has ${repoState.messages.length} messages)`);
                }
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

        // Initialize EventBindingController with all dependencies
        this._eventBindings = new EventBindingController(this, {
            // Controllers
            windowState: this._windowState,
            auth: this._auth,
            session: this._session,
            message: this._message,
            toolCall: this._toolCall,
            interaction: this._interaction,
            persistence: this._persistence,
            skill: this._skill,
            toast: this._toast,
            fork: this._fork,
            activity: this._activity,
            fileExplorer: this._fileExplorer,
            editorArea: this._editorArea,
            statusBar: this._statusBar,
            sessionTree: this._sessionTree,
            sessionTab: this._sessionTab,
            settings: this._settings,
            notification: this._notification,
            // State accessors
            autoSaveTimers: this._autoSaveTimers,
            getRtcProcessor: () => this._rtcProcessor,
            setRtcProcessor: (v) => { this._rtcProcessor = v; },
            getUnsubConnection: () => this._unsubConnection,
            setUnsubConnection: (v) => { this._unsubConnection = v; },
            getConnectGeneration: () => this._connectGeneration,
            bumpConnectGeneration: () => { this._connectGeneration++; },
            getConnecting: () => this._connecting,
            setConnecting: (v) => { this._connecting = v; },
            // File tree state
            fileTreeLoaded: () => this._fileTreeLoaded,
            setFileTreeLoaded: (v) => { this._fileTreeLoaded = v; },
            initialSessionLoadDone: () => this._initialSessionLoadDone,
            setInitialSessionLoadDone: (v) => { this._initialSessionLoadDone = v; },
            // Callbacks
            loadFileTree: () => this._loadFileTree(),
            loadFolderChildren: (path) => this._loadFolderChildren(path),
            handleFileOpen: (path) => this._handleFileOpen(path),
            handleEditorSave: (path) => this._handleEditorSave(path),
            handleRestoreDefault: async (path) => {
                const result = await vfsHandleRestoreDefault(path, {
                    persistence: this._persistence,
                    editorArea: this._editorArea,
                    skill: this._skill,
                    scenariosURL: this._scenariosURL,
                    toast: this._toast.actions,
                    logger: log,
                });
                return result;
            },
            loadSessions: () => this._loadSessions(),
            handleCommand: (name, args) => this._handleCommand(name, args),
            beforeMessageSend: (detail) => this._beforeMessageSend(detail),
            showRestoreConfirmDialog: (path, root) => showRestoreConfirmDialog(path, root),
            handleLoginRequested: (event) => this._handleLoginRequested(event),
            dispatchClearActiveInput: () => this.dispatchEvent(new CustomEvent('rtc-clear-active-input')),
            getShadowRoot: () => this.shadowRoot!,
            findScrollableParent: (el) => this._findScrollableParent(el),
            scheduleAutoSave: (filePath) => this._scheduleAutoSave(filePath),
            // Logger
            log,
        });

        // Bind all DOM event listeners via EventBindingController
        this._eventBindings.bindEvents(this);

        // Subscribe to UIUpdateBus for persistence-driven UI refreshes (delegated to bus-handler).
        const bus = getUIUpdateBus();
        // Create debounced session loader to prevent multiple concurrent loadSessions calls (Fix 40).
        this._sessionLoader = new DebouncedSessionLoader(() => this._loadSessions());
        const busDeps: BusHandlerDeps = {
            message: this._message,
            session: this._session,
            sessionTab: this._sessionTab,
            sessionTree: this._sessionTree,
            persistence: this._persistence,
            getRtcProcessor: () => this._rtcProcessor,
            sessionLoader: this._sessionLoader,
            refreshTurnCounts: () => this._refreshTurnCounts(),
            handleFileChange: (entityId, field) => this._handleFileChange(entityId, field),
            log,
        };
        this._busUnsubMessage = bus.subscribe((event) => handleBusEvent(event, busDeps));

        // Subscribe to bulk updates (emitted after gap fill completes).
        // Reload affected data sources based on entity types.
        this._busUnsubBulkUpdate = bus.onBulkUpdate((event) => {
            log.debug('[BulkUpdate] rtc-agent received bulk-update, entities:', Array.from(event.entities));
            // Reload sessions if session entity was updated
            if (event.entities.has('session')) {
                void this._loadSessions();
            }
            // Reload messages if message entity was updated
            if (event.entities.has('message')) {
                const currentSessionId = this._session.value.state.currentSessionId;
                if (currentSessionId) {
                    void this._message.reload();
                }
            }
            // Refresh turn counts if turn entity was updated
            if (event.entities.has('turn')) {
                void this._refreshTurnCounts();
            }
            // Reload file tree if file entity was updated
            if (event.entities.has('file')) {
                void this._loadFileTree();
            }
            // Always reload RTC if rtc entity was updated
            if (event.entities.has('rtc')) {
                this._rtcProcessor?.onRtcUpdate();
            }
        });

        // Subscribe to gap fill state changes (show/hide syncing overlay).
        this._busUnsubGapFill = bus.onGapFillState((isSyncing) => {
            log.debug('[BulkUpdate] rtc-agent gap fill state:', isSyncing);
            this._isSyncing = isSyncing;
            this.requestUpdate();
            // When gap fill ends, reload all data to ensure consistency
            if (!isSyncing) {
                log.debug('[BulkUpdate] gap fill ended, reloading all data');
                void this._loadSessions();
                const currentSessionId = this._session.value.state.currentSessionId;
                if (currentSessionId) {
                    void this._message.reload();
                }
                void this._refreshTurnCounts();
                void this._loadFileTree();
                this._rtcProcessor?.onRtcUpdate();
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

        // Apply pending auth config from factory function (StaticTokenAuth mode).
        // Must be done before the onLogin callback is set, so that setExternalTokens
        // triggers onLogin -> _connectWithRetry naturally.
        if (this._pendingAuthConfig) {
            const auth = this._pendingAuthConfig;
            this._pendingAuthConfig = undefined;

            this._auth.setExternalTokens({
                accessToken: auth.accessToken,
                refreshToken: auth.refreshToken ?? '',
                userId: auth.userId,
                expiresIn: auth.expiresIn ?? 3600,
            });
            // setExternalTokens triggers onLogin callback, which triggers
            // _connectWithRetry. Skip the explicit check below.
        } else if (this._pendingDynamicAuth) {
            // Mode 2: DynamicTokenAuth
            this._auth.setDynamicTokenProvider({
                getToken: this._pendingDynamicAuth.getToken,
                refreshToken: this._pendingDynamicAuth.refreshToken,
                userId: this._pendingDynamicAuth.userId,
            });
            this._pendingDynamicAuth = undefined;
        } else if (this._pendingAuthProvider) {
            // Mode 3: AuthProvider
            this._auth.setAuthProvider({
                getToken: this._pendingAuthProvider.getToken,
                refreshToken: this._pendingAuthProvider.refreshToken,
                isLoggedIn: this._pendingAuthProvider.isLoggedIn,
                logout: this._pendingAuthProvider.logout,
            });
            this._pendingAuthProvider = undefined;
        }

        // Set auth login callback to trigger WebSocket connection.
        // This fixes the race condition where tokens are expired on page load:
        // _loadTokens() starts async refresh, but connectedCallback() runs before
        // refresh completes, so isLoggedIn is still false. When refresh succeeds,
        // onLogin fires and triggers connection.
        log.debug('[AUTH_LIFECYCLE] connectedCallback() Setting onLogin callback');
        log.debug('[AUTH_LIFECYCLE] connectedCallback() _auth.state.isLoggedIn:', this._auth.state.isLoggedIn);
        this._auth.onLogin = () => {
            log.debug('[AUTH_LIFECYCLE] onLogin callback fired, calling _connectWithRetry()');
            void this._connectWithRetry();
        };

        // If tokens were restored from localStorage (e.g. page refresh),
        // connect persistence layer immediately.
        // Note: If tokens were expired and refresh is in-flight, this check will be false,
        // but onLogin callback will trigger connection when refresh completes.
        if (this._auth.state.isLoggedIn) {
            log.debug('[AUTH_LIFECYCLE] connectedCallback() isLoggedIn is true, calling _connectWithRetry()');
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
        log.debug('[AUTH_LIFECYCLE] _connectWithRetry() called');
        log.debug('[AUTH_LIFECYCLE] _connectWithRetry() _connecting exists?', !!this._connecting);
        log.debug('[AUTH_LIFECYCLE] _connectWithRetry() _connectGeneration:', this._connectGeneration);
        if (this._connecting) {
            log.debug('[AUTH_LIFECYCLE] _connectWithRetry() Already in-flight, reusing existing promise');
            return this._connecting;
        }

        log.debug('[AUTH_LIFECYCLE] _connectWithRetry() Starting new connection attempt');
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
                persistence: this._persistence,
                message: this._message,
                session: this._session,
                notification: this._notification,
                activity: this._activity,
                fileExplorer: this._fileExplorer,
                toast: this._toast.actions,
                skill: this._skill,
                mode: this._mode,
                scenariosURL: this._scenariosURL,
                loadFileTree: () => this._loadFileTree(),
                restoreEditorAreaContent: () => this._restoreEditorAreaContent(),
                showToolConfirm: (rtc) => this._showToolConfirm(rtc),
                showAskUser: (rtc) => this._showAskUser(rtc),
                loadSessions: () => { void this._loadSessions(); },
                onConnectionStateChange: (state) => {
                    this._connectionState = state;
                    this.dispatchEvent(new CustomEvent('rtc-connection-state-change', {
                        detail: { state },
                        bubbles: true,
                        composed: true,
                    }));
                },
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

    /**
     * Lifecycle: element disconnected from DOM.
     *
     * Memory management strategy:
     * Performs comprehensive cleanup of all resources registered in connectedCallback():
     * 1. Dispatch 'rtc-before-destroy' event (for external listeners)
     * 2. Clear async hooks (_beforeMessageSendHook) to release captured closures
     * 3. Remove all DOM event listeners via EventBindingController.unbindEvents()
     * 4. Unsubscribe all UIUpdateBus listeners (message, bulk update, gap fill)
     * 5. Release RTC processor and connection state references
     * 6. Clear auth onLogin callback (prevents closure leak to _connectWithRetry)
     * 7. Invalidate in-flight connection attempts via generation counter
     * 8. Clear all auto-save timers
     *
     * Note: disconnectedCallback may fire for temporary removal (e.g. DOM reordering).
     * The factory's destroy() method provides permanent cleanup.
     */
    disconnectedCallback() {
        // Dispatch beforeDestroy event before any cleanup logic.
        // Note: disconnectedCallback may fire for temporary removal (e.g. DOM reordering),
        // not just permanent destroy. Use factory's destroy() for permanent cleanup.
        this.dispatchEvent(new CustomEvent('rtc-before-destroy', {
            bubbles: true,
            composed: true,
        }));

        // Clear async beforeMessageSend hook to prevent leaks
        this._beforeMessageSendHook = undefined;

        super.disconnectedCallback();
        // Unbind all DOM event listeners via EventBindingController
        // (also called automatically by hostDisconnected, but explicit for clarity)
        this._eventBindings?.unbindEvents(this);
        this._busUnsubMessage?.();
        this._busUnsubBulkUpdate?.();
        this._busUnsubGapFill?.();
        // Dispose debounced session loader to clear pending timer (Fix 40).
        this._sessionLoader?.dispose();
        this._sessionLoader = undefined;
        // FIX #61: Cancel any running processLoop before clearing reference.
        // Ensures the loop exits at the next iteration boundary when the component
        // is unmounted (e.g., React StrictMode double-mount, DOM reordering).
        this._rtcProcessor?.cancel();
        this._rtcProcessor = undefined;
        this._unsubConnection?.();
        log.debug('[AUTH_LIFECYCLE] disconnectedCallback() Clearing onLogin callback');
        this._auth.onLogin = undefined;  // Clear auth callback to prevent leaks

        // Invalidate any in-flight connection attempt (see _connectGeneration docs).
        log.debug('[AUTH_LIFECYCLE] disconnectedCallback() Bumping _connectGeneration from', this._connectGeneration, 'to', this._connectGeneration + 1);
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
        //
        // Deferred via queueMicrotask to avoid Lit "change-in-update" warning:
        // createSession/switchSession/openOrActivate mutate controller state which
        // calls host.requestUpdate() — doing this synchronously inside updated()
        // would schedule a re-render during the active update cycle.
        const tabCount = this._sessionTab.value.state.tabs.length;
        if (tabCount === 0 && !this._creatingUnsavedTab && this._initialSessionLoadDone) {
            log.debug('No tabs left, auto-creating unsaved tab');
            this._creatingUnsavedTab = true;
            queueMicrotask(() => {
                try {
                    const newId = this._session.actions.createSession();
                    this._session.actions.switchSession(newId);
                    this._sessionTab.actions.openOrActivate(newId, msg('未命名'), {isUnsaved: true});
                } finally {
                    this._creatingUnsavedTab = false;
                }
            });
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

        // Reflect embedded state as data attribute for CSS targeting.
        // When embedded, CSS uses position:relative to fill parent container
        // instead of position:fixed which fills the viewport.
        const isEmbedded = this._resolvedWindowConfig.embedded;
        if (isEmbedded) {
            this.setAttribute('data-embedded', '');
        } else {
            this.removeAttribute('data-embedded');
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
            const defaultWidth = parseInt(getComputedStyle(this).getPropertyValue('--rtc-window-default-width')) || 420;
            const defaultHeight = parseInt(getComputedStyle(this).getPropertyValue('--rtc-window-default-height')) || 640;
            const initialX = window.innerWidth - defaultWidth - INITIAL_POSITION_MARGIN_PX;
            const initialY = window.innerHeight - defaultHeight - INITIAL_POSITION_MARGIN_PX;
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

    /* ── Message Send Interception ── */

    /**
     * Run the beforeMessageSend interception pipeline.
     *
     * Two layers of interception:
     * 1. **Factory hook** (`_beforeMessageSendHook`): async-aware, set by the
     *    `createRtcAgent` factory when `on.beforeMessageSend` is provided.
     *    Supports async callbacks (e.g. server-side validation).
     * 2. **DOM event** (`rtc-before-message-send`): synchronous cancelable event,
     *    allows external listeners (not registered via factory) to cancel the send
     *    via `preventDefault()`.
     *
     * If either layer returns `false` / calls `preventDefault()`, the message is
     * not sent. The callback may mutate `detail.message.content` / `detail.message.metadata`
     * in place to modify the outgoing message.
     *
     * @returns `true` to proceed with send, `false` to cancel.
     */
    private async _beforeMessageSend(messageDetail: {
        message: { content: string; metadata?: Record<string, unknown> };
    }): Promise<boolean> {
        // Layer 1: async factory hook (supports Promise<boolean>)
        // Perf note: short-circuit when no hook is registered — avoids entering
        // the async machinery (Promise allocation) on every message send.
        if (this._beforeMessageSendHook) {
            try {
                const hookResult = await this._beforeMessageSendHook(messageDetail);
                if (hookResult === false) {
                    return false;
                }
            } catch (err) {
                log.error('beforeMessageSend hook failed:', err);
                // Degrade gracefully: continue sending when hook throws
            }
        }

        // Layer 2: synchronous cancelable DOM event
        const event = new CustomEvent('rtc-before-message-send', {
            detail: messageDetail,
            bubbles: true,
            composed: true,
            cancelable: true,
        });
        const dispatched = this.dispatchEvent(event);
        if (!dispatched) {
            return false;
        }

        return true;
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
        }).catch(err => {
            log.error('Mode transition focus failed:', err);
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
            log.debug('[TurnCount] Resetting to default (no session or persistence not ready)');
            this._turnCountProvider.setValue(DEFAULT_TURN_COUNT);
            return;
        }
        try {
            const session = await this._persistence.layer.getSession(currentId);
            if (!session) {
                log.debug('[TurnCount] Session not found in persistence, resetting to default');
                this._turnCountProvider.setValue(DEFAULT_TURN_COUNT);
                return;
            }
            log.debug('[TurnCount] Refreshing for session', currentId, 'pending:', session.pending_turn_count, 'running:', session.running_turn_count);
            this._turnCountProvider.setValue({
                pendingTurnCount: session.pending_turn_count,
                runningTurnCount: session.running_turn_count,
            });
        } catch (err) {
            // getSession() can throw if Worker/IndexedDB communication fails.
            // Degrade gracefully: reset to defaults instead of unhandled rejection.
            log.warn('Failed to refresh turn counts:', err);
            this._turnCountProvider.setValue(DEFAULT_TURN_COUNT);
        }
    }

    /**
     * Load sessions list from persistence and sync into SessionController (delegated to session-loader).
     * On initial load (after refresh), auto-selects the most recently updated session if none selected.
     */
    private async _loadSessions() {
        try {
            const result = await sessionLoadSessions(this._initialSessionLoadDone, {
                persistenceLayer: this._persistence.layer,
                session: this._session,
                sessionTree: this._sessionTree,
                sessionTab: this._sessionTab,
                logger: log,
            });
            this._initialSessionLoadDone = result;
        } catch (err) {
            // listSessions() can throw if DB access fails.
            // Log and continue — the user can retry by switching sessions.
            log.warn('Failed to load sessions:', err);
        }
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

        // Schedule new save after AUTO_SAVE_DEBOUNCE_MS of inactivity
        const timer = setTimeout(() => {
            this._autoSaveTimers.delete(filePath);
            void this._handleEditorSave(filePath);
        }, AUTO_SAVE_DEBOUNCE_MS);

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
     * Load DOMPurify with retry logic for stale chunk errors during development.
     */
    private async _loadDOMPurify(attempts = 2): Promise<typeof import('dompurify').default> {
        try {
            const {default: DOMPurify} = await import('dompurify');
            return DOMPurify;
        } catch (err) {
            if (attempts > 0) {
                console.warn('[rtc-agent] DOMPurify load failed, retrying...', err);
                return this._loadDOMPurify(attempts - 1);
            }
            throw err;
        }
    }

    /**
     * Sanitize and render bubble icon content.
     *
     * Uses DOMPurify (already loaded by rtc-message for Markdown) to strip
     * any script/event-handler attributes, preventing XSS even if the value
     * accidentally contains unsanitized user input.
     */
    private async _sanitizeBubbleIcon(raw: string): Promise<string> {
        try {
            const DOMPurify = await this._loadDOMPurify();
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

        // Dispatch rtc-theme-change when the theme property changes.
        // Fires on both initial attribute set and subsequent mutations.
        if (changed.has('theme')) {
            this.dispatchEvent(new CustomEvent('rtc-theme-change', {
                detail: { theme: this.theme },
                bubbles: true,
                composed: true,
            }));
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
          .showMinimize=${this._resolvedWindowConfig.showMinimize}
          .showMaximize=${this._resolvedWindowConfig.showMaximize}
          @rtc-connection-retry=${this._handleConnectionRetry}
        ></rtc-title-bar>
        ${isLoggedIn
          ? this._renderMainLayout(active, sidebarVisible)
          : html`<div class="content-area"><rtc-login-page theme=${this.theme}></rtc-login-page></div>`}
        <rtc-toast .toasts=${this._toast.toasts}></rtc-toast>
        ${this._isSyncing ? html`
          <div class="syncing-overlay">
            <div class="syncing-content">
              <div class="syncing-spinner"></div>
              <div class="syncing-text">${msg('同步数据中...')}</div>
            </div>
          </div>
        ` : null}
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
              ? html`<rtc-settings-layout theme=${this.theme} .sidebarVisible=${sidebarVisible} version=${version}></rtc-settings-layout>`
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
