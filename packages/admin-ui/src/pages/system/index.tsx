import { history, useAccess } from '@umijs/max';
import React, { useEffect } from 'react';

/**
 * System Management Index Page
 * Intelligently redirects to the first accessible page based on admin permissions
 */
const SystemIndexPage: React.FC = () => {
  const access = useAccess();

  useEffect(() => {
    // Check permissions in priority order, redirect to the first accessible page
    if (access.canAdminUserView) {
      history.replace('/system/users');
    } else if (access.canAdminRoleView) {
      history.replace('/system/roles');
    } else if (access.canPermissionView) {
      history.replace('/system/permissions');
    } else if (access.canAuditLogView) {
      history.replace('/system/audit-logs');
    } else if (access.canServerConfigView) {
      history.replace('/system/configs');
    } else {
      // If no permissions, redirect to dashboard
      history.replace('/dashboard');
    }
  }, [access]);

  return null;
};

export default SystemIndexPage;
