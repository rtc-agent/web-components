import { history, useAccess, useIntl } from '@umijs/max';
import { Button, Result, Skeleton } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { getSystemSubPageRedirectTarget } from '@/constants/permission-priority';

/**
 * System Management Index Page
 * Intelligently redirects to the first accessible page based on admin permissions.
 * If no admin permissions are available, displays a 403 Forbidden page with a helpful message.
 */
const SystemIndexPage: React.FC = () => {
  const access = useAccess();
  const intl = useIntl();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const hasRedirected = useRef(false);

  useEffect(() => {
    // Prevent multiple redirects if access object changes
    if (hasRedirected.current) {
      return;
    }

    // Use centralized permission priority configuration to determine target
    const targetPath = getSystemSubPageRedirectTarget(access);

    if (targetPath) {
      history.replace(targetPath);
      hasRedirected.current = true;
    } else if (!access.canSystemView) {
      // No admin permissions - show 403 page instead of silent redirect
      // Note: Only set hasPermission to false if we're sure the user has no system access
      // (canSystemView is false). This avoids showing 403 during permission loading.
      setHasPermission(false);
    }
    // If canSystemView is true but no specific sub-permission is true,
    // the user will see the loading skeleton briefly until permissions are fully evaluated.
  }, [access]);

  // Show loading skeleton while checking permissions
  if (hasPermission === null) {
    return <Skeleton active style={{ padding: 24 }} />;
  }

  // Show 403 Forbidden page if no admin permissions
  if (!hasPermission) {
    return (
      <Result
        status="403"
        title="403"
        subTitle={intl.formatMessage({
          id: 'pages.system.noPermission',
          defaultMessage:
            'Sorry, you do not have system management permissions.',
        })}
        extra={
          <Button type="primary" onClick={() => history.push('/')}>
            {intl.formatMessage({ id: 'pages.403.backHome' })}
          </Button>
        }
      />
    );
  }

  return <Skeleton active style={{ padding: 24 }} />;
};

export default SystemIndexPage;
