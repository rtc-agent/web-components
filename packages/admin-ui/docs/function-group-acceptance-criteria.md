# Function Group 验收标准

> 最后更新：2026-10-07  
> 适用范围：所有新增或修改的 Function Group（permission, auditLog, admin, adminRole, serverConfig 等）

---

## 核心原则

1. **URL 是单一数据源**：所有查询参数都从 URL 读取，不依赖组件内部状态
2. **职责分离**：`ensurePageLoaded` 只负责导航，`pageAPI.list()` 负责数据同步
3. **命名规范**：变量、函数、文件命名清晰准确，避免歧义
4. **文案准确**：注释、描述、错误信息使用英文，表达清晰
5. **类型安全**：使用 TypeScript 强类型定义，避免 `any`

---

## 一、代码结构（6 项）

### 1.1 Page API 类型定义
- [ ] `page-api.ts` 文件存在且接口定义完整
- [ ] 包含所有操作方法（list/create/update/remove）
- [ ] 返回值类型明确定义
- [ ] 通过 `declare global` 扩展 `PagesRegistry`

**示例**：
```typescript
// src/pages/system/roles/page-api.ts
export interface RolePageAPI {
  list: (params?: {
    current?: number;
    pageSize?: number;
    keyword?: string;
  }) => Promise<{
    success: boolean;
    data: RoleInfo[];
    total: number;
  }>;
  // ...
}

declare global {
  interface PagesRegistry {
    role?: RolePageAPI;
  }
}
```

### 1.2 Function Handler 文件
- [ ] 每个操作对应一个文件（list.ts, create.ts, update.ts, remove.ts）
- [ ] 文件命名使用 kebab-case
- [ ] 导出符合 `PermissionAwareFunctionDef` 类型的对象

### 1.3 Group 定义文件
- [ ] `index.ts` 定义 Function Group
- [ ] 包含 `name`, `description`, `functions` 字段
- [ ] `description` 清晰说明模块功能和路由路径

**示例**：
```typescript
export const roleGroup = {
  name: 'role',
  description: 'Admin role management module for /system/roles page. Supports CRUD operations.',
  functions: [listRoles, createRole, updateRole, removeRole],
};
```

### 1.4 注册到全局
- [ ] Group 注册到 `groups/index.ts`
- [ ] Group 注册到 `rtc-agent/index.ts` 的 `functionGroups` 数组
- [ ] 导出名称一致（避免命名混淆）

### 1.5 Handler 调用 ensurePageLoaded
- [ ] Handler 中调用 `ensurePageLoaded(pageName, pagePath, queryParams)`
- [ ] `queryParams` 从 Handler 参数构建（如 `keyword`, `current`, `pageSize`）
- [ ] `queryParams` 仅包含有值的参数（避免空字符串）

### 1.6 Page API 接口完整性
- [ ] 所有 CRUD 操作都在 Page API 中定义
- [ ] 参数和返回值类型与 Handler 一致
- [ ] 可选参数使用 `?` 标记

---

## 二、Page API 实现（8 项）

### 2.1 useEffect 注册 API
- [ ] 在 `useEffect` 中注册 `window.__pages__.<pageName>`
- [ ] 依赖数组为空 `[]`（仅在挂载时注册一次）
- [ ] 注册前检查是否已存在（避免重复注册）

**示例**：
```typescript
useEffect(() => {
  window.__pages__ = window.__pages__ || {};
  window.__pages__.role = {
    list: async (params) => { /* ... */ },
    create: async (data) => { /* ... */ },
    // ...
  };
}, []);
```

### 2.2 发送 page-api-ready 事件
- [ ] 注册后发送 `page-api-ready` 事件
- [ ] 事件 detail 包含 `page` 字段
- [ ] 使用 `CustomEvent` 类型

**示例**：
```typescript
window.dispatchEvent(
  new CustomEvent('page-api-ready', { detail: { page: 'role' } })
);
```

### 2.3 清理函数
- [ ] `useEffect` 返回清理函数
- [ ] 清理函数中删除 `window.__pages__.<pageName>`
- [ ] 避免内存泄漏

