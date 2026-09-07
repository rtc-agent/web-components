/**
 * RTC Input Area Component
 *
 * Message textarea with bottom toolbar (attach, tool, mode, send buttons).
 * Layout: textarea on top, toolbar on bottom (matches Claude Code UI).
 * Enter to submit, Shift+Enter for newline.
 *
 * The mode panel is rendered inside this component's shadow DOM and positioned
 * with @floating-ui/dom relative to the mode button, so it never overflows
 * the rtc-agent window boundary.
 *
 * @element rtc-input-area
 * @fires rtc-input-submit - User submitted message (detail: { content })
 * @fires rtc-command-requested - User submitted a slash command (detail: { name, args })
 * @fires rtc-voice-input-requested - User clicked voice input button
 * @csspart textarea - The textarea element
 * @csspart toolbar - The toolbar row
 * @csspart mode-btn - The mode button
 * @csspart send-btn - The send button
 * @csspart voice-btn - The voice input button
 */
import {LitElement, html} from 'lit';
import {customElement, state, query} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {
    computePosition,
    flip,
    shift,
    offset,
    autoUpdate,
} from '@floating-ui/dom';
import {styles} from './rtc-input-area.styles.js';
import {ModeContext, MODE_CONFIGS, type ModeContextValue} from '../../contexts/mode.js';
import {SessionContext} from '../../contexts/session.js';
import {TurnCountContext, type TurnCountContextValue} from '../../contexts/turn-count.js';
import {MessageContext, type MessageContextValue} from '../../contexts/message.js';
import {attachIcon, toolIcon, sendIcon, stopIcon, micIcon} from '../../icons/index.js';
import {parseCommand} from '../../utils/command-parser.js';
import '../overlay/rtc-mode-panel.js';
import '../overlay/rtc-command-panel.js';

// UIUpdateBus 用于监听新消息事件
import {getUIUpdateBus, type UIUpdateEvent} from '@rtc-agent/persistence';

@customElement('rtc-input-area')
export class RtcInputArea extends LitElement {
    static styles = styles;

    @consume({context: ModeContext, subscribe: true})
    @state()
    private _modeCtx: ModeContextValue = {
        state: {currentMode: 'manual'},
        actions: {setMode: () => {}},
    };

