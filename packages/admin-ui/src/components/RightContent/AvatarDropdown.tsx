import {
  LogoutOutlined,
  SettingOutlined,
  SkinOutlined,
} from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Spin } from 'antd';
import React, { startTransition, useState } from 'react';
import { logout as apiLogout } from '@/services/admin-auth';
import { clearAuth, getRefreshToken } from '@/utils/auth-storage';
import { iframeCacheManager } from '@/utils/iframe-cache';
import { unmountRtcAgent } from '@/utils/rtc-agent-manager';
import HeaderDropdown from '../HeaderDropdown';
import ProfileSettingsModal from '../ProfileSettingsModal';

type GlobalHeaderRightProps = {
  children?: React.ReactNode;
};

const menuItems: MenuProps['items'] = [
  {
    key: 'settings',
    icon: <SettingOutlined />,
    label: '个人设置',
  },
  {
    key: 'theme',
    icon: <SkinOutlined />,
    label: '主题设置',
  },
  {
    type: 'divider' as const,
  },
  {
    key: 'logout',
    icon: <LogoutOutlined />,
    label: '退出登录',
  },
];

const loginOut = async () => {
  try {
    // 调用 admin-server 撤销 refresh_token
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      await apiLogout({ refresh_token: refreshToken });
    }
  } catch {
    // Local logout has already cleared user state; redirect should still proceed.
  }

  // 清除本地存储
  clearAuth();

  // 清除所有 iframe 缓存，避免登出后残留敏感页面（安全清理）
  iframeCacheManager.clear();

  // 销毁全局 RTC Agent 实例
  // 使用 rtc-agent-manager 确保状态一致
  unmountRtcAgent();

  const { search, pathname } = window.location;
  const urlParams = new URL(window.location.href).searchParams;
  const searchParams = new URLSearchParams({
    redirect: pathname + search,
  });
  const redirect = urlParams.get('redirect');
  if (window.location.pathname !== '/user/login' && !redirect) {
    history.replace({
      pathname: '/user/login',
      search: searchParams.toString(),
    });
  }
};

export const AvatarDropdown: React.FC<GlobalHeaderRightProps> = ({
  children,
}) => {
  const { initialState, setInitialState } = useModel('@@initialState');
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const onMenuClick: MenuProps['onClick'] = (event) => {
    const { key } = event;
    if (key === 'logout') {
      startTransition(() => {
        setInitialState((s) => ({ ...s, currentUser: undefined }));
      });
      loginOut();
      return;
    }
    if (key === 'theme') {
      setInitialState((s) => ({ ...s, settingDrawerOpen: true }));
      return;
    }
    if (key === 'settings') {
      setProfileModalOpen(true);
      return;
    }
    history.push(`/account/${key}`);
  };

  if (!initialState) {
    return <Spin size="small" />;
  }

  const { currentUser } = initialState;

  if (!currentUser) {
    return <Spin size="small" />;
  }

  return (
    <>
      <HeaderDropdown
        placement="bottomRight"
        menu={{
          selectedKeys: [],
          onClick: onMenuClick,
          items: menuItems,
        }}
        arrow
      >
        {children}
      </HeaderDropdown>

      <ProfileSettingsModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onSuccess={() => {
          setProfileModalOpen(false);
          // 刷新全局用户状态
          window.location.reload();
        }}
        initialValues={{
          name: currentUser?.name,
          email: currentUser?.email,
        }}
      />
    </>
  );
};