**示例**：
```typescript
useEffect(() => {
  // 注册逻辑...
  return () => {
    if (window.__pages__?.role) {
      delete window.__pages__.role;
    }
  };
}, []);
```

### 2.4 返回数据与 UI 一致
- [ ] `pageAPI.list()` 返回的数据与 ProTable 显示的数据一致
- [ ] 从 service 函数获取数据（如 `getRoleList`）
- [ ] 包含 `success`, `data`, `total` 字段

### 2.5 操作后自动刷新表格
- [ ] `create/update/remove` 操作成功后刷新表格
- [ ] 使用 `actionRef.current?.reload()`
- [ ] 刷新前显示 loading 状态

### 2.6 错误处理
- [ ] 所有异步操作使用 `try/catch`
- [ ] 捕获错误后返回 `{ success: false, error: '...' }`
- [ ] 错误信息使用英文，描述清晰

**示例**：
```typescript
create: async (data) => {
  try {
    const result = await createRole(data);
    actionRef.current?.reload();
    return { success: true, id: result.id };
  } catch (error) {
    console.error('[RolePageAPI] Create failed:', error);
    return { success: false, error: 'Failed to create role' };
  }
},
```

### 2.7 request 从 searchParams 读取参数
- [ ] ProTable `request` 从 `searchParams.get()` 读取查询参数
- [ ] 不依赖 ProTable 的 `params`（避免状态不一致）
- [ ] URL 是单一数据源

**示例**：
```typescript
<ProTable
  request={async (params, sort, filter) => {
    // ✅ 从 searchParams 读取
    const keyword = searchParams.get('keyword') || '';
    const current = params.current || 1;
    const pageSize = params.pageSize || 20;
    
    const result = await getRoleList({ keyword, current, pageSize });
    return { data: result.data, success: true, total: result.total };
  }}
/>
```

### 2.8 pageAPI.list() 同步 URL
- [ ] `pageAPI.list()` 调用 `setSearchParams()` 同步 URL
- [ ] 使用 `{ replace: true }` 避免产生多余历史记录
- [ ] URL 同步后再调用 service

**示例**：
```typescript
list: async (listParams) => {
  const { current = 1, pageSize = 20, keyword } = listParams || {};
  
  // 1. 同步 URL
  const newSearchParams = new URLSearchParams(searchParams);
  newSearchParams.set('current', String(current));
  newSearchParams.set('pageSize', String(pageSize));
  if (keyword) {
    newSearchParams.set('keyword', keyword);
  } else {
    newSearchParams.delete('keyword');
  }
  setSearchParams(newSearchParams, { replace: true });
  
  // 2. 调用 service
  const result = await getRoleList({ keyword, current, pageSize });
  return { success: true, data: result.data || [], total: result.total || 0 };
},
```

---

## 三、Function Handler（9 项）

### 3.1 使用 PermissionAwareFunctionDef 类型
- [ ] Handler 导出对象类型为 `PermissionAwareFunctionDef`
- [ ] 类型导入正确（从 `@/rtc-agent/permission-filter`）

### 3.2 声明 requiredPermissions
- [ ] `requiredPermissions` 数组包含所有需要的权限
- [ ] 每个权限包含 `resource` 和 `action`
- [ ] 权限资源名称与 `constants/permissions.ts` 一致

**示例**：
```typescript
requiredPermissions: [
  { resource: 'role', action: 'read' },  // ✅ 正确
  // { resource: 'admin_role', action: 'read' },  // ❌ 错误
],
```

### 3.3 调用 ensurePageLoaded
- [ ] Handler 中调用 `await ensurePageLoaded(pageName, pagePath, queryParams)`
- [ ] `queryParams` 从 Handler 参数构建
- [ ] 仅包含有值的参数

**示例**：
```typescript
const queryParams: Record<string, string> = {};
if (keyword) {
  queryParams.keyword = keyword;
}
await ensurePageLoaded('role', '/system/roles', queryParams);
```

