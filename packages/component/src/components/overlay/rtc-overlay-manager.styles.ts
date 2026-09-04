import {css} from 'lit';

export const styles = css`
  :host {
    display: block;
    position: absolute;
    inset: 0;
    z-index: var(--rtc-z-overlay);
    pointer-events: none;
  }

  .panel-host {
    pointer-events: auto;
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;
