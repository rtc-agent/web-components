# RTC Agent Admin UI

RTC Agent 管理后台，基于 Ant Design Pro 模板定制，集成 RTC Agent 组件用于实时监控和调试。

## 技术栈

- **框架**: React 19 + TypeScript
- **应用框架**: Umi Max v4
- **UI 组件库**: Ant Design v6 + ProComponents v3
- **样式方案**: Tailwind CSS v4 + antd-style v4
- **状态管理**: Umi 内置 (@@initialState) + @tanstack/react-query
- **代码规范**: Biome (lint + format) + TypeScript strict
- **测试框架**: Vitest + Playwright (E2E)
- **包管理**: pnpm (workspace 统一管理)
- **Node 要求**: >= 22.0.0
- **pnpm 要求**: >= 8.0.0

## 快速开始

### 安装依赖

```bash
# 在 workspace 根目录执行
pnpm install
```

### 启动开发服务器

```bash
# 方式 1: 带 Mock 数据（默认）
pnpm start

# 方式 2: 无 Mock，代理到真实后端
pnpm run dev

# 方式 3: 指定环境
pnpm run start:test   # 测试环境
pnpm run start:pre    # 预发环境
```

### 构建生产版本

```bash
pnpm run build
```

构建产物输出到 `dist/` 目录，包含 hash 后缀用于缓存控制。

### 代码检查

```bash
# Biome lint + TypeScript 类型检查
pnpm run lint

# 自动修复格式问题
pnpm run lint:fix

# 仅格式化代码
pnpm run format

# 仅类型检查
pnpm run tsc
```

### 测试

```bash
# 运行单元测试
pnpm run test

# 运行测试并生成覆盖率报告
pnpm run test:coverage

# 监听模式
pnpm run test:watch

# 运行 E2E 测试
pnpm run test:e2e
```

### OpenAPI 代码生成

```bash
# 从 OpenAPI 规范生成 src/services/ant-design-pro/
pnpm run openapi
```

**注意**: `src/services/ant-design-pro/` 目录下的文件是自动生成的，**不要手动编辑**。修改应通过更新 OpenAPI 规范后重新生成。

## 目录结构

```text
admin-ui/
├── config/                    # Umi 配置
│   ├── config.ts             # 主配置 (defineConfig)
│   ├── routes.ts             # 路由配置
│   ├── defaultSettings.ts    # ProLayout 默认设置
│   ├── proxy.ts              # 开发环境代理配置
│   └── oneapi.json           # OpenAPI 生成配置
├── src/
│   ├── pages/                # 页面组件（按功能模块组织）
│   │   ├── dashboard/        # 仪表盘（Grafana 嵌入）
│   │   ├── rtc-users/        # RTC 用户管理
│   │   ├── system/           # 系统管理（用户、角色、权限、审计日志、配置）
│   │   ├── account/          # 账户中心/设置
│   │   ├── chatbot/          # AI 助手
│   │   ├── user/             # 登录/注册/管理员管理
│   │   └── exception/        # 异常页面 (403/404/500)
│   ├── components/           # 公共组件
│   │   ├── GlobalRtcAgent/   # RTC Agent 全局集成
│   │   ├── ErrorBoundary/    # 错误边界
│   │   ├── OfflineBanner/    # 离线提示
│   │   └── ...
│   ├── services/             # API 服务
│   │   ├── ant-design-pro/   # 自动生成的 API（不要手动编辑）
│   │   ├── admin-auth.ts     # 认证服务
│   │   ├── userConfig.ts     # 用户配置服务
│   │   ├── role.ts           # 角色管理服务
│   │   ├── permission.ts     # 权限管理服务
│   │   ├── serverConfig.ts   # 服务器配置服务
│   │   └── auditLog.ts       # 审计日志服务
│   ├── hooks/                # 自定义 Hooks
│   │   ├── useThemeMode.ts
│   │   ├── useRoleOptions.ts
│   │   └── useOptimisticLockConflict.ts
│   ├── locales/              # 国际化文件（8 种语言）
│   │   ├── zh-CN/
│   │   ├── en-US/
│   │   ├── ja-JP/
│   │   └── ...
│   ├── utils/                # 工具函数
│   ├── rtc-agent/            # RTC Agent 测试/诊断工具
│   ├── access.ts             # 权限配置（RBAC）
│   ├── app.tsx               # 运行时配置（getInitialState, layout, request）
│   ├── global.tsx            # 全局脚本
│   ├── global.less           # 全局样式
│   ├── loading.tsx           # 全局加载组件
│   ├── requestErrorConfig.ts # 请求错误处理配置
│   └── typings.d.ts          # 全局类型定义
├── mock/                     # Mock 数据（全局）
├── public/                   # 静态资源
├── tests/                    # 测试配置和 setup
├── cloudflare-worker/        # Cloudflare Worker（独立项目）
├── .env                      # 环境变量（生产）
├── .env.development          # 环境变量（开发）
└── package.json
```

