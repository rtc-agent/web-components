// src/pages/chatbot/style.ts
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  layout: css`
    display: flex;
    flex: 1;
    overflow: hidden;
  `,

  sidebar: css`
    width: 260px;
    background: ${token.colorBgContainer};
    border-right: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    overflow: hidden;

    @media (max-width: 768px) {
      width: 200px;
    }

    @media (max-width: 576px) {
      width: 100%;
      position: absolute;
      left: -100%;
      z-index: ${token.zIndexPopupBase};
      transition: left 0.3s ease;

      &.open {
        left: 0;
      }
    }
  `,

  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: ${token.colorBgContainer};
  `,

  messages: css`
    flex: 1;
    overflow-y: auto;
    padding: ${token.paddingMD}px;
    display: flex;
    flex-direction: column;
    align-items: center;

    > * {
      width: 100%;
    }
  `,

  footer: css`
    padding: ${token.paddingMD}px;
    border-top: 1px solid ${token.colorBorderSecondary};
    display: flex;
    justify-content: center;
  `,

  footerCenter: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: ${token.paddingLG}px;
    gap: 32px;
    margin-top: -10%;
  `,

  welcomeTitle: css`
    font-size: 32px;
    font-weight: 600;
    color: ${token.colorText};
    text-align: center;
  `,

  cursor: css`
    animation: chatbot-blink 0.8s step-end infinite;

    @keyframes chatbot-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `,

  aiAvatar: css`
    background: transparent;
    font-size: ${token.fontSizeHeading3}px;
    display: flex;
    align-items: center;
    justify-content: center;
  `,

  mobileMenuButton: css`
    position: absolute;
    top: ${token.paddingMD}px;
    left: ${token.paddingMD}px;
    z-index: ${token.zIndexPopupBase + 1};
    display: none;

    @media (max-width: 576px) {
      display: block;
    }
  `,

  messageContainer: css`
    max-width: min(940px, 100%);
    width: 100%;
  `,
}));
