/**
 * Global Loading Overlay
 *
 * Displays a full-screen loading indicator during initial app state loading.
 * Used by getInitialState to provide visual feedback while fetching user info.
 *
 * Design decisions:
 * - Full-screen overlay: Prevents interaction during critical initialization
 * - Centered spinner: Clear visual feedback that app is loading
 * - Accessibility: Includes role="status" and aria-live="polite" for screen readers
 * - Theme-aware: Uses design tokens for consistent light/dark mode support
 * - Minimal: No logo/branding to keep initial load fast and avoid FOUC
 */

import { useIntl } from '@umijs/max';
import { Spin } from 'antd';
import { createStyles } from 'antd-style';

const useStyles = createStyles(({ token }) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: token.colorBgContainer,
    zIndex: token.zIndexPopupBase,
    gap: token.marginLG,
  },
  spinner: {
    '& .ant-spin-dot-item': {
      backgroundColor: token.colorPrimary,
    },
  },
  text: {
    color: token.colorTextSecondary,
    fontSize: token.fontSize,
  },
}));

interface GlobalLoadingOverlayProps {
  /** Optional custom loading message */
  message?: string;
}

const GlobalLoadingOverlay: React.FC<GlobalLoadingOverlayProps> = ({
  message,
}) => {
  const { styles } = useStyles();
  const intl = useIntl();
  const displayMessage =
    message ||
    intl.formatMessage({
      id: 'app.loading',
      defaultMessage: 'Loading...',
    });

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Application loading"
      className={styles.overlay}
    >
      <Spin size="large" className={styles.spinner} />
      <div className={styles.text}>{displayMessage}</div>
    </div>
  );
};

export default GlobalLoadingOverlay;