## 路由配置

路由定义在 `config/routes.ts`，采用声明式配置。

### 主要路由

| 路径                      | 名称         | 权限                 | 说明                       |
| ------------------------- | ------------ | -------------------- | -------------------------- |
| `/dashboard`              | dashboard    | canDashboardView     | 仪表盘（Grafana 嵌入）     |
| `/rtc-users`              | rtc-users    | canRtcUsersMenu      | RTC 用户管理               |
| `/rtc-users/management`   | management   | canRtcUserView       | 用户列表                   |
| `/rtc-users/sessions`     | sessions     | canRtcSessionView    | 会话管理                   |
| `/rtc-users/messages`     | messages     | canRtcMessageView    | 消息管理                   |
| `/system`                 | system       | canSystemView        | 系统管理                   |
| `/system/users`           | users        | canAdminUserView     | 管理员用户                 |
| `/system/roles`           | roles        | canAdminRoleView     | 角色管理                   |
| `/system/permissions`     | permissions  | canPermissionView    | 权限管理                   |
| `/system/audit-logs`      | audit-logs   | canAuditLogView      | 审计日志                   |
| `/system/configs`         | configs      | canServerConfigView  | 服务器配置                 |
| `/account`                | account      | -                    | 账户（任何登录用户可见）   |
| `/user/login`             | login        | -                    | 登录页                     |

### 路由命名约定

- `name` 字段对应国际化 key：`menu.{name}`
- `icon` 字段使用 Ant Design 图标名称（去除 `Outlined` 后缀）
- `access` 字段控制菜单可见性和路由权限

## 权限系统

基于 RBAC（基于角色的访问控制）模型，实现细粒度权限控制。

### 权限点定义

系统定义了 13 个权限点（设计文档 §6.2）：

| 权限点                           | 说明                   | 资源           |
| -------------------------------- | ---------------------- | -------------- |
| `admin_user:read/write/delete`   | 管理员用户管理         | 管理员账户     |
| `admin_user_role:read/write`     | 管理员用户角色分配     | 用户-角色关系  |
| `role:read/write`                | 角色管理               | 角色定义       |
| `permission:read/write`          | 权限管理               | 权限定义       |
| `audit_log:read`                 | 审计日志查看           | 审计日志       |
| `rtc_user:read/ban`              | RTC 用户管理           | RTC 用户       |
| `rtc_session:read`               | RTC 会话查看           | 会话数据       |
| `rtc_message:read`               | RTC 消息查看           | 消息数据       |
| `server_config:read/write/delete`| 服务器配置管理         | 系统配置       |
| `dashboard:read`                 | 仪表盘查看             | 监控数据       |

### 权限检查流程

1. **登录**: `getInitialState()` 调用 `GET /api/currentUser` 获取用户信息
2. **权限计算**: `buildPermissionSet()` 将用户权限列表转换为 `Set<string>`
3. **访问控制**: `access.ts` 根据权限集合返回权限对象
4. **路由守卫**: Umi 根据 `access` 字段控制菜单可见性和路由访问

### 权限配置示例

```typescript
// src/access.ts
export default function access(initialState: { currentUser?: API.CurrentUser }) {
  const { currentUser } = initialState ?? {};

  if (!currentUser) {
    return { canAdmin: false, /* ... */ };
  }

  const perms = currentUser.permissions as Set<string>;

  return {
    canAdmin: perms.has('admin_user:write'),
    canRtcUserView: perms.has('rtc_user:read'),
    canRtcUserBan: perms.has('rtc_user:ban'),
    // ...
  };
}
```

### 在组件中使用权限

```typescript
import { useAccess, Access } from '@umijs/max';

function AdminPanel() {
  const access = useAccess();

  return (
    <Access accessible={access.canAdmin} fallback="无权限">
      {/* 仅管理员可见内容 */}
    </Access>
  );
}
```

