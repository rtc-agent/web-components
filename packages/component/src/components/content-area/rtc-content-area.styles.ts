import {css} from 'lit';

export const styles = css`
  :host {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .content-container {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
`;
