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
 *
 * ## name 命名规范
 * 路由 `name` 字段统一使用 **kebab-case**（小写字母 + 连字符），例如：
 * - ✅ 'rtc-users'、'audit-logs'、'go-runtime'
 * - ❌ 'rtcUsers'、'AuditLogs'、'goRuntime'
 *
 * name 同时作为 i18n key（`menu.<name>`）和 URL 路径片段的一部分，
 * 保持 kebab-case 确保命名、URL、国际化 key 三者一致。
 *
 * ## 重定向策略
 * 本配置中存在两种重定向方式，选择依据如下：
 *
 * 1. **静态 redirect**：用于默认子页面固定的场景
 *    - 示例：`/dashboard` → `/dashboard/grafana`（所有用户看到的默认页面相同）
 *    - 优点：简单、性能更好（配置层面完成，无需运行时判断）
 *    - 使用场景：/dashboard、/rtc-users、/account 等模块
 *
 * 2. **动态 component**：用于需要根据用户权限动态决定的场景
 *    - 示例：`/system` → 根据权限选择 users/audit-logs/configs 等
 *    - 优点：灵活性高，可根据用户角色/权限动态选择默认页面
 *    - 使用场景：/system（参见 src/pages/system/index.tsx 的权限判断逻辑）
 *    - 实现：使用 `component: './system/index'` 而非 `redirect`，在组件内部判断权限
 *
 * 选择原则：
 * - 如果默认子页面对所有用户一致 → 使用静态 redirect
 * - 如果需要根据权限/角色动态决定 → 使用动态 component
 *
 * ## 根路由（/）处理策略
 * 根路径 `/` 未在本配置中定义，而是由 `src/app.tsx` 的 `onPageChange()` 动态处理：
 * - 未认证用户：重定向到 `/user/login`
 * - 已认证用户：根据权限动态选择默认页面（参见 `redirectByPermissions()`）
 *
 * 为何不在路由配置中定义 `/`：
 * - 需要访问用户权限信息（access 对象），路由配置无法表达
 * - 需要根据认证状态做不同处理，静态 redirect 无法满足
 *
 * 参见：src/app.tsx 的 onPageChange 实现
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
        // Note: No icon field needed — layout: false means no menu/sidebar is rendered
      },
      {
        path: '/user/register',
        name: 'register',
        component: './user/register',
      },
      {
        path: '/user/register-result',
        name: 'register-result',
        component: './user/register-result',
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
        // NOTE: No access field needed — inherits 'canDashboardView' from parent /dashboard
        routes: [
          {
            path: '/dashboard/grafana',
            redirect: '/dashboard/grafana/rtc-agent',
          },
          /**
           * Grafana 子路由设计说明：
           * - 这些子路由不配置 component，因为父路由的 component (./dashboard/container)
           *   已经通过 iframe 缓存策略统一管理所有 dashboard 的加载和显示
           * - 子路由的 name 字段用于生成侧边栏菜单项
           * - 子路由的 path 用于 URL 定位和 CSS 可见性控制
           * - 具体实现参见 src/pages/dashboard/container.tsx 的 DASHBOARD_CONFIGS
           */
          {
            name: 'rtc-agent',
            path: '/dashboard/grafana/rtc-agent',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
          },
          {
            name: 'go-runtime',
            path: '/dashboard/grafana/go-runtime',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
          },
          {
            name: 'http-server',
            path: '/dashboard/grafana/http-server',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
          },
          {
            // NOTE: path 使用 `-overview` 后缀是为了与 Grafana dashboard 的实际名称保持一致
            // Grafana dashboard 列表中的显示名称为 "Error Feedback Overview"
            // 这种命名方式确保 URL 路径与 Grafana 内部标识符的可读性一致
            name: 'error-feedback',
            path: '/dashboard/grafana/error-feedback-overview',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
          },
          {
            // NOTE: path 使用 `-overview` 后缀，与 Grafana dashboard 显示名称保持一致
            name: 'logs',
            path: '/dashboard/grafana/logs-overview',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
          },
          {
            // NOTE: path 使用 `-overview` 后缀，与 Grafana dashboard 显示名称保持一致
            name: 'oss3',
            path: '/dashboard/grafana/oss3-overview',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
          },
          {
            // NOTE: path 使用 `-overview` 后缀，与 Grafana dashboard 显示名称保持一致
            name: 'minio',
            path: '/dashboard/grafana/minio-overview',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
          },
          {
            // NOTE: path 使用 `system-health-watchdog`，与 Grafana dashboard 显示名称保持一致
            name: 'health-watchdog',
            path: '/dashboard/grafana/system-health-watchdog',
            // 由父路由 ./dashboard/container 通过 DASHBOARD_CONFIGS 渲染
            // 参见 src/pages/dashboard/container.tsx
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
    // 设计决策：显式设置 access 字段，统一控制整个系统管理模块的访问权限。
    // 子路由可进一步细化权限（如 canAdminUserView、canAuditLogView），
    // 但父级 access 作为第一道门槛，确保无权限用户完全不可见该菜单。
    access: 'canSystemView',
    routes: [
      // /system 使用动态重定向（component: './system/index'），因为需要根据用户权限
      // 决定默认子页面（如 admin 用户默认进入 users，audit 用户默认进入 audit-logs）。
      // 其他路由（/dashboard, /rtc-users, /account）使用静态 redirect，因为默认子页面固定。
      // 参见 src/pages/system/index.tsx 的权限判断逻辑。
      {
        path: '/system',
        component: './system/index',
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
  // Account pages: intentionally no `access` field.
  // 设计决策：任何已认证用户都可查看自己的个人资料和设置，无需 RBAC 权限控制。
  // 安全性由 app.tsx 的 onPageChange() 保证：未登录用户会被重定向到 /user/login。
  // 这与 /chatbot 路由的设计一致 — 认证即授权，无需额外权限守卫。
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
  // Chatbot: AI assistant accessible to all authenticated users.
  // 不设置 `access` 字段 — 安全由 app.tsx 的 onPageChange() 统一保证：
  // onPageChange 在路由切换时检查登录态，未登录用户会被重定向到 /user/login。
  // 因此 chatbot 仅对已登录用户可见，无需额外的 RBAC 权限守卫。
  {
    path: '/chatbot',
    name: 'chatbot',
    icon: 'robot',
    component: './chatbot',
  },
  /**
   * RTC Agent 开发者工具（仅管理员可访问）
   *
   * 这两个页面是 RTC Agent 组件的内部调试和诊断工具，用于开发和运维场景：
   *
   * - rtc-agent-test: 功能测试页面，用于验证 RTC Agent 的各项功能是否正常工作
   *   （如 IndexedDB 虚拟文件系统、WebSocket 连接、Worker 通信等）
   *
   * - rtc-agent-diagnose: 诊断页面，用于收集和显示系统运行时的诊断信息
   *   （如日志级别调整、性能指标查看、错误追踪等）
   *
   * 设计决策：
   * - 这两个页面仅对管理员可见（access: 'canAdmin'），因为它们涉及底层系统调试
   * - 路由放置在根级别（而非 system 子路由），是为了方便通过 URL 直接访问
   * - 这些页面不应出现在常规用户的菜单中，也不应被普通用户使用
   *
   * 参见：
   * - src/pages/rtc-agent-test/index.tsx
   * - src/pages/rtc-agent-diagnose/index.tsx
   */
  {
    path: '/rtc-agent-test',
    name: 'rtc-agent-test',
    icon: 'experiment',
    component: './rtc-agent-test',
    access: 'canAdmin',
  },
  {
    path: '/rtc-agent-diagnose',
    name: 'rtc-agent-diagnose',
    icon: 'bug',
    component: './rtc-agent-diagnose',
    access: 'canAdmin',
  },
  // 异常页面：
  // - 403 页面：用户无任何权限时由 app.tsx 的 onPageChange 重定向
  // - 404 页面：未匹配的路由
  // - 500 页面：服务器错误
  {
    path: '/exception/403',
    name: '403',
    layout: false,
    component: './exception/403',
  },
  {
    path: '/exception/500',
    name: '500',
    layout: false,
    component: './exception/500',
  },
  {
    component: './exception/404',
    path: './*',
    layout: false,
  },
];
