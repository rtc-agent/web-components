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
 * - Passive scroll listeners for better performance
 * - Scroll position restoration on lock toggle
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
import { LitElement, html } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { styles } from './rtc-scroll-container.styles.js';

@customElement('rtc-scroll-container')
export class RtcScrollContainer extends LitElement {
  static styles = styles;

  /** Initial lock state (default: true = locked) */
  @property({ type: Boolean })
  initialLocked = true;

  /** Whether content is currently scroll-locked */
  @state()
  private _scrollLocked = true;

  /** Reference to the content element for scroll position tracking */
  @query('.content')
  private _contentEl!: HTMLDivElement;

  /** Saved scroll position for restoration after lock toggle */
  private _savedScrollTop = 0;

  /** Bound scroll handler for proper cleanup */
  private _boundScrollHandler?: () => void;

  constructor() {
    super();
    this._scrollLocked = this.initialLocked;
  }

  connectedCallback() {
    super.connectedCallback();
    // Set up passive scroll listener after first render
    this.updateComplete.then(() => this._setupScrollListener());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._removeScrollListener();
  }

  /** Set up passive scroll event listener for performance */
  private _setupScrollListener() {
    if (!this._contentEl) return;

    // Use passive listener for better scroll performance
    this._boundScrollHandler = this._onContentScroll.bind(this);
    this._contentEl.addEventListener('scroll', this._boundScrollHandler, {
      passive: true,
    });
  }

  /** Remove scroll event listener */
  private _removeScrollListener() {
    if (this._contentEl && this._boundScrollHandler) {
      this._contentEl.removeEventListener('scroll', this._boundScrollHandler);
      this._boundScrollHandler = undefined;
    }
  }

  /** Handle scroll events (for future analytics or features) */
  private _onContentScroll() {
    // Track scroll position for restoration
    if (this._contentEl && !this._scrollLocked) {
      this._savedScrollTop = this._contentEl.scrollTop;
    }
  }

  /** Toggle scroll lock state with position restoration */
  private _toggleScrollLock() {
    const wasLocked = this._scrollLocked;
    this._scrollLocked = !wasLocked;

    // Restore scroll position when unlocking
    if (wasLocked && this._contentEl) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (this._contentEl) {
          this._contentEl.scrollTop = this._savedScrollTop;
        }
      });
    }
  }

  /** Get current lock state (for external access if needed) */
  get isLocked(): boolean {
    return this._scrollLocked;
  }

  /** Get current scroll position */
  get scrollTop(): number {
    return this._contentEl?.scrollTop ?? 0;
  }

  /** Set scroll position programmatically */
  set scrollTop(value: number) {
    if (this._contentEl) {
      this._contentEl.scrollTop = value;
      this._savedScrollTop = value;
    }
  }

  render() {
    return html`
            <div class="scroll-container ${this._scrollLocked ? 'locked' : 'unlocked'}">
                <div class="content">
                    <slot></slot>
                </div>
                ${
                  this._scrollLocked
                    ? html`
                    <div class="scroll-indicator" @click=${this._toggleScrollLock}>
                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 11L3 6h10l-5 5z"/>
                        </svg>
                    </div>
                `
                    : html`
                    <div class="scroll-indicator scroll-indicator-up" @click=${this._toggleScrollLock}>
                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 5l5 5H3l5-5z"/>
                        </svg>
                    </div>
                `
                }
            </div>
        `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-scroll-container': RtcScrollContainer;
  }
}
