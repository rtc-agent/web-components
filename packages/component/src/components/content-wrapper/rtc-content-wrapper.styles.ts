import {css} from 'lit';

export const styles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    position: relative;
    z-index: var(--rtc-z-content);
    overflow: hidden;
  }
`;
