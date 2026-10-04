/**
 * Application Router Configuration
 *
 * Defines all application routes using react-router-dom.
 * Routes are organized with a main layout for authenticated pages
 * and separate routes for public pages like login.
 */

import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import type { Router } from '@remix-run/router';
import MainLayout from '@/layouts/index';
import LoginPage from '@/pages/login/index';
import DashboardPage from '@/pages/dashboard/index';
import ProtectedRoute from '@/components/ProtectedRoute';

const routes: RouteObject[] = [
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <DashboardPage />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/dashboard" replace />,
  },
];

export const router: Router = createBrowserRouter(routes);
