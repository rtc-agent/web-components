import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Application Root Component
 *
 * Sets up the RouterProvider and initializes authentication state on mount.
 */
import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import { router } from '@/routes';
import { useAuthStore } from '@/stores/authStore';
const App = () => {
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
    return (_jsx(ConfigProvider, { theme: {
            algorithm: theme.defaultAlgorithm,
            token: {
                colorPrimary: '#1890ff',
                borderRadius: 6,
            },
        }, children: _jsx(AntdApp, { children: _jsx(RouterProvider, { router: router }) }) }));
};
export default App;
//# sourceMappingURL=App.js.map