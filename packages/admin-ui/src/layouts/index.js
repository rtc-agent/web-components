import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Space, Typography } from 'antd';
import { DashboardOutlined, RobotOutlined, LogoutOutlined, UserOutlined, } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
const { Header, Sider, Content } = Layout;
const { Text } = Typography;
const MainLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout } = useAuthStore();
    const handleLogout = async () => {
        await logout();
        navigate('/login', { replace: true });
    };
    // Determine selected menu key from current path
    const getSelectedKey = () => {
        if (location.pathname.startsWith('/dashboard')) {
            return 'dashboard';
        }
        if (location.pathname.startsWith('/demo')) {
            return 'demo';
        }
        return 'dashboard';
    };
    const menuItems = [
        {
            key: 'dashboard',
            icon: _jsx(DashboardOutlined, {}),
            label: 'Dashboard',
            onClick: () => navigate('/dashboard'),
        },
        {
            key: 'demo',
            icon: _jsx(RobotOutlined, {}),
            label: 'Demo',
            onClick: () => navigate('/demo'),
        },
    ];
    return (_jsxs(Layout, { style: { minHeight: '100vh' }, children: [_jsxs(Sider, { breakpoint: "lg", collapsedWidth: 80, style: { background: '#fff' }, children: [_jsxs("div", { style: logoStyle, children: [_jsx(RobotOutlined, { style: { fontSize: 24, color: '#1890ff' } }), _jsx(Text, { strong: true, style: { marginLeft: 8, fontSize: 16 }, children: "RTC Agent" })] }), _jsx(Menu, { mode: "inline", selectedKeys: [getSelectedKey()], items: menuItems, style: { borderRight: 0 } })] }), _jsxs(Layout, { children: [_jsx(Header, { style: headerStyle, children: _jsxs(Space, { size: "middle", children: [_jsx(Avatar, { icon: _jsx(UserOutlined, {}), src: user?.avatar_url, style: { backgroundColor: '#1890ff' } }), _jsx(Text, { children: user?.name || user?.email || 'Admin' }), _jsx(Button, { type: "text", icon: _jsx(LogoutOutlined, {}), onClick: handleLogout, children: "Logout" })] }) }), _jsx(Content, { style: contentStyle, children: _jsx(Outlet, {}) })] })] }));
};
// ========== Styles ==========
const logoStyle = {
    height: 64,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    borderBottom: '1px solid #f0f0f0',
};
const headerStyle = {
    background: '#fff',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderBottom: '1px solid #f0f0f0',
    height: 64,
};
const contentStyle = {
    padding: 0,
    background: '#fff',
    overflow: 'hidden',
};
export default MainLayout;
//# sourceMappingURL=index.js.map