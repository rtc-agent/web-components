/**
 * Simple Routes Configuration (Template Backup)
 *
 * PURPOSE:
 * This file is a backup template used by the "simplify" script (scripts/simple.js).
 * It contains a minimal route configuration for users who want to strip down the
 * full-featured admin-ui to a basic starter template.
 *
 * USAGE:
 * - Run `pnpm run simple` to replace routes.ts with this simplified version
 * - The script will:
 *   1. Delete feature-rich page directories (dashboard, form, list, profile, etc.)
 *   2. Replace routes.ts with this file's content
 *   3. Remove related dependencies from package.json
 *   4. Delete this file and the script itself (irreversible operation)
 *
 * WARNING:
 * - This operation is DESTRUCTIVE and IRREVERSIBLE
 * - Always commit your changes before running `pnpm run simple`
 * - This file is intentionally kept in the repository as a template
 *
 * CONTENTS:
 * The routes below represent a minimal admin setup with:
 * - User authentication (login)
 * - Welcome page
 * - Basic admin page (with canAdmin access control)
 * - Query table example
 * - 404 handler
 *
 * All advanced features (dashboard, RTC users, system management, account, chatbot)
 * are removed in the simplified version.
 */
export default [
  {
    path: '/user',
    layout: false,
    routes: [
      {
        name: '登录',
        path: '/user/login',
        component: './user/login',
      },
    ],
  },
  {
    path: '/welcome',
    name: '欢迎',
    icon: 'smile',
    component: './Welcome',
  },
  {
    path: '/admin',
    name: '管理页',
    icon: 'crown',
    access: 'canAdmin',
    routes: [
      {
        path: '/admin',
        redirect: '/admin/sub-page',
      },
      {
        path: '/admin/sub-page',
        name: '二级管理页',
        component: './Admin',
      },
    ],
  },
  {
    name: '查询表格',
    icon: 'table',
    path: '/list',
    component: './table-list',
  },
  {
    path: '/',
    redirect: '/welcome',
  },
  {
    component: './exception/404',
    layout: false,
    path: './*',
  },
];
