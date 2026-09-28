import {css} from 'lit';

/**
 * Functions Layout Component Styles
 *
 * Two-column layout: left drawer (function tree) + right main area (debugger).
 * Colors use project Tokens (--rtc-color-*) to ensure dual-theme adaptation.
 */
export const styles = css`
    :host {
        display: flex;
        height: 100%;
        width: 100%;
        overflow: hidden;
        background: var(--rtc-color-bg);
        font-family: var(--rtc-font-family-base);
        font-size: var(--rtc-font-size-base);
        color: var(--rtc-color-text);
        position: relative;
    }

    /* Function tree drawer width */
    rtc-drawer {
        --rtc-drawer-width: 240px;
    }

    .main {
        flex: 1;
        overflow: hidden;
        min-width: 0;
    }
`;