### 3.4 检查 pageAPI 存在性
- [ ] 调用 `pageAPI.list()` 前检查 `window.__pages__?.role` 是否存在
- [ ] 不存在时抛出明确的错误信息

**示例**：
```typescript
const pageAPI = window.__pages__?.role;
if (!pageAPI) {
  throw new Error('Role page failed to load. Please try again.');
}
```

### 3.5 Zod Schema 完整
- [ ] 所有参数都使用 `z.object()` 定义
- [ ] 每个字段使用 `withMeta()` 添加 `example`
- [ ] 每个字段使用 `.describe()` 添加描述
- [ ] 可选参数使用 `.optional()`

**示例**：
```typescript
zodSchema: z.object({
  current: withMeta(z.number().int().positive(), { example: 1 })
    .optional()
    .describe('Current page number for pagination. Defaults to 1.'),
  keyword: withMeta(z.string(), { example: 'admin' })
    .optional()
    .describe('Search keyword to filter by name or description.'),
}),
```

### 3.6 返回值 Schema 完整
- [ ] `returns.zodSchema` 定义返回值结构
- [ ] 包含 `success`, `data`, `total` 等字段
- [ ] 嵌套对象也使用 `z.object()` 定义
- [ ] 每个字段使用 `.describe()`

### 3.7 Hooks 实现
- [ ] `hooks.onStart` 记录开始日志
- [ ] `hooks.onSuccess` 记录成功日志
- [ ] `hooks.onError` 记录错误日志
- [ ] 日志使用英文，包含关键信息

**示例**：
```typescript
hooks: {
  onStart: () => {
    console.log('[role.list] Reading admin role list...');
  },
  onSuccess: (result) => {
    console.log(`[role.list] Read successful, total ${(result as any).total} records`);
  },
  onError: (error) => {
    console.error('[role.list] Read failed:', error.message);
  },
},
```

### 3.8 英文注释
- [ ] Handler 顶部注释使用英文
- [ ] 注释说明权限要求、实现逻辑、前置条件
- [ ] 避免中文注释

**示例**：
```typescript
/**
 * Query admin role list
 *
 * Permission required: role:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.role.list)
 * - Page API reads data from React Query cache
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded
 */
export const listRoles: PermissionAwareFunctionDef = {
  // ...
};
```

### 3.9 description 清晰准确
- [ ] `description` 说明功能、支持的参数、返回值
- [ ] 包含页面路径（如 `/system/roles`）
- [ ] Agent 能理解何时调用此 Handler

**示例**：
```typescript
description:
  'Query admin role list on /system/roles page. Supports pagination and keyword search. Returns roles currently displayed in the UI table.',
```

---

## 四、权限配置（5 项）

### 4.1 constants/permissions.ts
- [ ] 添加新的 `resource` 到 `PERMISSION_RESOURCES`
- [ ] 添加对应的 `action`（read, create, update, delete）
- [ ] 权限标识符使用 snake_case（如 `admin_role`）

### 4.2 access.ts
- [ ] 添加访问控制函数（如 `canReadRole`）
- [ ] 函数命名使用 `can<Action><Resource>` 格式
- [ ] 返回布尔值

### 4.3 routes.ts
- [ ] 路由配置中添加 `access` 字段
- [ ] `access` 值与 `access.ts` 中的函数名一致

### 4.4 文档权限矩阵
- [ ] 更新 `docs/permission-matrix.md`（或类似文档）
- [ ] 包含 resource、action、description 三列
- [ ] 权限标识符与实际代码一致

### 4.5 后端权限映射
- [ ] 后端 API 返回的权限列表包含新 resource
- [ ] 权限标识符与前端一致
- [ ] 权限检查逻辑正确

---

## 五、E2E 测试（7 项）

### 5.1 测试文件存在
- [ ] `e2e/specs/<group>.spec.ts` 文件存在
- [ ] 测试描述使用英文

### 5.2 CRUD 功能测试
- [ ] `list` 测试：查询列表，验证返回数据
- [ ] `create` 测试：创建新记录，验证成功
- [ ] `update` 测试：更新记录，验证成功
- [ ] `remove` 测试：删除记录，验证成功

