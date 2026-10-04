/**
 * Main Application Layout
 *
 * Uses Ant Design's Layout component with a header containing logo, user info,
 * and logout button. The sidebar provides navigation between pages.
 */

import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Space, Typography } from 'antd';
import {
  DashboardOutlined,
  RobotOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const MainLayout: React.FC = () => {
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
      icon: <DashboardOutlined />,
      label: 'Dashboard',
      onClick: () => navigate('/dashboard'),
    },
    {
      key: 'demo',
      icon: <RobotOutlined />,
      label: 'Demo',
      onClick: () => navigate('/demo'),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={80}
        style={{ background: '#fff' }}
      >
        <div style={logoStyle}>
          <RobotOutlined style={{ fontSize: 24, color: '#1890ff' }} />
          <Text strong style={{ marginLeft: 8, fontSize: 16 }}>
            RTC Agent
          </Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={menuItems}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header style={headerStyle}>
          <Space size="middle">
            <Avatar
              icon={<UserOutlined />}
              src={user?.avatar_url}
              style={{ backgroundColor: '#1890ff' }}
            />
            <Text>{user?.name || user?.email || 'Admin'}</Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
            >
              Logout
            </Button>
          </Space>
        </Header>
        <Content style={contentStyle}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

// ========== Styles ==========

const logoStyle: React.CSSProperties = {
  height: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 16px',
  borderBottom: '1px solid #f0f0f0',
};

const headerStyle: React.CSSProperties = {
  background: '#fff',
  padding: '0 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  borderBottom: '1px solid #f0f0f0',
  height: 64,
};

const contentStyle: React.CSSProperties = {
  padding: 0,
  background: '#fff',
  overflow: 'hidden',
};

export default MainLayout;
