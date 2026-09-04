import {css} from 'lit';

/**
 * Dark Theme — VS Code-inspired dark color scheme.
 *
 * SINGLE SOURCE OF TRUTH for dark mode color tokens. All --rtc-color-* variables
 * are defined here (and in light.ts for light mode). The base tokens.ts file only
 * defines structural tokens (spacing, typography, shadows, etc.).
 *
 * Activated by `theme="dark"` attribute on <rtc-agent>.
 * Only overrides color tokens; spacing/font/layout unchanged.
 */
export const darkTheme = css`
  :host([theme='dark']) {
    --rtc-color-primary: #007acc;
    --rtc-color-primary-hover: #1e8adc;
    --rtc-color-primary-active: #3a9ae8;

    --rtc-color-text: #cccccc;
    --rtc-color-text-secondary: #858585;
    --rtc-color-text-tertiary: #666666;
    --rtc-color-text-inverse: #1e1e1e;

    --rtc-color-bg: #1e1e1e;
    --rtc-color-bg-secondary: #252526;
    --rtc-color-bg-tertiary: #2d2d30;
    --rtc-color-bg-hover: #2a2d2e;
    --rtc-color-bg-active: #37373d;

    --rtc-color-border: #3c3c3c;
    --rtc-color-border-hover: #4c4c4c;
    --rtc-color-border-focus: #007acc;

    --rtc-color-success: #4caf50;
    --rtc-color-warning: #ff9800;
    --rtc-color-error: #f44336;
    --rtc-color-info: #2196f3;

    /* Overlay/backdrop */
    --rtc-color-backdrop: rgba(0, 0, 0, 0.6);
  }
`;