### 5.3 权限过滤测试
- [ ] 测试无权限时返回空结果或错误
- [ ] 测试有权限时正常返回

### 5.4 数据一致性测试
- [ ] 测试 Handler 返回的数据与 UI 显示一致
- [ ] 测试分页、搜索功能正确

### 5.5 Query 参数传递测试
- [ ] 测试 Handler 调用时传递 `queryParams`
- [ ] 测试 URL 包含正确的 query 参数
- [ ] 测试搜索表单回填正确

### 5.6 URL 和表格数据一致性测试
- [ ] 测试 URL 变化后表格自动刷新
- [ ] 测试表格数据与 URL 参数一致
- [ ] 测试手动修改 URL 后表格更新

### 5.7 搜索表单回填测试
- [ ] 测试首次导航时表单回填 URL 参数
- [ ] 测试表单提交后 URL 更新
- [ ] 测试清空表单后 URL 参数删除

---

## 六、集成验收（6 项）

### 6.1 本地开发验证
- [ ] `npm start` 启动无报错
- [ ] 页面正常加载
- [ ] 控制台无报错

### 6.2 权限过滤验证
- [ ] 无权限用户看不到菜单项
- [ ] 无权限用户调用 Handler 返回空结果
- [ ] 有权限用户正常使用

### 6.3 AI 调用验证
- [ ] AI 能正确调用 Handler
- [ ] 返回数据格式正确
- [ ] 错误处理正确

### 6.4 UI 同步验证
- [ ] Handler 调用后表格自动刷新
- [ ] URL 参数与搜索表单一致
- [ ] 表格数据与 URL 参数一致

### 6.5 错误处理验证
- [ ] 网络错误时显示友好提示
- [ ] 权限错误时返回空结果
- [ ] 表单验证错误时不提交

### 6.6 Query 参数端到端验证
- [ ] Handler 跳转携带 Query 参数
- [ ] URL 变化触发表格刷新
- [ ] 搜索表单反映 URL 参数
- [ ] 表格数据与 URL 一致

**验收场景**：
1. 已在当前页面，Query 变化 → 立即返回，URL 更新，表格刷新
2. 不在当前页面，首次导航 → 导航到带 Query 的 URL，表格显示正确数据
3. 手动修改 URL → 表格自动更新，数据一致

---

## 七、文档验收（3 项）

### 7.1 权限矩阵表更新
- [ ] `docs/permission-matrix.md` 包含新 resource
- [ ] 权限标识符、action、description 完整

### 7.2 目录结构更新
- [ ] `docs/directory-structure.md`（或 README）包含新文件
- [ ] 文件路径和描述准确

### 7.3 示例代码
- [ ] 如有参考实现，更新示例代码
- [ ] 示例代码可运行、无错误

---

## 八、Query 参数处理（5 项）

### 8.1 ensurePageLoaded 简化逻辑
- [ ] 只检查 `window.__pages__?.[pageName]` 是否存在
- [ ] 存在则立即返回（不比较 URL）
- [ ] 不存在则导航并等待 `page-api-ready`
- [ ] `queryParams` 仅在首次导航时使用

**示例**：
```typescript
export async function ensurePageLoaded(
  pageName: keyof NonNullable<typeof window.__pages__>,
  pagePath: string,
  queryParams?: Record<string, string>,
): Promise<void> {
  // ✅ 页面已加载 — 立即返回（不比较 URL）
  if (window.__pages__?.[pageName]) {
    return;
  }
  
  // 构建 URL（含 query，避免首次加载时数据闪烁）
  let fullUrl = pagePath;
  if (queryParams && Object.keys(queryParams).length > 0) {
    fullUrl = `${pagePath}?${new URLSearchParams(queryParams).toString()}`;
  }
  
  // 导航到目标页面
  const currentPath = window.location.pathname;
  if (currentPath !== pagePath) {
    window.history.pushState({}, '', fullUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  
  // 等待页面 API 注册完成
  await waitForPageApi(pageName);
}
```

