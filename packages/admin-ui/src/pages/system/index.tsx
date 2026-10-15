import { history, useAccess } from '@umijs/max';
import { Skeleton } from 'antd';
import React, { useEffect, useRef } from 'react';
import { getSystemSubPageRedirectTarget } from '@/constants/permission-priority';

/**
 * System Management Index Page
 * Intelligently redirects to the first accessible page based on admin permissions.
 *
 * Behavior:
 * - Redirects to first accessible sub-page based on priority (users > roles > permissions > ...)
 * - Redirects to /exception/403 if no admin permissions are available
 * - Shows loading skeleton while access object is being loaded (prevents race conditions)
 *
 * Note: Uses centralized redirect to /exception/403 for consistency with the rest of the app
 * (same 403 page used by app.tsx's root redirect and other permission violations).
 */
const SystemIndexPage: React.FC = () => {
  const access = useAccess();
  const hasRedirected = useRef(false);

  useEffect(() => {
    // Prevent multiple redirects if access object changes
    if (hasRedirected.current) {
      return;
    }

    // Race condition fix: wait until access.canSystemView is fully loaded
    // access values start as undefined during initialization
    if (access.canSystemView === undefined) {
      return;
    }

    // Use centralized permission priority configuration to determine target
    const targetPath = getSystemSubPageRedirectTarget(access);

    if (targetPath) {
      history.replace(targetPath);
      hasRedirected.current = true;
    } else if (!access.canSystemView) {
      // No admin permissions - redirect to 403 page for consistency
      // (matches app.tsx's behavior when no top-level permission matches)
      history.replace('/exception/403');
      hasRedirected.current = true;
    }
    // If canSystemView is true but no specific sub-permission is true,
    // the user will see the loading skeleton briefly until permissions are fully evaluated.
  }, [access]);

  // Show loading skeleton while checking permissions
  return <Skeleton active style={{ padding: 24 }} />;
};

export default SystemIndexPage;
