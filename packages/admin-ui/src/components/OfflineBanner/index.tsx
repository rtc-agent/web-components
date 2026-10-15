import { getIntl } from '@umijs/max';
import { Alert, theme } from 'antd';
import { useSyncExternalStore } from 'react';

const subscribeOnlineStatus = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};

const getOnlineStatus = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine;

/**
 * Offline banner component.
 *
 * Fixed-position alert displayed at the top of the viewport when the user is offline.
 * Uses theme tokens for background color to support both light and dark modes.
 *
 * z-index layering strategy (see CLAUDE.md / design system tokens):
 * - Page content: 0-100
 * - Sticky headers/nav: 100-500
 * - Offline banner: 900 (above page content, below overlays)
 * - GlobalLoadingOverlay: token.zIndexPopupBase (typically 1000)
 * - Drawer: 1000
 * - Modal: 1000+
 *
 * safe-area-inset-top is used to respect device notches (e.g., iPhone).
 */
const OfflineBanner: React.FC = () => {
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatus,
    () => true,
  );
  const { token } = theme.useToken();

  if (isOnline) return null;

  // Try to use intl, fallback to plain text if Intl provider is not available
  let title = 'You are currently offline. Some features may be unavailable.';
  try {
    const intl = getIntl();
    title = intl.formatMessage({
      id: 'app.network.offline',
      defaultMessage: title,
    });
  } catch (_e) {
    // Intl provider not available, use plain text fallback
  }

  return (
    <Alert
      type="warning"
      showIcon
      closable={false}
      style={{
        position: 'fixed',
        top: 'env(safe-area-inset-top, 8px)',
        left: 8,
        right: 8,
        margin: '0 auto',
        // Use theme token for warning background to support dark mode
        backgroundColor: token.colorWarningBg,
        borderColor: token.colorWarningBorder,
        // z-index 900: above page content but below GlobalLoadingOverlay (zIndexPopupBase ~1000)
        // and modal/drawer layers (1000+). See component JSDoc for layering strategy.
        zIndex: 900,
      }}
      message={title}
    />
  );
};

export default OfflineBanner;