### 8.2 URL 是单一数据源
- [ ] `request` 从 `searchParams` 读取参数
- [ ] 不依赖 ProTable 的 `params`
- [ ] URL 变化自动触发 `useEffect` → `reload()`

### 8.3 pageAPI.list() 同步 URL
- [ ] 调用 `setSearchParams(newSearchParams, { replace: true })`
- [ ] 更新 URL 后再调用 service
- [ ] 返回的数据与 UI 一致

### 8.4 首次导航避免数据闪烁
- [ ] `ensurePageLoaded` 使用 `queryParams` 构建初始 URL
- [ ] 页面组件挂载时从 URL 读取 `initialValues`
- [ ] ProTable `request` 立即使用正确的参数

### 8.5 已在当前页面的优化
- [ ] `ensurePageLoaded` 立即返回（无超时）
- [ ] Handler 直接调用 `pageAPI.list()`
- [ ] `pageAPI.list()` 更新 URL → `useEffect` 触发刷新

---

## 验收流程

### 1. 代码审查
- [ ] 检查所有文件是否符合上述标准
- [ ] 检查命名规范、文案准确性
- [ ] 检查类型安全（避免 `any`）

### 2. 静态检查
- [ ] `npm run lint` 通过（Biome）
- [ ] `npm run tsc` 通过（TypeScript）
- [ ] `npm run test` 通过（单元测试）

### 3. 功能测试
- [ ] 手动测试三个场景（已在当前页面、首次导航、手动修改 URL）
- [ ] 检查 URL、表单、表格一致性
- [ ] 检查错误处理

### 4. E2E 测试
- [ ] 运行 E2E 测试套件
- [ ] 所有测试通过

### 5. AI 调用测试
- [ ] 使用 AI 调用 Handler
- [ ] 验证返回数据正确
- [ ] 验证 UI 同步正确

---

## 常见问题

### Q1: 为什么 `request` 要从 `searchParams` 读取，而不是 `params`？
**A**: `params` 是 ProTable 内部状态，可能与 URL 不同步。从 `searchParams` 读取确保 URL 是单一数据源，避免状态不一致。

### Q2: 为什么 `pageAPI.list()` 要调用 `setSearchParams`？
**A**: 确保 URL 与数据一致。Handler 调用 `pageAPI.list()` 后，URL 应该反映当前的查询条件。

### Q3: 为什么 `ensurePageLoaded` 不比较 URL？
**A**: 如果页面 API 已注册，说明页面已加载。URL 同步由 `pageAPI.list()` 负责，`ensurePageLoaded` 只负责导航。

### Q4: 如何避免双重 API 调用？
**A**: `pageAPI.list()` 调用 service 会触发一次请求，`setSearchParams` 触发 `useEffect` → `reload()` → `request` 又触发一次。这是当前架构的 trade-off，功能正确但有性能损耗。未来优化方案：让 `pageAPI.list()` 只更新 URL，不直接调 service。

---

## 更新日志

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-10-07 | v1.0 | 初始版本，包含 8 大类验收标准 | Claude Code |
| 2026-10-07 | v1.1 | 增加 Query 参数处理验收标准，简化 `ensurePageLoaded` 逻辑 | Claude Code |

---

## 附录：验收检查清单（简化版）

### 代码层面
- [ ] `ensurePageLoaded` 只检查 API 存在性
- [ ] `request` 从 `searchParams` 读取参数
- [ ] `pageAPI.list()` 调用 `setSearchParams`
- [ ] 所有注释使用英文
- [ ] 命名规范（kebab-case, camelCase）

### 功能层面
- [ ] Handler 跳转携带 Query
- [ ] URL 变化触发表格刷新
- [ ] 搜索表单反映 URL 参数
- [ ] 表格数据与 URL 一致
- [ ] 错误处理完整

### 测试层面
- [ ] 首次导航测试（带 Query）
- [ ] 已在当前页面测试（Query 变化）
- [ ] URL 手动修改测试
- [ ] 数据一致性测试
- [ ] 权限过滤测试

### 文档层面
- [ ] 权限矩阵更新
- [ ] 目录结构更新
- [ ] 示例代码正确
