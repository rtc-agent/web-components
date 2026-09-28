/**
 * Functions Layout Component
 *
 * Two-column layout for the Function Debugger:
 * - Left: drawer with function tree (sidebar)
 * - Right: function debugger (main content)
 *
 * Follows the same pattern as settings-layout and chat-layout.
 *
 * @element rtc-functions-layout
 *
 * @attr {string} [theme=system] - Theme: 'light' | 'dark' | 'system'
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {styles} from './rtc-functions-layout.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';

import '../drawer/rtc-drawer.js';
import '../function-tree/rtc-function-tree.js';
import '../function-debugger/rtc-function-debugger.js';

@customElement('rtc-functions-layout')
export class RtcFunctionsLayout extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /** delegatesFocus: true — supports keyboard focus delegation */
    static shadowRootOptions = {
        ...LitElement.shadowRootOptions,
        delegatesFocus: true,
    };

    /** Theme property */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /**
     * Whether the function tree drawer is visible
     *
     * Passed through from parent rtc-agent based on ActivityController.sidebarVisible.
     * Uses <rtc-drawer> overlay drawer mode, does not push the main content area.
     */
    @property({type: Boolean, attribute: false})
    sidebarVisible = false;

    render() {
        return html`
            <!-- Function tree drawer (overlay mode, does not push main content area) -->
            <rtc-drawer ?open=${this.sidebarVisible}>
                <rtc-function-tree theme=${this.theme}></rtc-function-tree>
            </rtc-drawer>
            <div class="main">
                <rtc-function-debugger theme=${this.theme}></rtc-function-debugger>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-functions-layout': RtcFunctionsLayout;
    }
}
