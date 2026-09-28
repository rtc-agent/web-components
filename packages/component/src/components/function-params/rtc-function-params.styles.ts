import {css} from 'lit';

/**
 * Function Params Component Styles
 *
 * JSON parameter editor with monospace font and syntax error highlighting.
 * Colors use project Tokens (--rtc-color-*) to ensure dual-theme adaptation.
 */
export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        gap: var(--rtc-spacing-xs);
    }

    .params-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--rtc-spacing-xs);
    }

    .params-label {
        font-size: var(--rtc-font-size-xs);
        font-weight: var(--rtc-font-weight-bold);
        color: var(--rtc-color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.02em;
    }

    .params-error {
        font-size: var(--rtc-font-size-xs);
        color: var(--rtc-color-error);
    }

    .params-editor {
        position: relative;
        display: flex;
        border: 1px solid var(--rtc-color-border);
        border-radius: var(--rtc-border-radius-sm);
        overflow: hidden;
        transition: border-color var(--rtc-transition-duration) var(--rtc-transition-timing);
    }

    .params-editor:focus-within {
        border-color: var(--rtc-color-border-focus);
    }

    .params-editor.invalid {
        border-color: var(--rtc-color-error);
    }

    .line-numbers {
        flex-shrink: 0;
        padding: var(--rtc-spacing-sm) 0;
        background: var(--rtc-color-bg-tertiary);
        color: var(--rtc-color-text-tertiary);
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-sm);
        line-height: var(--rtc-line-height-base);
        text-align: right;
        user-select: none;
        min-width: 32px;
        overflow: hidden;
    }

    .line-numbers span {
        display: block;
        padding: 0 var(--rtc-spacing-sm);
    }

    textarea {
        flex: 1;
        padding: var(--rtc-spacing-sm);
        background: var(--rtc-color-bg-secondary);
        color: var(--rtc-color-text);
        border: none;
        outline: none;
        font-family: var(--rtc-font-family-mono);
        font-size: var(--rtc-font-size-sm);
        line-height: var(--rtc-line-height-base);
        resize: vertical;
        min-height: 100px;
        max-height: 400px;
        tab-size: 2;
    }

    textarea::placeholder {
        color: var(--rtc-color-text-tertiary);
    }
`;
