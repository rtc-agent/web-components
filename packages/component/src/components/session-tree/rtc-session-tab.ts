/**
 * Session Tab — 单个 Tab 页签
 *
 * 样式模式完全参考 rtc-editor-tab.ts。
 *
 * @element rtc-session-tab
 * @fires rtc-session-tab-activate - 点击激活（detail: { sessionId }）
 * @fires rtc-session-tab-close - 点击关闭（detail: { sessionId }）
 */
import {LitElement, html, svg} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';
import {styles} from './rtc-session-tab.styles.js';
import type {SessionStatus} from '../../types/index.js';

// 内联 close SVG（与 rtc-editor-tab 保持一致）
const closeSvg = svg`<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

@customElement('rtc-session-tab')
export class RtcSessionTab extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    @property({type: String, attribute: 'session-id'})
    sessionId!: string;

    @property({type: String})
    title = '';

    @property({type: Boolean, reflect: true})
    active = false;

    @property({type: Boolean, reflect: true})
    dirty = false;

    /** Session 运行状态：active（agent 生成中）/ idle（等待输入）/ closed（已关闭） */
    @property({type: String, reflect: true})
    status: SessionStatus = 'idle';

    /** 主题：light / dark / system */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    private _handleClick() {
        this.dispatchEvent(
            new CustomEvent('rtc-session-tab-activate', {
                bubbles: true,
                composed: true,
                detail: {sessionId: this.sessionId},
            })
        );
    }

    private _handleClose(e: Event) {
        e.stopPropagation();
        this.dispatchEvent(
            new CustomEvent('rtc-session-tab-close', {
                bubbles: true,
                composed: true,
                detail: {sessionId: this.sessionId},
            })
        );
    }

    private _handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._handleClick();
        }
        if (e.key === 'Escape') {
            this._handleClose(e);
        }
    }

    render() {
        return html`
            <div
                class=${classMap({
                    'tab': true,
                    'active': this.active,
                })}
                role="tab"
                aria-selected=${this.active}
                tabindex=${this.active ? '0' : '-1'}
                @click=${this._handleClick}
                @keydown=${this._handleKeyDown}
            >
                <span
                    class=${classMap({
                        'status-dot': true,
                        'active': this.status === 'active',
                        'closed': this.status === 'closed',
                    })}
                    aria-hidden="true"
                ></span>
                <span class="tab-title">${this.title || 'Untitled'}</span>
                ${this.dirty
                    ? html`<span class="tab-dirty" aria-label="unsaved"></span>`
                    : ''}
                <button
                    class="tab-close"
                    aria-label="关闭"
                    tabindex="-1"
                    @click=${this._handleClose}
                >${closeSvg}</button>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-session-tab': RtcSessionTab;
    }
}
