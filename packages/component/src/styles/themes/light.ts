import {css} from 'lit';

/**
 * Light Theme — VS Code-inspired light color scheme.
 *
 * SINGLE SOURCE OF TRUTH for color tokens. All --rtc-color-* variables
 * are defined here (and in dark.ts). The base tokens.ts file only defines
 * structural tokens (spacing, typography, shadows, etc.).
 *
 * Applied by default on `:host`. Override by setting theme="dark" attribute.
 */
export const lightTheme = css`
  :host,
  :host([theme='light']) {
    --rtc-color-primary: #007acc;
    --rtc-color-primary-hover: #005a9e;
    --rtc-color-primary-active: #004578;

    --rtc-color-text: #333333;
    --rtc-color-text-secondary: #666666;
    --rtc-color-text-tertiary: #999999;
    --rtc-color-text-inverse: #ffffff;

    --rtc-color-bg: #ffffff;
    --rtc-color-bg-secondary: #f5f5f5;
    --rtc-color-bg-tertiary: #e8e8e8;
    --rtc-color-bg-hover: #f0f0f0;
    --rtc-color-bg-active: #e0e0e0;

    --rtc-color-border: #e0e0e0;
    --rtc-color-border-hover: #d0d0d0;
    --rtc-color-border-focus: #007acc;

    --rtc-color-success: #4caf50;
    --rtc-color-warning: #ff9800;
    --rtc-color-error: #f44336;
    --rtc-color-info: #2196f3;

    /* Overlay/backdrop */
    --rtc-color-backdrop: rgba(0, 0, 0, 0.3);
  }
`;
