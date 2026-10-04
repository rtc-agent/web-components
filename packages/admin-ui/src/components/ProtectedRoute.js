import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';
/**
 * Protected route wrapper.
 * Checks authentication state and redirects to login if not authenticated.
 */
const ProtectedRoute = ({ children }) => {
    const location = useLocation();
    const { isAuthenticated, isLoading } = useAuthStore();
    // Show loading spinner while auth state is being initialized
    if (isLoading) {
        return (_jsx("div", { style: loadingStyle, children: _jsx(Spin, { size: "large" }) }));
    }
    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return _jsx(Navigate, { to: "/login", state: { from: location }, replace: true });
    }
    return _jsx(_Fragment, { children: children });
};
// ========== Styles ==========
const loadingStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
};
export default ProtectedRoute;
//# sourceMappingURL=ProtectedRoute.js.map