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
import {attachIcon, toolIcon, sendIcon, stopIcon, micIcon} from '../../icons/index.js';
import '../overlay/rtc-mode-panel.js';

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

    @state()
    private _value = '';

    @state()
    private _showModePanel = false;

    @query('.mode-btn')
    private _modeBtn!: HTMLElement;

    @query('rtc-mode-panel')
    private _modePanel?: HTMLElement;

    private _cleanupPosition: (() => void) | null = null;

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
        // 等下一个渲染周期后聚焦并调整高度
        this.updateComplete.then(() => {
            const textarea = this._textarea;
            if (textarea) {
                textarea.value = value;
                textarea.focus();
                // 自动调整高度
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight}px`;
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
        // return this._turnCount.pendingTurnCount + this._turnCount.runningTurnCount > 0;
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
        }
    }

    private _submit() {
        const content = this._value.trim();
        if (!content) return;

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

    private _onDocClick = (e: MouseEvent) => {
        if (!this._showModePanel) return;
        const path = e.composedPath();
        if (!path.includes(this)) {
            this._closeModePanel();
        }
    };

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('mousedown', this._onDocClick, true);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('mousedown', this._onDocClick, true);
        this._stopPositioning();
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
          <button class="toolbar-btn" title="Tool call">${toolIcon}</button>
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
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-input-area': RtcInputArea;
    }
}
