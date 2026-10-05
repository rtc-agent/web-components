import { history, useAccess } from '@umijs/max';
import React, { useEffect } from 'react';

/**
 * 系统管理首页
 * 根据管理员权限智能重定向到第一个有权限的页面
 */
const SystemIndexPage: React.FC = () => {
  const access = useAccess();

  useEffect(() => {
    // 按优先级检查权限，重定向到第一个有权限的页面
    if (access.canAdminUserView) {
      history.replace('/system/users');
    } else if (access.canAdminRoleView) {
      history.replace('/system/roles');
    } else if (access.canPermissionView) {
      history.replace('/system/permissions');
    } else if (access.canAuditLogView) {
      history.replace('/system/audit-logs');
    } else {
      // 如果没有任何权限，重定向到欢迎页
      history.replace('/welcome');
    }
  }, [access]);

  return null;
};

export default SystemIndexPage;
