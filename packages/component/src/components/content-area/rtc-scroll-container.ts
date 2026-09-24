/**
 * RTC Scroll Container Component
 *
 * A reusable wrapper that provides scroll lock functionality for content areas.
 * Prevents nested scroll conflicts by locking internal scroll by default.
 *
 * Features:
 * - Default locked state with subtle bottom gradient overlay
 * - Click toggle button to unlock scrolling
 * - Smooth transitions between locked/unlocked states
 * - Configurable max-height via CSS variables
 *
 * Usage:
 * ```html
 * <rtc-scroll-container max-height="var(--rtc-content-height-md)">
 *   <pre>Long content here...</pre>
 * </rtc-scroll-container>
 * ```
 *
 * @element rtc-scroll-container
 * @slot - Default slot for scrollable content
 * @cssprop --rtc-scroll-max-height-locked - Max height when locked (default: 100px)
 * @cssprop --rtc-scroll-max-height-unlocked - Max height when unlocked (default: 200px)
 */
import {LitElement, html} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {styles} from './rtc-scroll-container.styles.js';

@customElement('rtc-scroll-container')
export class RtcScrollContainer extends LitElement {
    static styles = styles;

    /** Initial lock state (default: true = locked) */
    @property({type: Boolean})
    initialLocked = true;

    /** Whether content is currently scroll-locked */
    @state()
    private _scrollLocked = true;

    constructor() {
        super();
        this._scrollLocked = this.initialLocked;
    }

    /** Toggle scroll lock state */
    private _toggleScrollLock() {
        this._scrollLocked = !this._scrollLocked;
    }

    /** Get current lock state (for external access if needed) */
    get isLocked(): boolean {
        return this._scrollLocked;
    }

    render() {
        return html`
            <div class="scroll-container ${this._scrollLocked ? 'locked' : 'unlocked'}">
                <div class="content">
                    <slot></slot>
                </div>
                ${this._scrollLocked ? html`
                    <div class="scroll-indicator" @click=${this._toggleScrollLock}>
                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 11L3 6h10l-5 5z"/>
                        </svg>
                    </div>
                ` : html`
                    <div class="scroll-indicator scroll-indicator-up" @click=${this._toggleScrollLock}>
                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 5l5 5H3l5-5z"/>
                        </svg>
                    </div>
                `}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-scroll-container': RtcScrollContainer;
    }
}
