/**
 * Route Guard - Protected Route
 *
 * HOC that protects routes requiring authentication.
 * Redirects to /login if the user is not authenticated.
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Protected route wrapper.
 * Checks authentication state and redirects to login if not authenticated.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const location = useLocation();
  const { isAuthenticated, isLoading } = useAuthStore();

  // Show loading spinner while auth state is being initialized
  if (isLoading) {
    return (
      <div style={loadingStyle}>
        <Spin size="large" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

// ========== Styles ==========

const loadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
};

export default ProtectedRoute;
