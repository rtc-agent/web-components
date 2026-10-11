/**
 * @name umi 的路由配置
 * @description 只支持 path,component,routes,redirect,wrappers,name,icon 的配置
 * @param path  path 只支持两种占位符配置，第一种是动态参数 :id 的形式，第二种是 * 通配符，通配符只能出现路由字符串的最后。
 * @param component 配置 location 和 path 匹配后用于渲染的 React 组件路径。可以是绝对路径，也可以是相对路径，如果是相对路径，会从 src/pages 开始找起。
 * @param routes 配置子路由，通常在需要为多个路径增加 layout 组件时使用。
 * @param redirect 配置路由跳转
 * @param wrappers 配置路由组件的包装组件，通过包装组件可以为当前的路由组件组合进更多的功能。 比如，可以用于路由级别的权限校验
 * @param name 配置路由的标题，默认读取国际化文件 menu.ts 中 menu.xxxx 的值，如配置 name 为 login，则读取 menu.ts 中 menu.login 的取值作为标题
 * @param icon 配置路由的图标，取值参考 https://ant.design/components/icon-cn， 注意去除风格后缀和大小写，如想要配置图标为 <StepBackwardOutlined /> 则取值应为 stepBackward 或 StepBackward，如想要配置图标为 <UserOutlined /> 则取值应为 user 或者 User
 * @doc https://umijs.org/docs/guides/routes
 */
export default [
  {
    path: '/user',
    layout: false,
    routes: [
      {
        path: '/user/login',
        name: 'login',
        component: './user/login',
      },
      {
        path: '/user',
        redirect: '/user/login',
      },
    ],
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    icon: 'dashboard',
    component: './dashboard/container',
    access: 'canDashboardView',
    routes: [
      // TODO: jaeger/pyroscope dashboards not yet implemented
      // {
      //   name: 'jaeger',
      //   icon: 'BugOutlined',
      //   path: '/dashboard/jaeger',
      //   access: 'canDashboardView',
      // },
      // {
      //   name: 'pyroscope',
      //   icon: 'profile',
      //   path: '/dashboard/pyroscope',
      //   access: 'canDashboardView',
      // },
      {
        path: '/dashboard',
        redirect: '/dashboard/grafana',
      },
      {
        name: 'grafana',
        icon: 'lineChart',
        path: '/dashboard/grafana',
        access: 'canDashboardView',
        routes: [
          {
            path: '/dashboard/grafana',
            redirect: '/dashboard/grafana/rtc-agent',
          },
          {
            name: 'rtc-agent',
            path: '/dashboard/grafana/rtc-agent',
            access: 'canDashboardView',
          },
          {
            name: 'go-runtime',
            path: '/dashboard/grafana/go-runtime',
            access: 'canDashboardView',
          },
          {
            name: 'http-server',
            path: '/dashboard/grafana/http-server',
            access: 'canDashboardView',
          },
          {
            name: 'error-feedback',
            path: '/dashboard/grafana/error-feedback-overview',
            access: 'canDashboardView',
          },
          {
            name: 'logs',
            path: '/dashboard/grafana/logs-overview',
            access: 'canDashboardView',
          },
          {
            name: 'oss3',
            path: '/dashboard/grafana/oss3-overview',
            access: 'canDashboardView',
          },
          {
            name: 'minio',
            path: '/dashboard/grafana/minio-overview',
            access: 'canDashboardView',
          },
          {
            name: 'health-watchdog',
            path: '/dashboard/grafana/system-health-watchdog',
            access: 'canDashboardView',
          },
        ],
      },
    ],
  },
  {
    path: '/rtc-users',
    name: 'rtc-users',
    icon: 'team',
    access: 'canRtcUsersMenu',
    routes: [
      {
        path: '/rtc-users',
        redirect: '/rtc-users/management',
      },
      {
        path: '/rtc-users/management',
        name: 'management',
        icon: 'user',
        component: './rtc-users/management',
        access: 'canRtcUserView',
      },
      {
        path: '/rtc-users/sessions',
        name: 'sessions',
        icon: 'message',
        component: './rtc-users/sessions',
        access: 'canRtcSessionView',
      },
      {
        path: '/rtc-users/messages',
        name: 'messages',
        icon: 'fileText',
        component: './rtc-users/messages',
        access: 'canRtcMessageView',
      },
    ],
  },
  {
    path: '/system',
    name: 'system',
    icon: 'setting',
    access: 'canSystemView',
    routes: [
      {
        path: '/system',
        component: './system/index',
        access: 'canSystemView',
      },
      {
        path: '/system/users',
        name: 'users',
        icon: 'user',
        component: './user/management',
        access: 'canAdminUserView',
      },
      {
        path: '/system/roles',
        name: 'roles',
        icon: 'team',
        component: './system/roles',
        access: 'canAdminRoleView',
      },
      {
        path: '/system/permissions',
        name: 'permissions',
        icon: 'safety',
        component: './system/permissions',
        access: 'canPermissionView',
      },
      {
        path: '/system/audit-logs',
        name: 'audit-logs',
        icon: 'fileText',
        component: './system/audit-logs',
        access: 'canAuditLogView',
      },
      {
        path: '/system/configs',
        name: 'configs',
        icon: 'setting',
        component: './system/configs',
        access: 'canServerConfigView',
      },
    ],
  },
  // Account pages: intentionally no `access` field - any authenticated user
  // can view their own profile and settings. No RBAC gating needed.
  {
    name: 'account',
    layout: false,
    icon: 'user',
    path: '/account',
    routes: [
      {
        path: '/account',
        redirect: '/account/center',
      },
      {
        name: 'center',
        icon: 'user',
        path: '/account/center',
        component: './account/center',
      },
      {
        name: 'settings',
        icon: 'setting',
        path: '/account/settings',
        component: './account/settings',
      },
    ],
  },
  // 异常页面：
  // - 403 页面：用户无任何权限时由 app.tsx 的 onPageChange 重定向
  // - 404 页面：未匹配的路由
  {
    path: '/exception/403',
    name: '403',
    layout: false,
    component: './exception/403',
  },
  {
    component: './exception/404',
    path: '/*',
  },
];
