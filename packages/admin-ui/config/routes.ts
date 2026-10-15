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
        // 注意：无需 icon 字段 — layout: false 表示不渲染菜单/侧边栏
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
    /**
     * Dashboard 子路由权限继承：
     *
     * Umi Max 自动将父路由的 `access` 字段继承给未显式设置 `access` 的子路由。
     *
     * 实现原理：
     * - 参见 src/.umi/plugin-access/index.tsx 的 useAccessMarkedRoutes() 函数
     * - 第 27-34 行：if (!accessCode && parentAccessCode) { accessCode = parentAccessCode; }
     *
     * 安全模型：
     * - 父路由 (/dashboard) 设置：access: 'canDashboardView'
     * - 所有子路由（grafana、rtc-agent 等）自动继承该权限
     * - 子路由无需显式设置 `access`，重复设置反而冗余
     *
     * 设计考量：
     * - 单一可信源：权限仅在父级定义一次
     * - 配置简洁：避免在 8+ 个子路由中重复声明
     * - 行为一致：所有 dashboard 子页面要求相同权限
     *
     * 注意：如果不同子页面需要不同权限，可在子路由上显式添加 `access` 字段。
     * 仅当子路由未指定 `access` 时，才会继承父级的权限。
     */
    access: 'canDashboardView',
    routes: [
      // TODO: jaeger/pyroscope 仪表板尚未实现
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
        // 继承父级的 'canDashboardView' 权限（详见父路由 JSDoc）
        routes: [
          {
            path: '/dashboard/grafana',
            redirect: '/dashboard/grafana/rtc-agent',
          },
          /**
           * Grafana 子路由设计说明：
           *
           * 渲染链路：/dashboard(component: ./dashboard/container) → 子路由(path 匹配)
           *
           * - 子路由不配置 component，因为 /dashboard 的 container 组件
           *   通过 iframe 缓存策略统一管理所有 dashboard 的加载和显示
           * - 子路由的 name 字段用于生成侧边栏菜单项
           * - 子路由的 path 用于 URL 定位和 CSS 可见性控制
           * - 具体实现参见 src/pages/dashboard/container.tsx 的 DASHBOARD_CONFIGS
           */
          {
            name: 'rtc-agent',
            path: '/dashboard/grafana/rtc-agent',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
          {
            name: 'go-runtime',
            path: '/dashboard/grafana/go-runtime',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
          {
            name: 'http-server',
            path: '/dashboard/grafana/http-server',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
          {
            // NOTE: path 使用 `-overview` 后缀是为了与 Grafana dashboard 的实际名称保持一致
            // Grafana dashboard 列表中的显示名称为 "Error Feedback Overview"
            // 这种命名方式确保 URL 路径与 Grafana 内部标识符的可读性一致
            name: 'error-feedback',
            path: '/dashboard/grafana/error-feedback-overview',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
          {
            // NOTE: path 使用 `-overview` 后缀，与 Grafana dashboard 显示名称保持一致
            name: 'logs',
            path: '/dashboard/grafana/logs-overview',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
          {
            // NOTE: path 使用 `-overview` 后缀，与 Grafana dashboard 显示名称保持一致
            name: 'oss3',
            path: '/dashboard/grafana/oss3-overview',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
          {
            // NOTE: path 使用 `-overview` 后缀，与 Grafana dashboard 显示名称保持一致
            name: 'minio',
            path: '/dashboard/grafana/minio-overview',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
          {
            // NOTE: path 使用 `system-health-watchdog`，与 Grafana dashboard 显示名称保持一致
            name: 'health-watchdog',
            path: '/dashboard/grafana/system-health-watchdog',
            // 由 /dashboard 的 container 组件通过 DASHBOARD_CONFIGS 渲染（参见 src/pages/dashboard/container.tsx）
          },
        ],
      },
    ],
  },
  {
    path: '/rtc-users',
    name: 'rtc-users',
    icon: 'team',
    /**
     * RTC 用户菜单权限模型：
     *
     * 父路由 (/rtc-users):
     * - access: 'canRtcUsersMenu' — 菜单可见性权限
     * - 作用：控制整个 /rtc-users 菜单是否显示
     *
     * 子路由 (/rtc-users/*):
     * - 每个子路由使用细粒度权限 (canRtcUserView, canRtcSessionView, canRtcMessageView)
     * - 作用：控制各子页面的访问权限
     * - 与 /dashboard 不同，这里显式设置子路由权限，因为各子页面需要独立的权限控制
     *
     * 与 /dashboard 的区别：
     * - /dashboard 所有子页面共享相同权限，使用父级继承模式
     * - /rtc-users 各子页面权限独立，需显式声明每个子路由的 access
     *
     * 参见：src/access.ts 中各权限的定义
     */
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
    /**
     * 权限层次结构：
     *
     * 父路由 (/system):
     * - access: 'canSystemView' — 组合权限（admin 角色 OR 任意 system 读权限）
     * - 作用：控制菜单可见性。如果为 false，整个 /system 菜单隐藏。
     * - 定义：src/access.ts（详见 canSystemView JSDoc 中的业务规则）
     *
     * 子路由 (/system/*):
     * - 每个子路由使用特定权限（canAdminUserView、canAuditLogView 等）
     * - 作用：控制 system 菜单内各子页面的访问权限
     * - 比父路由更严格 — 用户可能看到菜单，但不一定有权访问所有子页面
     *
     * 依赖关系：
     * - canSystemView 是所有子权限的超集
     * - 如果任意子权限为 true，则 canSystemView 必须为 true
     * - 但 canSystemView 为 true 时，所有子权限可能都为 false
     *   （例如：admin 角色但没有细粒度权限）
     *
     * 安全模型：
     * - 父路由作为"大门" — 控制菜单可见性
     * - 子路由作为"精细过滤器" — 控制各页面访问权限
     * - 这种两层模型防止未授权访问，同时保持清晰的菜单结构
     *
     * 相关文件：
     * - src/constants/permission-groups.ts: SYSTEM_MENU_PERMISSIONS 定义
     * - src/access.ts: canSystemView 实现
     * - src/pages/system/index.tsx: 基于权限的子页面路由
     */
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
  /**
   * 账户页面：故意不设置 `access` 字段。
   *
   * 安全边界：
   * 任何已认证用户都可以查看自己的个人资料和设置，无需 RBAC 权限控制。
   * 安全性由 `src/app.tsx` 的 `onPageChange()` 在应用层面强制执行，
   * 该方法会在任何路由渲染前将未认证用户重定向到 `/user/login`。
   *
   * 不设置 access 字段的原因：
   * - 这些页面是用户专属的（每个用户只能看到自己的数据）
   * - 不需要管理员级别的权限
   * - 认证（登录）是唯一的门槛 — "已认证 = 已授权"
   *
   * 一致性：
   * 此设计与 /chatbot 一致 — 两者都是面向用户的功能，认证是唯一的安全边界。
   *
   * 参见：src/app.tsx onPageChange() 中的认证强制执行逻辑
   */
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
  /**
   * Chatbot：面向所有已认证用户的 AI 助手。
   *
   * 安全边界：
   * 未设置 `access` 字段，安全性由 `src/app.tsx` 的 `onPageChange()` 在应用层面强制执行，
   * 该方法会在任何路由渲染前将未认证用户重定向到 `/user/login`。
   *
   * 不设置 access 字段的原因：
   * - Chatbot 是面向用户的功能，所有已认证用户均可使用
   * - 不需要管理员级别的权限
   * - 认证（登录）是唯一的门槛 — "已认证 = 已授权"
   *
   * 一致性：
   * 此设计与 /account 一致 — 两者都是面向用户的功能，认证是唯一的安全边界。
   *
   * 参见：src/app.tsx onPageChange() 中的认证强制执行逻辑
   */
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
    name: '404',
    component: './exception/404',
    path: './*',
    layout: false,
  },
];
