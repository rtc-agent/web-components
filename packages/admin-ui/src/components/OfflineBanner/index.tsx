import { getIntl } from '@umijs/max';
import { Alert } from 'antd';
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

const OfflineBanner: React.FC = () => {
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatus,
    () => true,
  );

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
        zIndex: 999,
      }}
      message={title}
    />
  );
};

export default OfflineBanner;