## 国际化

支持 8 种语言：

- `zh-CN` - 简体中文
- `en-US` - 英语
- `ja-JP` - 日语
- `zh-TW` - 繁体中文（台湾）
- `pt-BR` - 葡萄牙语（巴西）
- `id-ID` - 印尼语
- `bn-BD` - 孟加拉语（孟加拉国）
- `fa-IR` - 波斯语（伊朗，RTL）

### 使用方式

```typescript
import { useIntl } from '@umijs/max';

function MyComponent() {
  const intl = useIntl();

  return (
    <h1>
      {intl.formatMessage({
        id: 'menu.dashboard',
        defaultMessage: '仪表盘',
      })}
    </h1>
  );
}
```

### 添加翻译

1. 在 `src/locales/{locale}/` 下添加或修改翻译文件
2. 菜单翻译在 `menu.{locale}.ts` 中
3. 页面翻译在对应页面的 `locales/` 子目录中

### RTL 支持

RTL 语言（如 `fa-IR`）自动设置 `document.documentElement.dir = 'rtl'`。

## 环境配置

### 环境变量

| 变量             | 说明               | 默认值             |
| ---------------- | ------------------ | ------------------ |
| `RTC_AGENT_URL`  | RTC Agent 服务地址 | 根据环境自动切换   |

### 环境文件

- `.env` - 生产环境配置
- `.env.development` - 开发环境配置（仅在 `max dev` 时加载）

### 开发代理

开发环境代理配置在 `config/proxy.ts`：

- `/api/auth/*` -> `http://localhost:28081` (Auth 服务)
- `/api/currentUser` -> `http://localhost:28081`
- `/api/rtc-users/*` -> `http://localhost:28081`
- `/api/configs/*` -> `http://localhost:28081`
- 其他接口使用 Mock 数据

## API 请求规范

### 请求方式

使用 Umi 内置的 `request` 函数，配置在 `src/requestErrorConfig.ts`：

```typescript
import { request } from '@umijs/max';

// GET 请求
const users = await request<API.UserList>('/api/users', {
  method: 'GET',
  params: { page: 1, pageSize: 10 },
});

// POST 请求
await request('/api/users', {
  method: 'POST',
  data: { name: 'John', email: 'john@example.com' },
});
```

### 错误处理

全局错误处理已配置：

- **401**: 自动跳转到登录页
- **403**: 显示无权限提示
- **404**: 显示资源不存在提示
- **500**: 显示服务器错误提示

### 服务文件组织

- **自动生成**: `src/services/ant-design-pro/` (OpenAPI 生成)
- **手动编写**: `src/services/*.ts` (业务特定 API)

每个页面的服务文件应放在对应页面目录下：

```text
src/pages/rtc-users/management/
├── index.tsx          # 页面组件
├── service.ts         # 页面专用 API
├── _mock.ts           # 页面专用 Mock（可选）
└── data.d.ts          # 页面类型定义（可选）
```

## RTC Agent 集成

admin-ui 集成了 RTC Agent 组件用于实时监控和调试：

### 全局集成

`GlobalRtcAgent` 组件在 `src/app.tsx` 中全局挂载，凌驾于所有页面之上：

```typescript
// src/app.tsx
export function layout(): RunTimeLayoutConfig {
  return {
    childrenRender: (children) => {
      return (
        <>
          {children}
          <GlobalRtcAgent />
        </>
      );
    },
  };
}
```

### Workspace 包依赖

admin-ui 依赖 workspace 内的其他包：

```json
{
  "dependencies": {
    "@rtc-agent/client": "workspace:*",
    "@rtc-agent/component": "workspace:*",
    "@rtc-agent/protocol": "workspace:^"
  }
}
```

### RTC Agent 地址

`RTC_AGENT_URL` 根据环境自动切换：

- 开发环境: `http://localhost:28080`
- 生产环境: `https://rtc-agent.cherish.chat`

## 主题定制

### 默认主题

配置在 `config/defaultSettings.ts`：

```typescript
const Settings: ProLayoutProps = {
  navTheme: 'realDark',        // 导航主题
  colorPrimary: '#1677ff',     // 主色调
  layout: 'mix',               // 布局模式
  contentWidth: 'Fluid',       // 内容宽度
  fixedHeader: true,           // 固定头部
  fixSiderbar: true,           // 固定侧边栏
  logo: '...',
  title: 'RTC Agent Admin',
};
```

