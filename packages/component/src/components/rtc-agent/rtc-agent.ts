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
 * - Root syncs controller.value to provider via `updated()` lifecycle
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
import type {WindowMode, ContentData, Session, SessionStatus, Activity, FileNode} from '../../types/index.js';

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
import {getUIUpdateBus, RtcProcessor, virtualFS} from '@rtc-agent/persistence';
import type {LocalRtc} from '@rtc-agent/persistence';

// Tool confirm dialog
import '../overlay/rtc-tool-confirm.js';
import '../overlay/rtc-ask-user.js';
// Child component registrations (side-effect imports)
import '../title-bar/rtc-title-bar.js';
import '../content-wrapper/rtc-content-wrapper.js';
import '../login/rtc-login-page.js';
import '../login/rtc-login-dialog.js';
import '../overlay/rtc-toast.js';

// VS Code 风格布局组件（Phase 3）
import '../activity-bar/rtc-activity-bar.js';
import '../file-explorer/rtc-file-explorer.js';
import '../editor-area/rtc-editor-area.js';
import '../status-bar/rtc-status-bar.js';

// Chat Layout 组件（对话页面改造）
import '../chat-layout/rtc-chat-layout.js';

// Settings Layout 组件
import '../settings-layout/rtc-settings-layout.js';

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
            console.log('[rtc-agent] registry setter called, isConnected:', this._persistence.isConnected);
            this._skill.actions.setRegistry(value);

            // 如果 persistence 已连接（数据库就绪），立即生成文档
            // 解决时序问题：connectedCallback() 可能在 registry 设置前就运行
            if (this._persistence.isConnected && this._persistence.layer) {
                void this._regenerateDocsAfterRegistrySet();
            }
        }
    }
    get registry(): FunctionRegistry | null {
        return this._skill.actions.getRegistry();
    }

    /**
     * registry 属性设置后生成文档
     *
     * 解决时序问题：connectedCallback() 可能在 registry 注入前就完成 connect()，
     * 此时 generateAllDocsContent() 返回空数组。当 registry 稍后被设置时，
     * 需要重新生成文档。
     */
    private async _regenerateDocsAfterRegistrySet(): Promise<void> {
        const registry = this._skill.actions.getRegistry();
        if (!registry) return;

        try {
            const files = registry.generateAllDocsContent(0);
            await this._persistence.workerBridge!.core.batchWriteFiles(files);

            // 如果 scenariosURL 已设置但 scenarios 还未加载，现在加载
            if (this._scenariosURL) {
                await this._loadScenarios(this._scenariosURL);
            }
        } catch (err) {
            console.warn('[rtc-agent] Failed to regenerate docs after registry set:', err);
        }
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
            // 如果 persistence 已连接，立即加载 scenarios
            if (this._persistence.isConnected && this._persistence.layer) {
                void this._loadScenarios(value);
            }
            // 否则 scenariosURL 会被 _scenariosURL 保存，
            // 在 connectedCallback 或 registry setter 中后续加载
        }
    }
    get scenariosURL(): string {
        return this._scenariosURL;
    }
    private _scenariosURL = '';

    /**
     * 窗口配置（可选）
     *
     * 控制窗口的默认状态、尺寸、位置、交互限制等。
     *
     * @example
     * ```ts
     * agent.windowConfig = {
     *   defaultMode: 'maximized',
     *   embedded: true,  // 禁用所有窗口交互
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

        // 更新控制器配置
        this._windowState.setConfig(resolved);
        this._interaction.setConfig({
            draggable: resolved.draggable,
            resizable: resolved.resizable,
        });

        // 触发重新渲染
        this.requestUpdate();
    }
    get windowConfig(): WindowConfig | null {
        return this._windowConfig;
    }
    private _windowConfig: WindowConfig | null = null;

    /**
     * Activity Bar 配置（可选）
     *
     * 控制 Activity Bar 中各活动按钮的显隐。
     * 注意：chat 按钮始终显示，不可隐藏。
     *
     * @example
     * ```ts
     * agent.activityBarConfig = {
     *   disabledActivities: ['files', 'settings'],  // 只显示 chat
     *   defaultActivity: 'chat',
     * };
     * ```
     */
    @property({attribute: false})
    set activityBarConfig(value: ActivityBarConfig | null) {
        this._activityBarConfig = value;
        this._resolvedActivityBarConfig = resolveActivityBarConfig(value ?? undefined);

        // 如果当前活动被禁用，切换到默认活动
        const disabled = this._resolvedActivityBarConfig.disabledActivities;
        if (disabled.includes(this._activity.active as 'files' | 'settings')) {
            this._activity.actions.setActivity(this._resolvedActivityBarConfig.defaultActivity);
        }

        // 触发重新渲染
        this.requestUpdate();
    }
    get activityBarConfig(): ActivityBarConfig | null {
        return this._activityBarConfig;
    }
    private _activityBarConfig: ActivityBarConfig | null = null;
    private _resolvedActivityBarConfig: ResolvedActivityBarConfig = resolveActivityBarConfig();

    /**
     * 加载 scenarios 到 VirtualFS
     *
     * 通过 WorkerBridge 写入 Worker 内的 VirtualFS
     */
    private async _loadScenarios(baseURL: string): Promise<void> {
        const files = await loadScenariosContent(baseURL);
        await this._persistence.workerBridge!.core.batchWriteFiles(files);
        console.log(`[rtc-agent] Loaded ${files.length} scenarios from ${baseURL}`);
    }

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

    /** 解析后的窗口配置 */
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
            // 使用 window.confirm 作为简单 UI（SkillController 5 秒后也有 fallback）
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

    /** 文件树是否已加载过（首次进入 files 活动时加载一次） */
    private _fileTreeLoaded = false;

    /* ── Internal State ── */

    /** Mode announcement text for screen readers (updated on mode transition). */
    @state() private _modeAnnouncement = '';

    /** Show login dialog */
    @state() private _showLoginDialog = false;

    /** Selected OAuth2 provider for login dialog */
    @state() private _selectedProvider = 'mock';

    /** 连接状态 */
    @state() private _connectionState: ConnectionState = 'disconnected';

    /** 连接状态 unsub 函数 */
    private _unsubConnection?: () => void;

    /** 连接是否失败（用于显示重试按钮） */
    @state() private _connectionFailed = false;

    /** 连接失败时的错误信息 */
    @state() private _connectionError = '';

    /** Tracks the last mode we applied DOM side-effects for, to avoid redundant work. */
    private _appliedMode: WindowMode = 'normal';

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
        // 不清空消息：_handleNewSession 已通过 createSession() 创建了新 session
        // 并切换了 currentSessionId，消息列表已由 reload() 设为空（新 session 无消息）
        // 仅在 legacy 场景（关闭最后一个 Tab 后发消息）需要清空，但此时 currentSessionId 为 null
        if (!this._session.value.state.currentSessionId) {
            this._message.actions.clearMessages();
        }
    };
    private _boundOnLogout = () => {
        // 清理自动保存定时器
        for (const timer of this._autoSaveTimers.values()) {
            clearTimeout(timer);
        }
        this._autoSaveTimers.clear();

        // 重置状态标志，确保重新登录后重新加载
        this._fileTreeLoaded = false;
        this._initialSessionLoadDone = false;

        // 重置 UI 状态
        this._editorArea.actions.closeAll();
        this._sessionTab.actions.clearAll();
        this._activity.actions.setActivity('chat');

        // 清理现有状态
        this._fork.actions.clearFork();
        this._rtcProcessor = undefined;
        void this._persistence.disconnect();
        this._session.actions.reset();
        this._message.actions.clearMessages();
    };
    private _boundOnInputSubmit = async (e: Event) => {
        const detail = (e as CustomEvent).detail;
        // 直接使用 rtc-input-area 传来的 contentData
        const content: ContentData = detail.contentData;

        try {
            if (this._fork.isActive) {
                // Fork 模式：调用 forkSession
                await this._fork.actions.submitFork(content);
            } else {
                // 普通模式：调用 sendMessage
                await this._message.actions.sendMessage(content);
            }

            // 发送成功后，把当前 unsaved tab 晋升为 saved
            const currentId = this._session.value.state.currentSessionId;
            if (currentId) {
                this._sessionTab.actions.markSaved(currentId);
            }
        } catch (err) {
            console.error('[rtc-agent] message submit failed:', err);
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
            this._inputArea?.clearValue();
            return;
        }

        // 全局快捷键（仅 files 模式下生效）
        if (this._activity.active !== 'files') return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;

        if (e.key === 's' || e.key === 'S') {
            // Ctrl/⌘+S：保存当前文件
            const activePath = this._editorArea.state.activeFilePath;
            if (activePath) {
                e.preventDefault();
                void this._handleEditorSave(activePath);
            }
        } else if (e.key === 'w' || e.key === 'W') {
            // Ctrl/⌘+W：关闭当前标签
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
        console.log('[rtc-agent] session delete requested:', sessionId);
        // 确认弹窗
        // const current = this._session.value.state.sessions.find(s => s.clientId === sessionId);
        // const title = current?.title ?? '此会话';
        // const confirmed = confirm(`确定要删除「${title}」吗？删除后可从服务端恢复。`);
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
        // 简单 prompt 交互：生产环境可替换为内联编辑或模态框
        const current = this._session.value.state.sessions.find(s => s.clientId === sessionId);
        const title = prompt('重命名会话', current?.title ?? '');
        if (title === null) return; // 用户取消
        if (!title.trim()) {
            this._toast.actions.show(msg('标题不能为空'), 'info');
            return;
        }
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
            // 点击当前活动 → toggle sidebar
            this._activity.actions.toggleSidebar();
        } else {
            // 切换到不同活动
            this._activity.actions.setActivity(activity);
            // 首次进入 files 活动时加载文件树
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
        // 如果是展开状态且尚未加载子节点，触发懒加载
        // 注意：toggleNode 已经在 file-tree-item 中调用，这里不再重复调用
        if (this._fileExplorer.value.isExpanded(path)) {
            console.log('[rtc-agent] _boundOnFolderToggle: loading children for', path);
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
        // ChatLayout 内部已调用 switchSession，此处仅作日志/扩展点
        const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
        console.log('[rtc-agent] chat-layout session selected:', sessionId);
    };
    private _boundOnChatLayoutTabActivate = (e: Event) => {
        const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
        console.log('[rtc-agent] chat-layout tab activated:', sessionId);
    };
    private _boundOnChatLayoutTabClose = (e: Event) => {
        const {sessionId} = (e as CustomEvent).detail as {sessionId: string};
        console.log('[rtc-agent] chat-layout tab closed:', sessionId);
    };

    /**
     * Wheel event handler to prevent scroll chaining to host page.
     *
     * When a scrollable container inside the shadow DOM reaches its boundary
     * (top or bottom), continuing to scroll would propagate the wheel event
     * to the host page, causing it to scroll. This handler detects when the
     * innermost scrollable element is at its boundary and prevents the event
     * from propagating further.
     */
    private _boundOnWheel = (e: WheelEvent) => {
        const target = e.composedPath()[0] as Element;
        const scrollable = this._findScrollableParent(target);

        if (!scrollable) return;

        const {scrollTop, scrollHeight, clientHeight} = scrollable;
        const atTop = scrollTop <= 0;
        const atBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight;

        const scrollingUp = e.deltaY < 0;
        const scrollingDown = e.deltaY > 0;

        // If at boundary and continuing to scroll in that direction, prevent propagation
        if ((atTop && scrollingUp) || (atBottom && scrollingDown)) {
            e.preventDefault();
            e.stopPropagation();
        }
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
    get activityController() { return this._activity; }
    get fileExplorerController() { return this._fileExplorer; }
    get editorAreaController() { return this._editorArea; }
    get statusBarController() { return this._statusBar; }
    get sessionTreeController() { return this._sessionTree; }
    get sessionTabController() { return this._sessionTab; }
    get notificationController() { return this._notification; }

    /* ── Public Methods ── */

    /**
     * 连接失败时手动重连
     *
     * 当 SharedWorker 初始化失败或 WebSocket 连接无法建立时，
     * 可以调用此方法尝试重新连接。
     */
    async reconnect(): Promise<void> {
        if (this._persistence.isConnected) {
            console.warn('[rtc-agent] Already connected');
            return;
        }
        await this._connectWithRetry();
    }

    /**
     * 连接是否失败
     *
     * 用于 UI 组件显示重试按钮或错误信息。
     */
    get connectionFailed(): boolean {
        return this._connectionFailed;
    }

    /**
     * 连接失败的错误信息
     */
    get connectionError(): string {
        return this._connectionError;
    }

    /* ── Component References ── */

    /** 获取 rtc-input-area 的引用（穿透 shadow DOM） */
    private get _inputArea(): HTMLElement & { setValue: (v: string) => void; clearValue: () => void } | undefined {
        // Chat 模式：rtc-chat-layout > .content-area > rtc-input-area
        const chatLayout = this.shadowRoot?.querySelector('rtc-chat-layout');
        const inputArea = chatLayout?.shadowRoot?.querySelector('rtc-input-area');
        if (inputArea) {
            return inputArea as HTMLElement & { setValue: (v: string) => void; clearValue: () => void };
        }
        // Legacy fallback: rtc-content-wrapper > rtc-input-area
        const wrapper = this.shadowRoot?.querySelector('rtc-content-wrapper');
        return wrapper?.shadowRoot?.querySelector('rtc-input-area') as HTMLElement & { setValue: (v: string) => void; clearValue: () => void } | undefined;
    }

    /** 获取 rtc-notice-bar 的引用（穿透 shadow DOM） */
    private get _noticeBar(): HTMLElement & { message: string } | undefined {
        // Chat 模式：rtc-chat-layout > .content-area > rtc-notice-bar
        const chatLayout = this.shadowRoot?.querySelector('rtc-chat-layout');
        const noticeBar = chatLayout?.shadowRoot?.querySelector('rtc-notice-bar');
        if (noticeBar) {
            return noticeBar as HTMLElement & { message: string };
        }
        // Legacy fallback: rtc-content-wrapper > rtc-notice-bar
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
    private _activityProvider = new ContextProvider(this, {context: ActivityContext});
    private _fileExplorerProvider = new ContextProvider(this, {context: FileExplorerContext});
    private _sessionTreeProvider = new ContextProvider(this, {context: SessionTreeContext});
    private _sessionTabProvider = new ContextProvider(this, {context: SessionTabContext});
    private _settingsProvider = new ContextProvider(this, {context: SettingsContext});
    private _notificationProvider = new ContextProvider(this, {context: NotificationContext});
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
            setInputValue: (v) => this._inputArea?.setValue(v),
            setNoticeMessage: (msg) => { if (this._noticeBar) this._noticeBar.message = msg; },
            clearNoticeMessage: () => { if (this._noticeBar) this._noticeBar.message = ''; },
            executeFork: (params) => this._message.actions.forkSession(params),
        });

        // Cross-controller wiring: session switch -> reload messages for the new session
        this._session.onSessionSwitch = () => {
            console.log('[rtc-agent.onSessionSwitch] currentSessionId:', this._session.value.state.currentSessionId);
            this._fork.actions.clearFork();  // 切换 session 时清理 fork 状态
            if (this._session.value.state.currentSessionId) {
                console.log('[rtc-agent.onSessionSwitch] Calling message.reload()');
                void this._message.reload();
            } else {
                // currentSessionId 为 null（如关闭最后一个 Tab）→ 清空消息
                console.log('[rtc-agent.onSessionSwitch] Clearing messages (no current session)');
                this._message.actions.clearMessages();
            }
            // 切换 session 时立即同步 turn count 到新 session 的值
            void this._refreshTurnCounts();
        };

        // Inject persistence layer and session controller into MessageController
        if (this._persistence.layer) {
            this._message.persistence = this._persistence.layer;
            // 注入 persistence 到 SessionController（用于 rename/delete 持久化）
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

        // Listen for fork initiated (from chat-layout after unsaved tab orchestration)
        this.addEventListener('rtc-fork-initiated', this._boundOnForkInitiated);

        // Listen for toast requested (from various components)
        this.addEventListener('rtc-toast-requested', this._boundOnToastRequested);

        // Listen for toast close (from toast component)
        this.addEventListener('rtc-toast-close', this._boundOnToastClose);

        // Listen for command requested (from input area slash commands)
        this.addEventListener('rtc-command-requested', this._boundOnCommandRequested);

        // Listen for VS Code 风格布局事件（Phase 3）
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

        // Chat Layout 事件
        this.addEventListener('rtc-chat-layout-session-select', this._boundOnChatLayoutSessionSelect);
        this.addEventListener('rtc-chat-layout-tab-activate', this._boundOnChatLayoutTabActivate);
        this.addEventListener('rtc-chat-layout-tab-close', this._boundOnChatLayoutTabClose);

        // Listen for Escape key to cancel fork mode
        this.addEventListener('keydown', this._boundOnKeydown);

        // Prevent scroll chaining: when inner scrollable reaches boundary,
        // don't propagate wheel event to host page
        this.addEventListener('wheel', this._boundOnWheel, {passive: false});

        // Subscribe to UIUpdateBus for persistence-driven UI refreshes
        const bus = getUIUpdateBus();
        this._busUnsubMessage = bus.subscribe((event) => {
            console.log('[rtc-agent] UIUpdateBus event:', event.entity, event.field, event.entityId);
            if (event.entity === 'message') {
                void this._message.reload(event.entityId);
            } else if (event.entity === 'session') {
                // Session update: reload sessions list from DB, but preserve currentSessionId
                console.log('[rtc-agent] session update detected, calling _loadSessions');
                void this._loadSessions();
                // status 变动 → 同步到 SessionTab（active/idle/closed 切换驱动 dot 动画）
                if (event.field === 'status') {
                    const newStatus = event.newValue as SessionStatus | undefined;
                    if (newStatus) {
                        this._sessionTab.actions.updateTabStatus(event.entityId, newStatus);
                    }
                }
                // todo_list 变动 → 插入本地 markdown 消息，让对话流展示 todo 历史
                // if (event.field === 'todo_list') {
                //     const newTodoList = event.newValue as TodoItem[] | undefined;
                //     if (newTodoList?.length) {
                //         const markdown = this._formatTodoListAsMarkdown(newTodoList);
                //         void this._insertTodoListMessage(event.entityId, markdown);
                //     }
                // }
                // Turn count 字段变化 → 把当前 session 的活跃 turn 数量推入 context
                if (
                    event.field === 'pending_turn_count' ||
                    event.field === 'running_turn_count'
                ) {
                    void this._refreshTurnCounts();
                }
            } else if (event.entity === 'rtc') {
                // RTC 更新：仅 Master Tab 触发 RtcProcessor 处理循环
                // masterLock 存在且 isMaster=false 时跳过
                if (this._persistence.masterLock?.isMaster === false) {
                    return;
                }
                this._rtcProcessor?.onRtcUpdate();
            } else if (event.entity === 'file') {
                // VFS 文件变更（来自其他标签页的写入/删除）
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

        // If tokens were restored from localStorage (e.g. page refresh),
        // connect persistence layer immediately.
        if (this._auth.state.isLoggedIn) {
            void this._connectWithRetry();
        }
    }

    /**
     * 连接 persistence 层，带错误处理和重试
     *
     * 如果连接失败，会设置 _connectionFailed 状态，
     * 用户可以在 UI 中看到错误信息并手动重试。
     */
    private async _connectWithRetry(): Promise<void> {
        this._connectionFailed = false;
        this._connectionError = '';

        try {
            await this._persistence.connect();

            if (this._persistence.layer) {
                this._message.persistence = this._persistence.layer;
                this._session.persistence = this._persistence.layer;
                this._notification.persistence = this._persistence.layer;

                // 注：AGENT.md 由 FunctionRegistry.generateAllDocsContent() 首次写入（含 persona），
                // 不再调用 initializeVirtualFS() 写入默认 AGENT.md，
                // 否则后续的 batchWriteFiles 因 'create-new' 模式无法覆盖默认文件。

                // 如果恢复后活动是 'files'，自动加载文件树
                // （正常流程中文件树在 activity-change 事件中按需加载，
                //  但刷新后不会触发 activity-change，需要手动触发一次）
                if (this._activity.active === 'files' && !this._fileTreeLoaded) {
                    await this._loadFileTree();
                }

                // 刷新后恢复 Editor Area 已打开文件的内容
                // （tab 元数据在 EditorAreaController 构造时已从 localStorage 恢复，
                //  这里从 VFS 重新加载每个 tab 的文件内容）
                await this._restoreEditorAreaContent();

                // 主线程生成文档内容，通过 batchWriteFiles 发送到 Worker
                const registry = this._skill.actions.getRegistry();
                console.log('[rtc-agent] After connect, registry:', registry ? 'set' : 'null');
                if (registry && typeof registry.generateAllDocsContent === 'function') {
                    const files = registry.generateAllDocsContent(0);
                    if (files.length > 0) {
                        await this._persistence.workerBridge!.core.batchWriteFiles(files);
                        console.log('[rtc-agent] batchWriteFiles completed');
                    }
                }

                // 重新加载 scenarios（如果在数据库初始化前设置过 scenariosURL）
                if (this._scenariosURL) {
                    try {
                        const files = await loadScenariosContent(this._scenariosURL);
                        await this._persistence.workerBridge!.core.batchWriteFiles(files);
                        console.log(`[rtc-agent] Re-loaded ${files.length} scenarios from ${this._scenariosURL}`);
                    } catch (err) {
                        console.warn(`[rtc-agent] Failed to re-load scenarios from ${this._scenariosURL}:`, err);
                    }
                }

                // 初始化 RTC 处理器并恢复未完成的任务
                await this._initRtcProcessor();

                // 监听连接状态变化
                this._setupConnectionListener();
            }
            // Load sessions from DB so the panel isn't empty after refresh
            void this._loadSessions();
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error('[rtc-agent] Connection failed:', errorMessage);
            this._connectionFailed = true;
            this._connectionError = errorMessage;

            // 显示错误 Toast
            this._toast.actions.show(
                msg(`连接失败: ${errorMessage}`),
                'error'
            );
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

    /**
     * 显示 AskUser 多选对话框
     *
     * 返回用户答案 dict（{answers, annotations?, metadata?}）或 null 表示拒绝。
     */
    private _showAskUser(rtc: LocalRtc): Promise<{
        answers: Record<string, string>;
        annotations?: Record<string, { preview?: string; notes?: string }>;
        metadata?: { source?: string };
    } | null> {
        return new Promise((resolve) => {
            const el = document.createElement('rtc-ask-user');
            el.rtc = rtc;

            const cleanup = () => {
                el.removeEventListener('rtc-ask-user-submit', onSubmit);
                el.removeEventListener('rtc-ask-user-dismiss', onDismiss);
                el.remove();
            };

            const onSubmit = (e: Event) => {
                const detail = (e as CustomEvent).detail as {
                    clientId: string;
                    payload: {
                        answers: Record<string, string>;
                        annotations?: Record<string, { preview?: string; notes?: string }>;
                        metadata?: { source?: string };
                    };
                };
                cleanup();
                resolve(detail.payload);
            };

            const onDismiss = () => {
                cleanup();
                resolve(null);
            };

            el.addEventListener('rtc-ask-user-submit', onSubmit);
            el.addEventListener('rtc-ask-user-dismiss', onDismiss);

            this.shadowRoot!.appendChild(el);
        });
    }

    /**
     * 设置连接状态监听
     *
     * 通过 PersistenceController.onConnectionStateChange 获取连接状态变更事件。
     */
    private async _setupConnectionListener() {
        this._unsubConnection?.();

        // 使用统一接口获取初始连接状态
        this._connectionState = await this._persistence.getConnectionState();

        // 使用统一接口监听连接状态变更
        this._unsubConnection = this._persistence.onConnectionStateChange((event) => {
            this._connectionState = event.state;
        });
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
        this.removeEventListener('keydown', this._boundOnKeydown);
        this.removeEventListener('wheel', this._boundOnWheel);
        this._busUnsubMessage?.();
        this._rtcProcessor = undefined;
        this._unsubConnection?.();

        // Clear all auto-save timers
        for (const timer of this._autoSaveTimers.values()) {
            clearTimeout(timer);
        }
        this._autoSaveTimers.clear();
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
     * 处理用户点击重试按钮
     *
     * 当 SharedWorker 初始化失败或 WebSocket 连接无法建立时，
     * 用户可以在 title bar 中点击重试按钮触发此方法。
     */
    private _handleConnectionRetry() {
        console.log('[rtc-agent] Connection retry requested by user');
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

        // 从最小化恢复时，清除通知动画和未读计数
        if (this._appliedMode === 'minimized' && mode !== 'minimized') {
            this._notification.actions.markAsRead();
        }

        // Announce to screen readers.
        this._modeAnnouncement = MODE_ANNOUNCEMENTS[mode];
    }

    /* ── Bubble Handlers ── */

    private _handleBubbleClick() {
        this._windowState.actions.restore();
        // 恢复窗口时清除通知动画和未读计数
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

            if ((overflowY === 'auto' || overflowY === 'scroll') &&
                current.scrollHeight > current.clientHeight) {
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
        this._auth.setTokens({
            accessToken,
            refreshToken,
            userId,
            expiresIn,
        });

        // Connect persistence layer (WebSocket + IndexedDB) and inject into MessageController
        void this._connectWithRetry();

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
    /**
     * 将 TodoItem[] 格式化为 markdown checkbox 列表
     */
    // private _formatTodoListAsMarkdown(todoList: TodoItem[]): string {
    //     return todoList.map(item => {
    //         const checkbox = item.status === 'completed' ? '[x]' :
    //                          item.status === 'in_progress' ? '[~]' : '[ ]';
    //         return `- ${checkbox} ${item.content}`;
    //     }).join('\n');
    // }

    /**
     * 插入 todo_list 变动的本地消息到对话中
     */
    // private async _insertTodoListMessage(sessionClientId: string, markdown: string): Promise<void> {
    //     try {
    //         const layer = this._persistence.layer;
    //         if (!layer) return;
    //
    //         await layer.insertLocalMessage({
    //             sessionClientId,
    //             role: 'assistant',
    //             content: JSON.stringify({type: 'markdown', data: markdown}),
    //             creatorKind: 'system',
    //             creatorRefId: 'todo_list_update',
    //         });
    //     } catch (err) {
    //         console.error('[rtc-agent] Failed to insert todo_list message:', err);
    //     }
    // }

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
        console.log('[rtc-agent._loadSessions] Loaded sessions from DB:', sessions.length);
        sessions.forEach(s => console.log(`  - ${s.client_id}: title="${s.title || ''}", root=${s.root_client_session_id || 'null'}`));

        const uiSessions: Session[] = sessions.map(s => ({
            clientId: s.client_id,
            deviceId: s.device_id,
            title: s.title || '',
            createdAt: new Date(s.created_at).getTime(),
            updatedAt: new Date(s.updated_at).getTime(),
            todoList: s.todo_list,
            rootClientSessionId: s.root_client_session_id,
            status: s.status as SessionStatus | undefined,
            // Token 用量字段（后端 session.updated 推送后自动填充）
            totalInputTokens: s.total_input_tokens,
            totalOutputTokens: s.total_output_tokens,
            totalTokens: s.total_tokens,
            totalCachedReadTokens: s.total_cached_read_tokens,
            totalCachedWriteTokens: s.total_cached_write_tokens,
            totalReasoningTokens: s.total_reasoning_tokens,
            totalCostUsd: s.total_cost_usd,
            lastTokenUpdateAt: s.last_token_update_at,
            // Token 预估字段（后端实时计算，通过 session.updated 推送）
            compressionThreshold: s.compression_threshold,
            compressionProgress: s.compression_progress,
            roundsUntilCompression: s.rounds_until_compression,
            estimatedNextRoundTokens: s.estimated_next_round_tokens,
        }));
        this._session.actions.setSessions(uiSessions);

        // 同步到 SessionTreeController（构建层级树）
        this._sessionTree.actions.rebuildTree(uiSessions);

        // 过滤无效的 Tab（session 已被删除的从持久化中清理）
        const validIds = new Set(uiSessions.map(s => s.clientId));
        const hadInvalidTabs = this._sessionTab.filterInvalidTabs(validIds);
        console.log('[rtc-agent._loadSessions] filterInvalidTabs:', hadInvalidTabs ? 'removed some' : 'none removed');
        console.log('[rtc-agent._loadSessions] Tabs after filter:', this._sessionTab.value.state.tabs.map(t => `${t.sessionId}="${t.title}"`));
        console.log('[rtc-agent._loadSessions] activeSessionId:', this._sessionTab.value.state.activeSessionId);

        // 同步 SessionController.currentSessionId 与 Tab 的 activeSessionId
        // 当活动 Tab 被过滤掉时，需要切换 session 以触发消息清理
        const newActiveId = this._sessionTab.value.state.activeSessionId;
        const currentId = this._session.value.state.currentSessionId;
        if (currentId !== newActiveId) {
            console.log('[rtc-agent._loadSessions] Syncing currentSessionId:', currentId, '->', newActiveId);
            if (newActiveId) {
                this._session.actions.switchSession(newActiveId);
            } else {
                this._session.actions.clearCurrentSession();
            }
        }

        // 用 sessions 中的最新标题同步已有 Tab 的标题
        // 修复：新建会话发送消息时 Tab 以空标题创建，server 返回真实标题后需同步更新
        const titleMap = new Map(uiSessions.map(s => [s.clientId, s.title]));
        const titlesUpdated = this._sessionTab.updateTabTitles(titleMap);
        console.log('[rtc-agent._loadSessions] updateTabTitles:', titlesUpdated ? 'updated' : 'no change');
        console.log('[rtc-agent._loadSessions] Tabs after title sync:', this._sessionTab.value.state.tabs.map(t => `${t.sessionId}="${t.title}"`));

        // 用 sessions 中的最新 status 同步已有 Tab 的 status（驱动 status dot 显示）
        const statusMap = new Map(
            uiSessions.filter(s => s.status).map(s => [s.clientId, s.status!])
        );
        if (statusMap.size > 0) {
            this._sessionTab.actions.syncTabStatuses(statusMap);
        }

        // Auto-select on initial load only (e.g. after refresh)
        // Don't auto-select on subsequent session updates (user may have clicked + to clear selection)
        // Only auto-select if there are open tabs (avoid selecting session when all tabs were closed)
        if (!this._initialSessionLoadDone) {
            this._initialSessionLoadDone = true;
            const hasOpenTabs = this._sessionTab.value.state.tabs.length > 0;
            console.log('[rtc-agent._loadSessions] Initial load: hasOpenTabs=', hasOpenTabs, 'currentSessionId=', this._session.value.state.currentSessionId);
            if (hasOpenTabs && !this._session.value.state.currentSessionId) {
                // 优先恢复 Tab 栏的活动 tab（即使其 session 不在 DB，如 unsaved tab）
                // 其次选择最近更新的 session（仅在无活动 tab 时）
                const activeTabId = this._sessionTab.value.state.activeSessionId;
                const targetId = activeTabId
                    ?? (uiSessions.length > 0
                        ? uiSessions.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b).clientId
                        : null);
                if (targetId) {
                    console.log('[rtc-agent._loadSessions] Auto-selecting session:', targetId, '(from activeTabId:', activeTabId, ')');
                    this._session.actions.switchSession(targetId);
                }
            }
        }
    }

    /* ── Slash 命令处理 ── */

    /**
     * 处理 slash 命令
     *
     * 当前支持的命令：
     * - /compact [custom_instruction]：压缩当前会话上下文
     */
    private async _handleCommand(name: string, args?: string): Promise<void> {
        switch (name) {
            case 'compact':
                await this._handleCompactCommand(args);
                break;
            default:
                this._toast.actions.show(`未知命令: /${name}`, 'error');
                break;
        }
    }

    /**
     * 处理 /compact 命令
     *
     * 调用服务端 RPC 压缩当前会话上下文。
     * 成功后不立即显示成功 Toast（等待 Live 推送更新 session 状态）。
     * 失败时显示错误 Toast。
     */
    private async _handleCompactCommand(customInstruction?: string): Promise<void> {
        const sessionId = this._session.value.state.currentSessionId;
        if (!sessionId) {
            this._toast.actions.show(msg('没有活动的会话'), 'error');
            return;
        }

        if (!this._persistence.layer) {
            this._toast.actions.show(msg('服务未连接'), 'error');
            return;
        }

        this._toast.actions.show(msg('正在压缩上下文...'), 'info');

        try {
            await this._persistence.layer.compactSession(sessionId, customInstruction);
            // 成功：不立即显示成功 Toast，等待 Live 推送 session 更新
        } catch (err) {
            console.error('[rtc-agent] /compact failed:', err);
            const message = err instanceof Error ? err.message : msg('压缩上下文失败');
            this._toast.actions.show(message, 'error');
        }
    }

    /* ── RTC 处理器初始化 ── */

    /**
     * 初始化 RTC 处理器并恢复未完成的任务
     *
     * 抽取为私有方法，避免 connectedCallback 与 _handleLoginComplete 重复。
     * 自动注入 MasterLock，并在升级为 Master 时触发 processLoop。
     */
    private async _initRtcProcessor(): Promise<void> {
        if (!this._persistence.layer) return;

        this._rtcProcessor = new RtcProcessor(this._persistence.layer);
        this._rtcProcessor.setConfirmDialog((rtc) => this._showToolConfirm(rtc));
        this._rtcProcessor.setAskUserDialog((rtc) => this._showAskUser(rtc));
        this._rtcProcessor.setMode(this._mode.value.state.currentMode);

        // 注入 MasterLock
        const masterLock = this._persistence.masterLock;
        if (masterLock) {
            this._rtcProcessor.setMaster(masterLock);
            // 当本 Tab 升级为 Master 时，触发 RTC 处理（恢复崩溃恢复场景）
            const prevOnAcquire = masterLock.onAcquire;
            masterLock.onAcquire = () => {
                prevOnAcquire?.();
                this._rtcProcessor?.onRtcUpdate().catch(err => {
                    console.error('[rtc-agent] onRtcUpdate on master acquire failed:', err);
                });
            };
        }

        await this._rtcProcessor.onRtcUpdate();
    }

    /* ── VFS 集成（Phase 3/4） ── */

    /**
     * 从 virtualFS 加载文件树（根目录一级）
     *
     * Phase 4 改为仅加载根目录的一级子项，子目录按需懒加载。
     */
    private async _loadFileTree(): Promise<void> {
        if (!this._persistence.isConnected) return;

        try {
            const root = await this._buildFileNodeShallow('/');
            this._fileExplorer.actions.setRoot(root);
            this._fileTreeLoaded = true;
        } catch (err) {
            console.error('[rtc-agent] Failed to load file tree:', err);
        }
    }

    /**
     * 浅构建 FileNode：只加载指定目录的一级子项
     *
     * 子目录的 children 为 undefined（未加载），
     * 用户展开时由 _loadFolderChildren 按需加载。
     */
    private async _buildFileNodeShallow(path: string): Promise<FileNode> {
        const name = path === '/' ? '/' : path.split('/').pop()!;
        const isRoot = path === '/';

        // 如果路径在 VFS 中有记录 → 文件
        if (!isRoot && await virtualFS.exists(path)) {
            return {path, name, type: 'file'};
        }

        // 否则视为目录，ls 获取一级子条目
        const children: FileNode[] = [];
        try {
            const entries = await virtualFS.ls(path);
            for (const entry of entries) {
                const childPath = isRoot ? `/${entry}` : `${path}/${entry}`;
                // 判断子条目是文件还是目录
                if (await virtualFS.exists(childPath)) {
                    children.push({path: childPath, name: entry, type: 'file'});
                } else {
                    // 目录：children 留空（未加载），展开时懒加载
                    children.push({path: childPath, name: entry, type: 'folder'});
                }
            }
        } catch {
            // ls 失败 → 空目录
        }

        return {path, name, type: 'folder', children};
    }

    /**
     * 懒加载指定目录的子项
     *
     * 由 folder-toggle 事件触发（首次展开时）。
     * 加载完成后通过 controller.updateChildren 更新文件树。
     */
    private async _loadFolderChildren(path: string): Promise<void> {
        if (!this._persistence.isConnected) return;

        console.log('[rtc-agent] _loadFolderChildren called for:', path);
        this._fileExplorer.actions.setLoading(path, true);
        try {
            const entries = await virtualFS.ls(path);
            console.log('[rtc-agent] ls entries:', entries);
            const children: FileNode[] = [];
            for (const entry of entries) {
                const childPath = path === '/' ? `/${entry}` : `${path}/${entry}`;
                if (await virtualFS.exists(childPath)) {
                    children.push({path: childPath, name: entry, type: 'file'});
                } else {
                    children.push({path: childPath, name: entry, type: 'folder'});
                }
            }
            console.log('[rtc-agent] loaded children:', children);
            this._fileExplorer.actions.updateChildren(path, children);
        } catch (err) {
            console.error('[rtc-agent] Failed to load folder children:', path, err);
        } finally {
            this._fileExplorer.actions.setLoading(path, false);
        }
    }

    /**
     * 打开文件：从 VFS 读取内容并在编辑器中打开
     */
    private async _handleFileOpen(filePath: string): Promise<void> {
        try {
            const content = await virtualFS.read(filePath);
            const defaultViewMode = this._settings.value.state.files.defaultViewMode;
            this._editorArea.actions.openFile(filePath, content, defaultViewMode);
            this._fileExplorer.actions.selectNode(filePath);
        } catch (err) {
            console.error('[rtc-agent] Failed to open file:', filePath, err);
            this._toast.actions.show(msg('打开文件失败'), 'error');
        }
    }

    /**
     * 刷新后恢复 Editor Area 已打开文件的内容
     *
     * tab 元数据（filePath、viewMode、cursorPosition、activeFilePath）
     * 在 EditorAreaController 构造时已从 localStorage 恢复，但 content 为空。
     * 该方法在 VFS 就绪后遍历所有已恢复的 tab，从 VFS 读取内容并填充。
     * 读取失败（文件已不存在）的 tab 会被自动关闭。
     */
    private async _restoreEditorAreaContent(): Promise<void> {
        const tabs = [...this._editorArea.tabs];
        if (tabs.length === 0) return;

        const activeFilePath = this._editorArea.activeFilePath;
        console.log('[rtc-agent] Restoring editor area content for', tabs.length, 'tabs');
        for (const tab of tabs) {
            try {
                const content = await virtualFS.read(tab.filePath);
                this._editorArea.actions.loadContent(tab.filePath, content);
            } catch {
                // 文件在 VFS 中已不存在（例如被其他客户端删除），关闭该 tab
                console.warn('[rtc-agent] Restored tab file not found in VFS, closing:', tab.filePath);
                this._editorArea.actions.closeFile(tab.filePath);
            }
        }

        // 文件树已加载的前提下，选中当前活动文件
        // （文件树在调用本方法之前已按需加载，保证节点已渲染）
        if (activeFilePath && this._fileTreeLoaded) {
            this._fileExplorer.actions.selectNode(activeFilePath);
        }
    }

    /**
     * 保存文件：将编辑器内容写入 VFS
     */
    private async _handleEditorSave(filePath: string): Promise<void> {
        // Clear auto-save timer if exists
        const timer = this._autoSaveTimers.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this._autoSaveTimers.delete(filePath);
        }

        const tab = this._editorArea.tabs.find(t => t.filePath === filePath);
        if (!tab) return;

        try {
            await virtualFS.write(filePath, tab.content, 'overwrite');
            this._editorArea.actions.saveFile(filePath);
            this._toast.actions.show(msg('已保存'), 'success');
        } catch (err) {
            console.error('[rtc-agent] Failed to save file:', filePath, err);
            this._toast.actions.show(msg('保存文件失败'), 'error');
        }
    }

    /**
     * 调度自动保存（防抖）
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
     * 处理来自其他标签页的文件变更事件
     *
     * - write/create：刷新文件树父目录；如果文件已打开且未修改，重新加载内容
     * - delete：刷新文件树父目录；如果文件已打开，关闭标签
     * - batch：全量刷新文件树
     */
    private async _handleFileChange(filePath: string, field: string): Promise<void> {
        if (field === 'batch') {
            // 批量写入：全量刷新文件树
            if (this._fileTreeLoaded) {
                void this._loadFileTree();
            }
            return;
        }

        // 推导父目录路径
        const lastSlash = filePath.lastIndexOf('/');
        const parentPath = lastSlash <= 0 ? '/' : filePath.substring(0, lastSlash);

        // 刷新文件树中父目录的子项
        if (this._fileTreeLoaded) {
            if (parentPath === '/') {
                void this._loadFileTree();
            } else {
                void this._loadFolderChildren(parentPath);
            }
        }

        if (field === 'write' || field === 'create') {
            // 如果该文件已打开且未修改，静默重新加载内容
            const tab = this._editorArea.tabs.find(t => t.filePath === filePath);
            if (tab && !tab.isDirty) {
                try {
                    const content = await virtualFS.read(filePath);
                    this._editorArea.actions.openFile(filePath, content);
                } catch {
                    // 读取失败，保留当前内容
                }
            } else if (tab?.isDirty) {
                this._toast.actions.show(`文件 ${filePath} 被其他标签页修改`, 'info');
            }
        } else if (field === 'delete') {
            // 文件被删除：如果已打开，关闭标签
            const tab = this._editorArea.tabs.find(t => t.filePath === filePath);
            if (tab) {
                this._editorArea.actions.closeFile(filePath);
                this._toast.actions.show(`文件 ${filePath} 已被删除`, 'info');
            }
        }
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
        // 默认使用产品 logo 的简化版本
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
     * 渲染主布局（登录后）
     *
     * 聊天模式：Activity Bar + [Sidebar] + Chat Layout（会话树 + Tab + 聊天）
     * 文件模式：Activity Bar + [Sidebar(文件树)] + Editor Area + Status Bar
     * 侧边栏内容取决于当前活动（files → 文件树，chat → 会话列表）
     */
    private _renderMainLayout(active: Activity, sidebarVisible: boolean) {
        const isFiles = active === 'files';
        const isChat = active === 'chat';
        const isSettings = active === 'settings';
        const showSidebar = sidebarVisible && (isFiles || isChat);
        const disabled = this._resolvedActivityBarConfig.disabledActivities;

        return html`
      <div class="main-layout">
        <rtc-activity-bar
          .active=${active}
          theme=${this.theme}
          ?show-files=${!disabled.includes('files')}
          ?show-settings=${!disabled.includes('settings')}
        ></rtc-activity-bar>
        ${showSidebar && isFiles
          ? html`<div class="sidebar">
              <rtc-file-explorer theme=${this.theme}></rtc-file-explorer>
            </div>`
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
            ? html`<rtc-chat-layout theme=${this.theme} .sessionTreeVisible=${sidebarVisible}></rtc-chat-layout>`
            : isSettings
              ? html`<rtc-settings-layout theme=${this.theme}></rtc-settings-layout>`
              : nothing}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-agent': RtcAgent;
    }
}
