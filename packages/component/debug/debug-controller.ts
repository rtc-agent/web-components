/**
 * Debug Controller — 可复用的调试面板控制器
 *
 * 为 Phase 2.x 的 Debug HTML 提供通用功能：
 * 1. 主题管理（亮/暗切换，同步更新组件和背景）
 * 2. 状态显示（JSON 格式）
 * 3. 事件日志（记录所有组件事件，保留最近 N 条）
 * 4. DOM 工具（$ 快捷方式、渲染辅助）
 *
 * 使用方式：
 * ```ts
 * const dc = new DebugController({
 *   previewSelector: '#previewContainer',
 *   stateDisplaySelector: '#stateDisplay',
 *   eventLogSelector: '#eventLog',
 *   maxLogEntries: 20,
 * });
 * dc.setTheme('dark');
 * dc.logEvent('some-event', { detail: 'value' });
 * ```
 *
 * 约定：
 * - Debug HTML 中放置带有指定 selector 的容器元素
 * - DebugController 负责更新这些容器的内容
 * - 主题切换会同时更新 preview 容器的 theme 属性和 body 背景
 */

export interface DebugControllerOptions {
    /** 预览容器选择器（主题切换作用于此元素） */
    previewSelector?: string;
    /** 状态显示容器选择器 */
    stateDisplaySelector?: string;
    /** 事件日志容器选择器 */
    eventLogSelector?: string;
    /** 最大日志条目数（默认 20） */
    maxLogEntries?: number;
    /** 默认主题（默认 'dark'） */
    defaultTheme?: 'light' | 'dark';
}

export interface LogEntry {
    name: string;
    detail: unknown;
    timestamp: number;
}

export class DebugController<S extends Record<string, unknown> = Record<string, unknown>> {
    private _options: Required<DebugControllerOptions>;
    private _theme: 'light' | 'dark';
    private _state: S;
    private _log: LogEntry[] = [];

    /* ── DOM 缓存 ── */
    private _previewEl: HTMLElement | null = null;
    private _stateEl: HTMLElement | null = null;
    private _logEl: HTMLElement | null = null;
    private _themeIndicatorEl: HTMLElement | null = null;

    /* ── 回调 ── */
    private _onThemeChange?: (theme: 'light' | 'dark') => void;
    private _onStateChange?: (state: S) => void;

    constructor(options: DebugControllerOptions = {}) {
        this._options = {
            previewSelector: options.previewSelector ?? '#previewContainer',
            stateDisplaySelector: options.stateDisplaySelector ?? '#stateDisplay',
            eventLogSelector: options.eventLogSelector ?? '#eventLog',
            maxLogEntries: options.maxLogEntries ?? 20,
            defaultTheme: options.defaultTheme ?? 'dark',
        };

        this._theme = this._options.defaultTheme;
        this._state = {} as S;

        this._cacheDom();
        this._applyTheme();
        this._renderLog();
    }

    /* ── Public API ── */

    /** 获取当前主题 */
    get theme(): 'light' | 'dark' {
        return this._theme;
    }

    /** 获取当前状态（只读副本） */
    get state(): Readonly<S> {
        return this._state;
    }

    /** 设置状态并刷新显示 */
    setState(partial: Partial<S>): void {
        this._state = {...this._state, ...partial};
        this._renderState();
        this._onStateChange?.(this._state);
    }

    /** 替换整个状态 */
    replaceState(state: S): void {
        this._state = {...state};
        this._renderState();
        this._onStateChange?.(this._state);
    }

    /** 切换主题 */
    setTheme(theme: 'light' | 'dark'): void {
        this._theme = theme;
        this._applyTheme();
        this._onThemeChange?.(this._theme);
    }

    /** 记录事件 */
    logEvent(name: string, detail?: unknown): void {
        this._log.unshift({
            name,
            detail: detail ?? null,
            timestamp: Date.now(),
        });
        if (this._log.length > this._options.maxLogEntries) {
            this._log.length = this._options.maxLogEntries;
        }
        this._renderLog();
    }

