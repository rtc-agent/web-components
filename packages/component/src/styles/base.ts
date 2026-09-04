import {css} from 'lit';

/**
 * Base Styles — CSS reset, font defaults, and motion preferences.
 *
 * Included once in the root <rtc-agent> component's styles array.
 * All child components inherit these via Shadow DOM.
 */
export const baseStyles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :host {
    font-family: var(--rtc-font-family-base);
    font-size: var(--rtc-font-size-base);
    line-height: var(--rtc-line-height-base);
    color: var(--rtc-color-text);
    background: var(--rtc-color-bg);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :host([hidden]) {
    display: none !important;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
    }
  }
`;
