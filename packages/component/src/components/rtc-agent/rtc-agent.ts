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
 * - Root syncs controller.value to provider via `updated()` lifecycle
 * - Cross-controller communication (e.g., session switch -> clear messages)
 *   is handled by the root via callbacks
 *
 * Window-state events (rtc-window-{minimize,maximize,restore}) flow from
 * <rtc-title-bar> → <rtc-agent> listener → controller → reflected `data-mode`
 * attribute → CSS :host([data-mode=...]) visual state.
 */
import {LitElement, html} from 'lit';
import {customElement, property, state, query} from 'lit/decorators.js';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import {ContextProvider} from '@lit/context';
import {styles} from './rtc-agent.styles.js';
import type {WindowMode, ContentData, Session} from '../../types/index.js';

// Styles
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';

// Contexts (for provider keys)
import {WindowStateContext} from '../../contexts/window-state.js';
import {AuthContext} from '../../contexts/auth.js';
import {SessionContext} from '../../contexts/session.js';
import {MessageContext} from '../../contexts/message.js';
import {ModeContext} from '../../contexts/mode.js';
import {ToolCallContext} from '../../contexts/tool-call.js';
import {TurnCountContext, DEFAULT_TURN_COUNT} from '../../contexts/turn-count.js';
import {SkillContext, DEFAULT_SKILL_STATE} from '../../contexts/skill.js';

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

// Scenario loading
import {loadScenariosFromURL} from '../../core/scenario-loader.js';
import {defineRegistry} from '../../core/function-registry.js';
import type {FunctionRegistry} from '../../core/function-registry.js';

// Ready signal
import {_markReady} from '../../core/ready.js';

// Declarative config types
import type {AgentConfig, AgentFunctionGroup} from '../../types/agent-config.js';
// Side-effect import: extends HTMLElementEventMap with rtc-agent-ready event
import '../../types/events.js';

// UIUpdateBus (persistence-layer singleton for driving UI refreshes)
import {getUIUpdateBus, RtcProcessor, initializeVirtualFS} from '@rtc-agent/persistence';
import type {LocalRtc} from '@rtc-agent/persistence';

// Tool confirm dialog
import '../overlay/rtc-tool-confirm.js';
// Child component registrations (side-effect imports)
import '../title-bar/rtc-title-bar.js';
import '../content-wrapper/rtc-content-wrapper.js';
import '../login/rtc-login-page.js';
import '../login/rtc-login-dialog.js';
import '../overlay/rtc-toast.js';

// Toast types (re-exported from ToastController)
import type {ToastType} from '../overlay/rtc-toast.js';

// Connection state type
import type {ConnectionState} from '@rtc-agent/client';

