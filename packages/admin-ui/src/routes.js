import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Application Router Configuration
 *
 * Defines all application routes using react-router-dom.
 * Routes are organized with a main layout for authenticated pages
 * and separate routes for public pages like login.
 */
import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from '@/layouts/index';
import LoginPage from '@/pages/login/index';
import DashboardPage from '@/pages/dashboard/index';
import ProtectedRoute from '@/components/ProtectedRoute';
const routes = [
    {
        path: '/login',
        element: _jsx(LoginPage, {}),
    },
    {
        path: '/',
        element: (_jsx(ProtectedRoute, { children: _jsx(MainLayout, {}) })),
        children: [
            {
                index: true,
                element: _jsx(Navigate, { to: "/dashboard", replace: true }),
            },
            {
                path: 'dashboard',
                element: _jsx(DashboardPage, {}),
            },
        ],
    },
    {
        path: '*',
        element: _jsx(Navigate, { to: "/dashboard", replace: true }),
    },
];
export const router = createBrowserRouter(routes);
//# sourceMappingURL=routes.js.map