    /** 清空事件日志 */
    clearLog(): void {
        this._log = [];
        this._renderLog();
    }

    /** 注册主题变更回调 */
    onThemeChange(cb: (theme: 'light' | 'dark') => void): void {
        this._onThemeChange = cb;
    }

    /** 注册状态变更回调 */
    onStateChange(cb: (state: S) => void): void {
        this._onStateChange = cb;
    }

    /* ── DOM 查询快捷方式 ── */

    /** querySelector 快捷方式 */
    $(selector: string): HTMLElement | null {
        return document.querySelector(selector);
    }

    /** querySelectorAll 快捷方式 */
    $$(selector: string): NodeListOf<HTMLElement> {
        return document.querySelectorAll(selector);
    }

    /** 获取预览容器 */
    get preview(): HTMLElement | null {
        return this._previewEl;
    }

    /* ── 内部方法 ── */

    private _cacheDom(): void {
        this._previewEl = document.querySelector(this._options.previewSelector);
        this._stateEl = document.querySelector(this._options.stateDisplaySelector);
        this._logEl = document.querySelector(this._options.eventLogSelector);
        this._themeIndicatorEl = document.getElementById('currentTheme');
    }

    private _applyTheme(): void {
        // 更新预览容器 theme 属性
        if (this._previewEl) {
            this._previewEl.setAttribute('theme', this._theme);
        }

        // 更新 body 背景
        document.body.style.background = this._theme === 'dark' ? '#404040' : '#e8e8e8';
        document.body.style.color = this._theme === 'dark' ? '#cccccc' : '#333333';

        // 更新主题指示器
        if (this._themeIndicatorEl) {
            this._themeIndicatorEl.textContent = this._theme;
        }

        // 更新主题按钮 active 状态
        document.querySelectorAll<HTMLElement>('.theme-btn').forEach(btn => {
            const btnTheme = btn.dataset.theme;
            btn.classList.toggle('active', btnTheme === this._theme);
        });
    }

    private _renderState(): void {
        if (!this._stateEl) return;
        this._stateEl.textContent = JSON.stringify(this._state, null, 2);
    }

    private _renderLog(): void {
        if (!this._logEl) return;

        if (this._log.length === 0) {
            this._logEl.innerHTML = '<div class="event-log-empty">暂无事件</div>';
            return;
        }

        this._logEl.innerHTML = this._log
            .map(entry => {
                const time = new Date(entry.timestamp).toLocaleTimeString();
                const detailStr = entry.detail !== null
                    ? JSON.stringify(entry.detail)
                    : '';
                return `<div class="event-log-entry">` +
                    `<span class="event-log-time">${time}</span> ` +
                    `<span class="event-name">${entry.name}</span> ` +
                    `<span class="event-detail">${detailStr}</span>` +
                    `</div>`;
            })
            .join('');
    }

    /**
     * 绑定主题按钮
     *
     * 查找所有 .theme-btn[data-theme] 按钮并绑定点击事件。
     * 在 HTML 中放置：
     *   <button class="theme-btn" data-theme="light">Light</button>
     *   <button class="theme-btn" data-theme="dark">Dark</button>
     */
    bindThemeButtons(): void {
        document.querySelectorAll<HTMLButtonElement>('.theme-btn[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme as 'light' | 'dark';
                if (theme === 'light' || theme === 'dark') {
                    this.setTheme(theme);
                }
            });
        });
    }

    /**
     * 绑定事件日志到组件
     *
     * 监听指定元素上的指定事件，自动记录到日志。
     *
     * @example
     * dc.bindEventLog(myComponent, ['editor-tab-select', 'editor-tab-close']);
     */
    bindEventLog(element: EventTarget, eventNames: string[]): void {
        for (const name of eventNames) {
            element.addEventListener(name, (e: Event) => {
                this.logEvent(name, (e as CustomEvent).detail);
            });
        }
    }
}
