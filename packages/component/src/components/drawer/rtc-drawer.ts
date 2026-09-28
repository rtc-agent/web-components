/**
 * RTC Drawer Component
 *
 * Generic left-side drawer panel component.
 * Slides in from the right side of the Activity Bar, overlays on top of the main content
 * without squeezing the main content area width.
 *
 * Used to replace the original flex-layout sidebars (session-tree, file-explorer, settings-nav),
 * unifying drawer interaction:
 * - Semi-transparent backdrop overlay, click to close
 * - ESC key to close
 * - Smooth slide-in/out animation
 * - Mutually exclusive behavior (controlled by parent component, only one open at a time)
 *
 * @element rtc-drawer
 *
 * @attr {boolean} open - Whether the drawer is open
 *
 * @cssprop [--rtc-drawer-width=240px] - Drawer panel width
 * @cssprop [--rtc-drawer-backdrop-bg=rgba(0,0,0,0.3)] - Backdrop background color
 * @cssprop [--rtc-drawer-transition-duration=0.25s] - Animation duration
 *
 * @csspart backdrop - Backdrop element
 * @csspart panel - Drawer panel element
 *
 * @fires rtc-drawer-close - Fired when user requests to close the drawer (click backdrop / press ESC)
 *
 * ## Usage
 * ```html
 * <rtc-drawer ?open=${drawerOpen}>
 *   <rtc-session-tree></rtc-session-tree>
 * </rtc-drawer>
 * ```
 *
 * ## Positioning
 * Drawer uses position: absolute positioning, requiring the parent container to set position: relative.
 * In rtc-agent, the Drawer is placed inside .main-layout (.main-layout is already a flex container),
 * with JS setting left to the Activity Bar width (48px), to position it flush against the right side
 * of the Activity Bar.
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-drawer.styles.js';

@customElement('rtc-drawer')
export class RtcDrawer extends LitElement {
    static styles = styles;

    /**
     * Whether the drawer is open
     *
     * Controlled via attribute `open` or property.
     * reflect: true makes the [open] attribute visible in the DOM, driving CSS state.
     */
    @property({type: Boolean, reflect: true})
    open = false;

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();
        // Global ESC listener: close when ESC is pressed while open
        document.addEventListener('keydown', this._boundOnKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('keydown', this._boundOnKeydown);
    }

    /* ── Event Handlers ── */

    /**
     * Click backdrop overlay
     *
     * Dispatches custom event to notify parent component to close the drawer.
     */
    private _handleBackdropClick() {
        this.dispatchEvent(
            new CustomEvent('rtc-drawer-close', {
                bubbles: true,
                composed: true,
            })
        );
    }

    /**
     * Global ESC key handler
     *
     * Only responds when drawer is open and connected in the DOM.
     */
    private _boundOnKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.open) {
            e.preventDefault();
            this.dispatchEvent(
                new CustomEvent('rtc-drawer-close', {
                    bubbles: true,
                    composed: true,
                })
            );
        }
    };

    /* ── Render ── */

    render() {
        return html`
            <div
                class="backdrop"
                part="backdrop"
                @click=${this._handleBackdropClick}
                aria-hidden="true"
            ></div>
            <div
                class="panel"
                part="panel"
                role="complementary"
                aria-hidden="${!this.open}"
            >
                <slot></slot>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-drawer': RtcDrawer;
    }

    interface HTMLElementEventMap {
        'rtc-drawer-close': CustomEvent;
    }
}