// Aria-live announcements per mode transition
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
     * FunctionRegistry 实例（宿主应用注入，高级用法）
     *
     * 设置后自动：
     * 1. 将 registry 注入 SkillController（供 UI 使用）
     * 2. 创建 rtcAgentAPI Proxy 并注入 ToolRegistry（供 script 工具使用）
     *
     * 对于简单场景，推荐使用 `agentConfig` 属性替代（声明式 API）。
     */
    @property({attribute: false})
    set registry(value: FunctionRegistry | null) {
        if (value) {
            this._skill.actions.setRegistry(value);
        }
    }
    get registry(): FunctionRegistry | null {
        return this._skill.actions.getRegistry();
    }

    /**
     * Agent 声明式配置（推荐的宿主集成方式）
     *
     * 设置后组件内部自动：
     * 1. 基于配置构建 FunctionRegistry（含 persona / groups / functions）
     * 2. 将 registry 注入 SkillController
     * 3. 桥接 rtcAgent API 到 ToolRegistry（供 script 工具使用）
     *
     * 宿主应用无需了解 FunctionRegistry / toolRegistry 等内部概念。
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
     * 场景文档 URL（可选）
     *
     * 设置后自动从指定 URL 加载场景文档到 VirtualFS。
     * URL 应指向包含 manifest.json 的目录。
     *
     * @example
     * <rtc-agent scenarios-url="./scenarios/"></rtc-agent>
     */
    @property({type: String, attribute: 'scenarios-url'})
    set scenariosURL(value: string) {
        this._scenariosURL = value;
        if (value) {
            loadScenariosFromURL(value).then(count => {
                console.log(`[rtc-agent] Loaded ${count} scenarios from ${value}`);
            }).catch(err => {
                console.warn(`[rtc-agent] Failed to load scenarios from ${value}:`, err);
            });
        }
    }
    get scenariosURL(): string {
        return this._scenariosURL;
    }
    private _scenariosURL = '';

    /**
     * 基于 AgentConfig 构建 FunctionRegistry（内部使用）
     *
     * 流程：
     * 1. 使用 config.name / description / persona 创建 FunctionRegistry
     * 2. 按 config.groups 依次创建分组并注册函数
     * 3. 若有 config.functions（平铺），自动放入 'default' 分组
     */
    private _buildRegistryFromConfig(config: AgentConfig): FunctionRegistry {
        const registry = defineRegistry({
            name: config.name ?? this.appLabel,
            description: config.description ?? '',
            persona: config.persona ?? '',
            onError: config.onError,
        });

        // 处理分组
        for (const groupConfig of config.groups ?? []) {
            const group = registry.createGroup({
                name: groupConfig.name,
                description: groupConfig.description ?? '',
            });
            for (const fn of groupConfig.functions) {
                group.register(fn);
            }
        }

        // 处理平铺函数（放入 default 分组）
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

    private _windowState = new WindowStateController(this);
    private _auth = new AuthController(this);
    private _persistence = new PersistenceController(this, this._auth);
    private _session = new SessionController(this);
    private _message = new MessageController(this);
    private _mode = new ModeController(this);
    private _toolCall = new ToolCallController(this);
    private _interaction = new WindowInteractionController(this);
    private _skill = new SkillController(this, {
        onToast: (message, type) => this._toast.actions.show(message, type as ToastType),
        onConfirmRequest: (requestId, _path, message) => {
            // 使用 window.confirm 作为简单 UI（SkillController 5 秒后也有 fallback）
            const confirmed = window.confirm(message);
            this._skill.respondToConfirm(requestId, confirmed);
        },
    });
    private _toast = new ToastController(this);
    private _fork = new ForkController(this);

    /* ── Internal State ── */

    /** Mode announcement text for screen readers (updated on mode transition). */
    @state() private _modeAnnouncement = '';

    /** Show login dialog */
    @state() private _showLoginDialog = false;

    /** 连接状态 */
    @state() private _connectionState: ConnectionState = 'disconnected';

    /** 连接状态 unsub 函数 */
    private _unsubConnection?: () => void;

    /** Tracks the last mode we applied DOM side-effects for, to avoid redundant work. */
    private _appliedMode: WindowMode = 'normal';

    /** Tracks whether we've done the initial session load (for auto-select logic). */
    private _initialSessionLoadDone = false;

    /** Bound event handlers (stored so we can remove them in disconnectedCallback). */
    private _boundOnMinimize = () => this._windowState.actions.minimize();
    private _boundOnMaximize = () => this._windowState.actions.maximize();
    private _boundOnRestore = () => this._windowState.actions.restore();
    private _boundOnLoginRequested = () => this._handleLoginRequested();
    private _boundOnNewSession = () => {
        this._fork.actions.clearFork();
        this._message.actions.clearMessages();
    };
    private _boundOnLogout = () => {
        this._fork.actions.clearFork();
        this._rtcProcessor = undefined;
        void this._persistence.disconnect();
        this._session.actions.reset();
        this._message.actions.clearMessages();
    };
    private _boundOnInputSubmit = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        const content: ContentData = {type: 'text', data: detail.content};

        if (this._fork.isActive) {
            // Fork 模式：调用 forkSession
            void this._fork.actions.submitFork(content);
        } else {
            // 普通模式：调用 sendMessage
            void this._message.actions.sendMessage(content);
        }
    };
    private _boundOnForkRequested = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        this._fork.actions.requestFork(detail.oldMessageClientId, detail.content);
    };
    private _boundOnKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this._fork.isActive) {
            this._fork.actions.clearFork();
            this._inputArea?.clearValue();
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
    private _boundOnToastRequested = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        this._toast.actions.show(detail.message, detail.type);
    };

    /** UIUpdateBus unsubscribe reference (set in connectedCallback, cleared in disconnectedCallback). */
    private _busUnsubMessage?: () => void;

    /** RTC 处理器（persistence connect 后实例化） */
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

    /* ── Component References ── */

    /** 获取 rtc-input-area 的引用（穿透 shadow DOM） */
    private get _inputArea(): HTMLElement & { setValue: (v: string) => void; clearValue: () => void } | undefined {
        const wrapper = this.shadowRoot?.querySelector('rtc-content-wrapper');
        return wrapper?.shadowRoot?.querySelector('rtc-input-area') as HTMLElement & { setValue: (v: string) => void; clearValue: () => void } | undefined;
    }

    /** 获取 rtc-notice-bar 的引用（穿透 shadow DOM） */
    private get _noticeBar(): HTMLElement & { message: string } | undefined {
        const wrapper = this.shadowRoot?.querySelector('rtc-content-wrapper');
        return wrapper?.shadowRoot?.querySelector('rtc-notice-bar') as HTMLElement & { message: string } | undefined;
    }

    /* ── Context Providers ── */

    private _sessionProvider = new ContextProvider(this, {context: SessionContext});
    private _messageProvider = new ContextProvider(this, {context: MessageContext});
    private _toolCallProvider = new ContextProvider(this, {context: ToolCallContext});
    private _authProvider = new ContextProvider(this, {context: AuthContext, initialValue: this._auth.value});
    private _modeProvider = new ContextProvider(this, {context: ModeContext});
    private _windowStateProvider = new ContextProvider(this, {context: WindowStateContext});
    private _turnCountProvider = new ContextProvider(this, {context: TurnCountContext, initialValue: DEFAULT_TURN_COUNT});
    private _skillProvider = new ContextProvider(this, {context: SkillContext, initialValue: DEFAULT_SKILL_STATE});

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();

        // Wire ForkController dependencies
        this._fork.setDeps({
            getCurrentSessionId: () => this._session.value.state.currentSessionId,
            clearMessages: () => this._message.actions.clearMessages(),
            setInputValue: (v) => this._inputArea?.setValue(v),
            setNoticeMessage: (msg) => { if (this._noticeBar) this._noticeBar.message = msg; },
            clearNoticeMessage: () => { if (this._noticeBar) this._noticeBar.message = ''; },
            executeFork: (params) => this._message.actions.forkSession(params),
        });

        // Cross-controller wiring: session switch -> reload messages for the new session
        this._session.onSessionSwitch = () => {
            this._fork.actions.clearFork();  // 切换 session 时清理 fork 状态
            void this._message.reload();
            // 切换 session 时立即同步 turn count 到新 session 的值
            void this._refreshTurnCounts();
        };

        // Inject persistence layer and session controller into MessageController
        if (this._persistence.layer) {
            this._message.persistence = this._persistence.layer;
        }
        this._message.sessionController = this._session;

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

        // Listen for fork requested (from user message more menu)
        this.addEventListener('rtc-fork-requested', this._boundOnForkRequested);

        // Listen for toast requested (from various components)
        this.addEventListener('rtc-toast-requested', this._boundOnToastRequested);

        // Listen for Escape key to cancel fork mode
        this.addEventListener('keydown', this._boundOnKeydown);

        // Subscribe to UIUpdateBus for persistence-driven UI refreshes
        const bus = getUIUpdateBus();
        this._busUnsubMessage = bus.subscribe((event) => {
            if (event.entity === 'message') {
                void this._message.reload(event.entityId);
            } else if (event.entity === 'session') {
                // Session update: reload sessions list from DB, but preserve currentSessionId
                void this._loadSessions();
                // Turn count 字段变化 → 把当前 session 的活跃 turn 数量推入 context
                if (
                    event.field === 'pending_turn_count' ||
                    event.field === 'running_turn_count'
                ) {
                    void this._refreshTurnCounts();
                }
            } else if (event.entity === 'rtc') {
                // RTC 更新：触发 RtcProcessor 处理循环
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
        this._interaction.onViewportTooSmall = () => {
            this._windowState.actions.minimize();
        };

        // Reflect initial mode attribute.
        this.setAttribute('data-mode', this._windowState.value.state.mode);

        // If tokens were restored from localStorage (e.g. page refresh),
        // connect persistence layer immediately.
        if (this._auth.state.isLoggedIn) {
            void this._persistence.connect().then(async () => {
                if (this._persistence.layer) {
                    this._message.persistence = this._persistence.layer;

                    // 初始化虚拟文件系统（AGENT.md）
                    await initializeVirtualFS();

                    // 初始化 RTC 处理器并恢复未完成的任务
                    this._rtcProcessor = new RtcProcessor(this._persistence.layer);
                    this._rtcProcessor.setConfirmDialog((rtc) => this._showToolConfirm(rtc));
                    this._rtcProcessor.setMode(this._mode.value.state.currentMode);
                    this._rtcProcessor.onRtcUpdate().catch(err => {
                        console.error('[rtc-agent] onRtcUpdate failed:', err);
                    });
                    // 监听连接状态变化
                    this._setupConnectionListener();
                }
                // Load sessions from DB so the panel isn't empty after refresh
                void this._loadSessions();
            });
        }
    }

    /** 显示工具确认弹窗 */
    private _showToolConfirm(rtc: LocalRtc): Promise<boolean> {
        return new Promise((resolve) => {
            const el = document.createElement('rtc-tool-confirm');
            el.toolCall = {
                id: rtc.client_id,
                toolName: rtc.tool_name,
                parameters: rtc.parameters as Record<string, unknown> | undefined,
                status: 'pending',
            };

            const cleanup = () => {
                el.removeEventListener('rtc-tool-call-approved', onApproved);
                el.removeEventListener('rtc-tool-call-denied', onDenied);
                el.remove();
            };

            const onApproved = () => {
                cleanup();
                resolve(true);
            };

            const onDenied = () => {
                cleanup();
                resolve(false);
            };

            el.addEventListener('rtc-tool-call-approved', onApproved);
            el.addEventListener('rtc-tool-call-denied', onDenied);

            // 添加到 shadowRoot 内，保持样式继承
            this.shadowRoot!.appendChild(el);
        });
    }

    /** 设置连接状态监听 */
    private _setupConnectionListener() {
        this._unsubConnection?.();
        const client = this._persistence.layer?.getClient();
        if (client) {
            this._connectionState = client.getConnectionState();
            this._unsubConnection = client.on('connection', (event) => {
                this._connectionState = event.state;
            });
        }
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
        this.removeEventListener('rtc-fork-requested', this._boundOnForkRequested);
        this.removeEventListener('rtc-toast-requested', this._boundOnToastRequested);
        this.removeEventListener('keydown', this._boundOnKeydown);
        this._busUnsubMessage?.();
        this._rtcProcessor = undefined;
        this._unsubConnection?.();
    }

    updated() {
        // Sync controller values to context providers
        this._sessionProvider.setValue(this._session.value);
        this._messageProvider.setValue(this._message.value);
        this._toolCallProvider.setValue(this._toolCall.value);
        this._authProvider.setValue(this._auth.value);
        this._modeProvider.setValue(this._mode.value);
        this._windowStateProvider.setValue(this._windowState.value);
        this._skillProvider.setValue(this._skill.value);

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
        // Set initial position (bottom-right corner)
        const margin = 20;
        const defaultWidth = parseInt(getComputedStyle(this).getPropertyValue('--rtc-window-default-width')) || 420;
        const defaultHeight = parseInt(getComputedStyle(this).getPropertyValue('--rtc-window-default-height')) || 640;
        const initialX = window.innerWidth - defaultWidth - margin;
        const initialY = window.innerHeight - defaultHeight - margin;
        this._windowState.actions.setPosition({x: initialX, y: initialY});

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

        // Announce to screen readers.
        this._modeAnnouncement = MODE_ANNOUNCEMENTS[mode];
    }

    /* ── Bubble Handlers ── */

    private _handleBubbleClick() {
        this._windowState.actions.restore();
    }

    private _handleBubbleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._windowState.actions.restore();
        }
    }

    /* ── Login Dialog Handlers ── */

    private _handleLoginRequested() {
        this._showLoginDialog = true;
    }

    private _handleLoginComplete(event: CustomEvent) {
        const {accessToken, refreshToken, userId, expiresIn} = event.detail;

        // Call controller.setTokens() directly (not via Context)
        this._auth.setTokens({
            accessToken,
            refreshToken,
            userId,
            expiresIn,
        });

        // Connect persistence layer (WebSocket + IndexedDB) and inject into MessageController
        void this._persistence.connect().then(async () => {
            if (this._persistence.layer) {
                this._message.persistence = this._persistence.layer;

                // 初始化虚拟文件系统（AGENT.md）
                await initializeVirtualFS();

                // 初始化 RTC 处理器
                this._rtcProcessor = new RtcProcessor(this._persistence.layer);
                this._rtcProcessor.setConfirmDialog((rtc) => this._showToolConfirm(rtc));
                this._rtcProcessor.setMode(this._mode.value.state.currentMode);
                void this._rtcProcessor.onRtcUpdate();

                // 监听连接状态变化
                this._setupConnectionListener();
            }
            // Load sessions from DB so the panel isn't empty after login
            void this._loadSessions();
        });

        this._showLoginDialog = false;
    }

    private _handleLoginDialogClose() {
        this._showLoginDialog = false;
    }

    /* ── Session & Turn Count ── */

    /**
     * 从 persistence 层读取当前 session 的 pending_turn_count / running_turn_count，
     * 写入 TurnCountContext，供 <rtc-input-area> 渲染 send/stop 按钮。
     *
     * 没有 currentSessionId 或 persistence 未就绪时，推送零值。
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
     * Load sessions list from persistence and sync into SessionController.
     * On initial load (after refresh), auto-selects the most recently updated session if none selected.
     */
    private async _loadSessions() {
        if (!this._persistence.layer) return;

        const sessions = await this._persistence.layer.listSessions();
        const uiSessions: Session[] = sessions.map(s => ({
            clientId: s.client_id,
            title: s.title || '',
            createdAt: new Date(s.created_at).getTime(),
            updatedAt: new Date(s.updated_at).getTime(),
        }));
        this._session.actions.setSessions(uiSessions);

        // Auto-select most recent session on initial load only (e.g. after refresh)
        // Don't auto-select on subsequent session updates (user may have clicked + to clear selection)
        if (!this._initialSessionLoadDone) {
            this._initialSessionLoadDone = true;
            if (!this._session.value.state.currentSessionId && uiSessions.length > 0) {
                const mostRecent = uiSessions.reduce((a, b) =>
                    a.updatedAt > b.updatedAt ? a : b
                );
                this._session.actions.switchSession(mostRecent.clientId);
            }
        }
    }

    /* ── Render ── */

    private _renderBubbleContent() {
        if (this.bubbleIcon) {
            return html`<span class="bubble-icon">${unsafeHTML(this.bubbleIcon)}</span>`;
        }
        const letter = this.appLabel.trim()[0]?.toUpperCase() ?? 'R';
        return html`<span class="bubble-label">${letter}</span>`;
    }

    render() {
        const isLoggedIn = this._auth.value.state.isLoggedIn;
        const mode = this._windowState.value.state.mode;

        return html`
      <div class="window-container">
        <rtc-title-bar
          app-label=${this.appLabel}
          .windowMode=${mode}
          .connectionState=${this._connectionState}
        ></rtc-title-bar>
        <div class="content-area">
          ${isLoggedIn
            ? html`<rtc-content-wrapper></rtc-content-wrapper>`
            : html`<rtc-login-page></rtc-login-page>`}
        </div>
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
            @rtc-login-complete=${this._handleLoginComplete}
            @rtc-login-dialog-close=${this._handleLoginDialogClose}
          ></rtc-login-dialog>`
        : null}
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-agent': RtcAgent;
    }
}
