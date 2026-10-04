/**
 * Application Root Component
 *
 * Sets up the RouterProvider and initializes authentication state on mount.
 */

import React, { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import { router } from '@/routes';
import { useAuthStore } from '@/stores/authStore';

const App: React.FC = () => {
  const [isReady, setIsReady] = useState(false);
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    const initAuth = async () => {
      await initialize();
      setIsReady(true);
    };
    initAuth();
  }, [initialize]);

  // Don't render until auth initialization is complete
  if (!isReady) {
    return null;
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1890ff',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
