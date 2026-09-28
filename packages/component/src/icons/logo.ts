/**
 * RTC Agent Logo — dual theme support
 *
 * Lit rendering helper for the product logo, supporting both light (day) and dark (night) versions.
 *
 * Usage:
 *   import {renderLogo, renderBubbleLogo} from '../../icons/logo.js';
 *   render() { return html`<div class="logo">${renderLogo(this.theme === 'dark')}</div>`; }
 */
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import logoLight from '../assets/logo.svg?raw';
import logoDark from '../assets/logo-dark.svg?raw';

/**
 * Render full logo (used for login page, empty state, and other large-display scenarios)
 *
 * @param dark - `true` returns the night-sky version (dark theme), `false` returns the blue-sky version (light theme)
 */
export function renderLogo(dark = false): unknown {
    return unsafeHTML(dark ? logoDark : logoLight);
}

/**
 * Bubble logo (minimalized bubble)
 *
 * Bubble shape (rounded square 23.2%) is isomorphic to the logo, reusing the full SVG directly.
 *
 * @param dark - `true` returns the night-sky version, `false` returns the blue-sky version
 */
export function renderBubbleLogo(dark = false): unknown {
    return unsafeHTML(dark ? logoDark : logoLight);
}