### 样式优先级

1. **Tailwind CSS v4** - 布局和通用样式
2. **antd-style v4** - 主题 token 和组件样式
3. **CSS Modules** - 页面特定样式
4. **Less** - 遗留代码（不推荐）

### 自定义样式

```typescript
import { createStyles } from 'antd-style';

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    padding: ${token.paddingLG}px;
    background: ${token.colorBgContainer};
  `,
}));

function MyComponent() {
  const { styles } = useStyles();
  return <div className={styles.container}>...</div>;
}
```

## 常见问题

### 开发服务器启动失败

**问题**: `src/.umi` 目录缓存导致启动异常

**解决**:

```bash
rm -rf src/.umi src/.umi-production
pnpm start
```

### Mock 数据不生效

**问题**: 修改 mock 文件后未更新

**解决**:

```bash
# 重启开发服务器
pnpm start
```

### 权限不生效

**问题**: 修改 `access.ts` 后权限未更新

**解决**:

1. 检查 `getInitialState()` 是否正确获取用户信息
2. 检查 `buildPermissionSet()` 是否正确构建权限集合
3. 刷新页面重新加载初始状态

### TypeScript 类型错误

**问题**: `@umijs/max` 类型未识别

**解决**:

```bash
# 重新生成 .umi 类型
pnpm run tsc
```

### 构建失败

**问题**: 构建时报错内存不足

**解决**:

```bash
# 增加 Node.js 内存限制
NODE_OPTIONS="--max-old-space-size=4096" pnpm run build
```

### 代理不生效

**问题**: 开发环境请求未代理到真实后端

**解决**:

1. 检查 `config/proxy.ts` 配置
2. 确认环境变量 `UMI_ENV` 设置正确
3. 重启开发服务器

### 国际化文本不显示

**问题**: 国际化 key 对应的文本未显示

**解决**:

1. 检查 `src/locales/{locale}/` 下是否有对应翻译
2. 确认 `useIntl().formatMessage({ id })` 的 id 正确
3. 检查浏览器控制台是否有警告

## 开发规范

### 代码风格

- **Biome**: 统一使用 Biome 进行 lint 和格式化（不使用 ESLint + Prettier）
- **TypeScript**: 启用 strict 模式
- **命名约定**:
  - 组件: PascalCase
  - 函数/变量: camelCase
  - 常量: UPPER_SNAKE_CASE
  - 文件名: 与导出名称一致

### 提交规范

使用 Conventional Commits 格式，由 commitlint 强制执行：

```text
<type>(<scope>): <subject>

<body>

<footer>
```

**类型**:

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档变更
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具变更

**示例**:

```text
feat(rtc-users): add user ban feature

Add ability to ban/unban RTC users from management page.

Closes #123
```

### Git Hooks

- **pre-commit**: 通过 lint-staged 运行 Biome 检查
- **commit-msg**: 通过 commitlint 验证提交信息格式

### 页面开发最佳实践

1. **页面结构**: 每个页面目录包含 `index.tsx`、可选的 `service.ts`、`_mock.ts`、`data.d.ts`
2. **数据加载**: 使用 ProTable 的 `request` 属性或 `@tanstack/react-query`
3. **权限控制**: 在路由配置中设置 `access` 字段
4. **国际化**: 所有文本使用 `useIntl()` 获取
5. **样式**: 优先使用 Tailwind CSS，复杂样式使用 `createStyles()`

## 部署

### 构建

```bash
pnpm run build
```

构建产物在 `dist/` 目录，包含：

- 静态资源（JS/CSS/图片）带 hash 后缀
- `index.html` 入口文件
- 资源映射文件（可选）

### 部署到 Cloudflare Pages

项目已配置 Cloudflare Pages 自动部署：

1. 推送到 `main` 分支自动部署到生产环境
2. 创建 Pull Request 自动部署到预览环境

### 生产环境变量

生产环境需要设置：

```bash
RTC_AGENT_URL=https://rtc-agent.cherish.chat
```

## 相关资源

- [Umi 文档](https://umijs.org/)
- [Ant Design 文档](https://ant.design/)
- [ProComponents 文档](https://procomponents.ant.design/)
- [Tailwind CSS 文档](https://tailwindcss.com/)
- [Biome 文档](https://biomejs.dev/)

## 许可证

MIT