    @consume({context: SessionContext, subscribe: true})
    @state()
    private _sessionCtx: {state: {currentSessionId: string | null}} = {
        state: {currentSessionId: null},
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
            loadMore: async () => {},
        },
    };

    @state()
    private _value = '';

    @state()
    private _showModePanel = false;

    @state()
    private _showCommandPanel = false;

    // 历史导航状态
    @state()
    private _userMessageHistory: string[] = [];
    @state()
    private _historyIndex = -1;
    private _draft = '';

    // UIUpdateBus 订阅清理函数
    private _busUnsub?: () => void;

    @query('.mode-btn')
    private _modeBtn!: HTMLElement;

    @query('rtc-mode-panel')
    private _modePanel?: HTMLElement;

    @query('.tool-btn')
    private _commandBtn!: HTMLElement;

    @query('rtc-command-panel')
    private _commandPanel?: HTMLElement;

    private _cleanupPosition: (() => void) | null = null;
    private _cleanupCommandPosition: (() => void) | null = null;

    private get _textarea(): HTMLTextAreaElement | null {
        return this.shadowRoot?.querySelector('.input-textarea') ?? null;
    }

    private _handleVoice() {
        this.dispatchEvent(
            new CustomEvent('rtc-voice-input-requested', {bubbles: true, composed: true})
        );
    }

    /**
     * 公共方法：设置输入框内容（用于 fork 等场景预填内容）
     */
    public setValue(value: string) {
        this._value = value;
        // 等下一个渲染周期后聚焦
        this.updateComplete.then(() => {
            const textarea = this._textarea;
            if (textarea) {
                textarea.value = value;
                textarea.focus();
                // 不调整高度，保持 CSS 控制的固定高度，内容超出时用滚动条
            }
        });
    }

    /**
     * 公共方法：清空输入框
     */
    public clearValue() {
        this._value = '';
        if (this._textarea) {
            this._textarea.value = '';
            this._textarea.style.height = '';
        }
    }

    private get _hasContent(): boolean {
        return this._value.trim().length > 0;
    }

    private get _hasActiveTurns(): boolean {
        return this._turnCount.runningTurnCount > 0;
    }

    /** 当前会话有活跃 turn 且输入框为空 → 显示 stop 按钮；否则显示 send 按钮。 */
    private get _showStop(): boolean {
        return this._hasActiveTurns && !this._hasContent;
    }

    /**
     * Stop 按钮点击：发送停止请求事件
     */
    private _handleStop() {
        const sessionId = this._sessionCtx.state.currentSessionId;
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
        // 忽略 IME 组合输入过程中的按键（中文/日文/韩文输入法）
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this._submit();
        } else if (e.key === 'ArrowUp' && this._isCursorOnFirstLine()) {
            e.preventDefault();
            this._navigateHistory('up');
        } else if (e.key === 'ArrowDown' && this._isCursorOnLastLine()) {
            e.preventDefault();
            this._navigateHistory('down');
        }
    }

    /**
     * 判断光标是否在 textarea 第一行
     * 光标前没有换行符即为第一行（空值时也返回 true）
     */
    private _isCursorOnFirstLine(): boolean {
        const textarea = this._textarea;
        if (!textarea) return true;
        const textBeforeCursor = this._value.substring(0, textarea.selectionStart);
        return !textBeforeCursor.includes('\n');
    }

    /**
     * 判断光标是否在 textarea 最后一行
     * 光标后没有换行符即为最后一行（空值时也返回 true）
     */
    private _isCursorOnLastLine(): boolean {
        const textarea = this._textarea;
        if (!textarea) return true;
        const textAfterCursor = this._value.substring(textarea.selectionEnd);
        return !textAfterCursor.includes('\n');
    }

    /**
     * 历史导航：上箭头回溯、下箭头前进
     *
     * 首次按上箭头时从 MessageContext 加载用户消息历史，
     * 并将当前输入保存为 draft，以便回到最新位置时恢复。
     */
    private async _navigateHistory(direction: 'up' | 'down') {
        // 首次进入历史导航时加载历史消息
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
                // 回到草稿状态
                newIndex = -1;
            } else {
                newIndex = this._historyIndex - 1;
            }
        }

        this._historyIndex = newIndex;
        this._value = newIndex === -1 ? this._draft : this._userMessageHistory[newIndex];

        // 同步 DOM 并移动光标到末尾
        const textarea = this._textarea;
        if (textarea) {
            textarea.value = this._value;
            textarea.selectionStart = textarea.selectionEnd = this._value.length;
        }
    }

    /**
     * 从 MessageContext 加载当前 session 的用户消息历史
     */
    private async _loadUserMessageHistory() {
        const sessionId = this._sessionCtx.state.currentSessionId;
        if (!sessionId) return;

        const fn = this._messageCtx.getUserMessageHistory;
        if (!fn) return;

        try {
            this._userMessageHistory = await fn.call(this._messageCtx, sessionId);
        } catch (error) {
            console.warn('[rtc-input-area] _loadUserMessageHistory failed:', error);
        }
    }

    private _submit() {
        const content = this._value.trim();
        if (!content) return;

        // 退出历史模式
        this._historyIndex = -1;
        this._draft = '';

        // 检查是否为 slash 命令
        const parsed = parseCommand(content);
        // /goal is NOT a front-end command — it's a plain message with a
        // /goal prefix that the backend recognizes in loadMessages.
        // Let it fall through to the rtc-input-submit path below.
        if (parsed.isCommand && parsed.name && parsed.name !== 'goal') {
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

        // 乐观更新：将当前消息插入历史头部（最新消息在前）
        // 避免 UIUpdateBus 延迟导致刚发的消息不在历史中
        if (
            this._userMessageHistory.length === 0 ||
            this._userMessageHistory[0] !== content
        ) {
            this._userMessageHistory = [content, ...this._userMessageHistory];
        }

        this.dispatchEvent(
            new CustomEvent('rtc-input-submit', {
                bubbles: true,
                composed: true,
                detail: {content},
            })
        );
        this._value = '';
        // Directly clear the DOM textarea — Lit's dirty-check won't update
        // when the last rendered value was already '' (the initial state).
        if (this._textarea) this._textarea.value = '';
    }

    private get _currentModeLabel(): string {
        return MODE_CONFIGS.find(c => c.mode === this._modeCtx.state.currentMode)?.label
            ?? this._modeCtx.state.currentMode;
    }

    private _handleModeToggle() {
        this._showModePanel = !this._showModePanel;
        if (this._showModePanel) {
            this._startPositioning();
        } else {
            this._stopPositioning();
        }
    }

    private _closeModePanel() {
        this._showModePanel = false;
        this._stopPositioning();
    }

    private async _startPositioning() {
        // Wait for render so rtc-mode-panel exists in DOM
        await this.updateComplete;
        const btn = this._modeBtn;
        const panel = this._modePanel;
        if (!btn || !panel) return;

        this._cleanupPosition?.();
        this._cleanupPosition = autoUpdate(btn, panel, () => this._updatePosition());
    }

    private async _updatePosition() {
        await this.updateComplete;
        const btn = this._modeBtn;
        const panel = this._modePanel;
        if (!btn || !panel) return;

        const {x, y} = await computePosition(btn, panel, {
            placement: 'top-end',
            strategy: 'absolute',
            middleware: [
                offset(6),
                flip({padding: 8}),
                shift({padding: 8}),
            ],
        });
        Object.assign(panel.style, {
            left: `${x}px`,
            top: `${y}px`,
        });
    }

    private _stopPositioning() {
        this._cleanupPosition?.();
        this._cleanupPosition = null;
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
            this._startCommandPositioning();
        } else {
            this._stopCommandPositioning();
        }
    }

    private _closeCommandPanel() {
        this._showCommandPanel = false;
        this._stopCommandPositioning();
    }

    private async _startCommandPositioning() {
        // Wait for render so rtc-command-panel exists in DOM
        await this.updateComplete;
        const btn = this._commandBtn;
        const panel = this._commandPanel;
        if (!btn || !panel) return;

        this._cleanupCommandPosition?.();
        this._cleanupCommandPosition = autoUpdate(btn, panel, () => this._updateCommandPosition());
    }

    private async _updateCommandPosition() {
        await this.updateComplete;
        const btn = this._commandBtn;
        const panel = this._commandPanel;
        if (!btn || !panel) return;

        const {x, y} = await computePosition(btn, panel, {
            placement: 'top-start',
            strategy: 'absolute',
            middleware: [
                offset(6),
                flip({padding: 8}),
                shift({padding: 8}),
            ],
        });
        Object.assign(panel.style, {
            left: `${x}px`,
            top: `${y}px`,
        });
    }

    private _stopCommandPositioning() {
        this._cleanupCommandPosition?.();
        this._cleanupCommandPosition = null;
    }

    private _handleCommandSelected(e: Event) {
        const detail = (e as CustomEvent).detail;
        const commandName = detail.command;

        // /goal is a draft-time command: prepend "/goal " to the textarea
        // and let the user finish typing. Do NOT dispatch rtc-command-requested.
        if (commandName === 'goal') {
            this._closeCommandPanel();
            const textarea = this._textarea;
            if (textarea) {
                const prefix = '/goal ';
                const current = textarea.value;
                const next = current.startsWith(prefix) ? current : prefix + current;
                textarea.value = next;
                this._value = next;
                textarea.focus();
                // Place caret at end of "/goal "
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

    private _onDocClick = (e: MouseEvent) => {
        const path = e.composedPath();
        if (!path.includes(this)) {
            if (this._showModePanel) {
                this._closeModePanel();
            }
            if (this._showCommandPanel) {
                this._closeCommandPanel();
            }
        }
    };

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('mousedown', this._onDocClick, true);

        // 订阅 UIUpdateBus：收到当前 session 的用户消息时清空历史缓存，下次导航时重新加载
        const bus = getUIUpdateBus();
        this._busUnsub = bus.subscribe('message', (event: UIUpdateEvent) => {
            if (event.action !== 'created' || event.field !== 'role' || event.newValue !== 'user') {
                return;
            }
            // 有新用户消息写入，清空缓存，下次导航时重新加载
            // （不在此处立即加载，避免频繁查询）
            this._userMessageHistory = [];
            this._historyIndex = -1;
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('mousedown', this._onDocClick, true);
        this._stopPositioning();
        this._busUnsub?.();
        this._busUnsub = undefined;
    }

    updated(changed: Map<string | number | symbol, unknown>) {
        // Session 切换时清空历史缓存，下次导航时重新加载
        if (changed.has('_sessionCtx')) {
            this._userMessageHistory = [];
            this._historyIndex = -1;
            this._draft = '';
        }
    }

    render() {
        return html`
      <div class="input-inner">
        <div class="textarea-container">
          <textarea
            class="input-textarea"
            part="textarea"
            .value=${this._value}
            placeholder="Ask anything..."
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
          ></textarea>
          <button class="voice-btn" part="voice-btn" title="Voice input" @click=${this._handleVoice}>
            ${micIcon}
          </button>
        </div>
        <div class="input-toolbar" part="toolbar">
          <button class="toolbar-btn" title="Attach file">${attachIcon}</button>
          <button class="toolbar-btn tool-btn" title="Commands" @click=${this._handleCommandToggle}>${toolIcon}</button>
          <span class="toolbar-spacer"></span>
          <button class="mode-btn" part="mode-btn" @click=${this._handleModeToggle}>
            ${this._currentModeLabel}
          </button>
          <button
            class="send-btn ${this._showStop ? 'send-btn--stop' : ''}"
            part="send-btn"
            title=${this._showStop ? 'Stop' : 'Send'}
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
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-input-area': RtcInputArea;
    }
}
