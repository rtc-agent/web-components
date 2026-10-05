# Function Registration 分层架构设计

## 1. 设计原则

### 原则 1：Function 像人一样操作 UI

Function Handler **调用页面暴露的 React API**，而不是：

- ❌ 直接操作 DOM
- ❌ 绕过 UI 调用后端 API

页面 API 使用 **React 原生方式**（actionRef, formRef, React Query），返回的数据 **= UI 中显示的数据**（Agent 看到的 = 用户看到的）。

### 原则 2：事件驱动的页面就绪机制

使用**事件机制**确保页面加载完毕，不使用 `setTimeout`：

```typescript
// 页面组件注册 API 后发送事件
window.__pages__.rule = pageAPI;
window.dispatchEvent(new CustomEvent('page-api-ready', { detail: { page: 'rule' } }));

// navigation.goto 监听事件，确定性等待
if (!window.__pages__?.[pageName]) {
  await new Promise((resolve) => {
    const handler = (e: CustomEvent) => {
      if (e.detail.page === pageName) {
        window.removeEventListener('page-api-ready', handler);
        resolve(true);
      }
    };
    window.addEventListener('page-api-ready', handler);
  });
}
```

**优势**：

- ✅ 确定性等待（事件触发立即 resolve）
- ✅ 不会超时（不依赖固定时间）
- ✅ 无竞态条件（先检查是否已注册）

### 原则 3：E2E Spec 是契约

先写测试 → 再写实现 → 验证通过 → AI 自然能正确调用。不需要测试 RTC Agent 本身，只需要确保 Functions 的行为 100% 正确。

## 2. 分层架构总览

```mermaid
flowchart TB
    subgraph RTC["RTC Agent (消费者)"]
        A[AI 推理] --> B[Script Engine]
        B --> C["rtcAgent.rule.list()"]
    end

    subgraph FR["Function Registration (桥接层)"]
        C --> D["Function Registry"]
        D --> E["rule.list handler"]
    end

    subgraph E2E["E2E Spec Tests (契约层)"]
        F["Playwright Test"] -->|"window.__rtc__.callFunction()"| E
    end

    subgraph PAGE["页面 API 层 (React 管理)"]
        E -->|"window.__pages__.rule.list()"| G["Page API"]
        G --> H["actionRef.current?.reload()"]
        G --> I["queryClient.getQueryData()"]
        G --> J["formRef.current?.submit()"]
    end

    subgraph UI["React + Ant Design UI"]
        H --> K["ProTable 刷新"]
        I --> L["React Query 缓存"]
        J --> M["ProForm 提交"]
        K --> N["返回 UI 显示的数据"]
        L --> N
        M --> N
    end

    style RTC fill:#e3f2fd,stroke:#1565c0
    style FR fill:#fff9c4,stroke:#f9a825
    style E2E fill:#f3e5f5,stroke:#7b1fa2
    style PAGE fill:#e8f5e9,stroke:#388e3c
    style UI fill:#fce4ec,stroke:#c62828
```

**关键原则**：

- ✅ Handler **不直接操作 DOM**
- ✅ Handler **不绕过 UI 调用后端 API**
- ✅ Handler **调用页面暴露的 React API**
- ✅ 页面 API **使用 React 原生方式**（actionRef, formRef, React Query）
- ✅ 返回的数据 **= UI 中显示的数据**

## 3. 目录结构

```
src/
├── pages/
│   └── table-list/
│       ├── index.tsx                    # 页面组件（注册 page API）
│       ├── page-api.ts                  # Page API 定义（供 handler 调用）
│       └── components/
│           ├── CreateForm.tsx
│           └── UpdateForm.tsx
│
├── rtc-agent/
│   ├── index.ts                         # 入口：组装 agentConfig
│   ├── types.ts                         # 共享类型
│   ├── test-harness.ts                  # 测试桥接（暴露给 Playwright）
│   │
│   ├── groups/
│   │   ├── index.ts                     # 导出所有 groups
│   │   │
│   │   ├── navigation/                  # 页面导航
│   │   │   ├── index.ts                 # Group 定义 + 函数导出
│   │   │   ├── goto.ts                  # goto(path) → 页面跳转
│   │   │   ├── getCurrentPage.ts        # getCurrentPage() → 当前页面信息
│   │   │   └── listPages.ts             # listPages() → 所有可访问页面
│   │   │
│   │   ├── auth/                        # 认证管理
│   │   │   ├── index.ts
│   │   │   ├── currentUser.ts           # currentUser() → 当前用户信息
│   │   │   ├── hasPermission.ts         # hasPermission(key) → 权限检查
│   │   │   └── logout.ts               # logout() → 退出登录
│   │   │
│   │   └── rule/                        # 规则管理 (示例：对应 table-list 页面)
│   │       ├── index.ts                 # Group 定义 + 函数导出
│   │       ├── list.ts                  # list() → 调用 page API 读取表格数据
│   │       ├── create.ts               # create() → 调用 page API 触发创建
│   │       ├── update.ts               # update() → 调用 page API 触发更新
│   │       └── remove.ts               # remove() → 调用 page API 触发删除
│   │
│   └── e2e/                             # Playwright E2E 测试
│       ├── fixtures/
│       │   └── rtc-functions.ts        # 自定义 fixture：暴露 function 调用
│       └── specs/
│           ├── navigation.spec.ts
│           ├── auth.spec.ts
│           └── rule.spec.ts
```

## 4. 代码示例

### 4.1 Page API 定义 (`src/pages/table-list/page-api.ts`)

```typescript
/**
 * TableList 页面的 API 接口
 *
 * 页面组件在挂载时注册这些 API 到 window.__pages__
 * Function handler 通过调用这些 API 来操作 UI
 *
 * 关键原则：
 * - 使用 React 原生方式（actionRef, React Query）
 * - 返回 UI 中显示的数据
 * - 不直接操作 DOM
 */

import type { ActionType } from '@ant-design/pro-components';
import type { QueryClient } from '@tanstack/react-query';

export interface RulePageAPI {
  /**
   * 读取表格当前显示的数据
   * 从 React Query 缓存中获取，与 UI 显示一致
   */
  list: (params?: { current?: number; pageSize?: number }) => Promise<{
    success: boolean;
    data: Array<{
      key: number;
      name: string;
      desc: string;
      callNo: number;
      status: number;
      updatedAt: string;
    }>;
    total: number;
  }>;

  /**
   * 刷新表格
   * 调用 actionRef.current?.reload()
   */
  refresh: () => Promise<void>;

  /**
   * 创建规则
   * 触发创建流程（打开弹窗、填充表单、提交）
   */
  create: (data: { name: string; desc: string }) => Promise<{ success: boolean; id?: number }>;

  /**
   * 更新规则
   * 触发更新流程（打开弹窗、填充数据、提交）
   */
  update: (data: { key: number; name?: string; desc?: string }) => Promise<{ success: boolean }>;

  /**
   * 删除规则
   * 调用 React Query mutation
   */
  remove: (keys: number[]) => Promise<{ success: boolean }>;
}

// 全局类型声明
declare global {
  interface Window {
    __pages__?: {
      rule?: RulePageAPI;
    };
  }
}
```

### 4.2 页面组件注册 API (`src/pages/table-list/index.tsx`)

```typescript
import type { ActionType } from '@ant-design/pro-components';
import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef } from 'react';
import type { RulePageAPI } from './page-api';

const TableList: React.FC = () => {
  const actionRef = useRef<ActionType | null>(null);
  const queryClient = useQueryClient();

  // === 注册 Page API ===
  useEffect(() => {
    const pageAPI: RulePageAPI = {
      // 读取表格数据（从 React Query 缓存）
      list: async (params = {}) => {
        const { current = 1, pageSize = 20 } = params;

        // 从 React Query 缓存获取数据
        // 这与 UI 中 ProTable 显示的数据完全一致
        const cachedData = queryClient.getQueryData(['rule', { current, pageSize }]);

        if (cachedData && typeof cachedData === 'object' && 'data' in cachedData) {
          return {
            success: true,
            data: cachedData.data || [],
            total: cachedData.total || 0,
          };
        }

        // 如果缓存中没有，触发刷新并等待
        actionRef.current?.reload();
        await new Promise((resolve) => setTimeout(resolve, 500));

        // 重新读取缓存
        const newData = queryClient.getQueryData(['rule', { current, pageSize }]);
        return {
          success: true,
          data: (newData as any)?.data || [],
          total: (newData as any)?.total || 0,
        };
      },

      // 刷新表格
      refresh: async () => {
        actionRef.current?.reload();
      },

      // 创建规则
      create: async (data) => {
        // 触发创建流程
        // 实际实现可能需要：
        // 1. 点击"新建"按钮打开弹窗
        // 2. 填充表单
        // 3. 提交表单
        // 这里简化为直接调用 API
        const response = await fetch('/api/rule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await response.json();

        // 刷新表格
        actionRef.current?.reloadAndRest?.();

        return { success: result.success, id: result.data?.key };
      },

      // 更新规则
      update: async (data) => {
        const response = await fetch('/api/rule', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await response.json();

        // 刷新表格
        actionRef.current?.reload();

        return { success: result.success };
      },

      // 删除规则
      remove: async (keys) => {
        const response = await fetch('/api/removeRule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: keys }),
        });
        const result = await response.json();

        // 刷新表格
        actionRef.current?.reloadAndRest?.();

        return { success: result.success };
      },
    };

    // 注册到全局
    window.__pages__ = window.__pages__ || {};
    window.__pages__.rule = pageAPI;

    // 发送就绪事件（通知 navigation.goto 页面已加载）
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'rule' } })
    );

    console.log('[TableList] Page API registered');

    // 清理
    return () => {
      delete window.__pages__?.rule;
      console.log('[TableList] Page API unregistered');
    };
  }, [queryClient]);

  // ... 原有的 ProTable 代码 ...

  return (
    <PageContainer>
      <ProTable<API.RuleListItem, API.PageParams>
        actionRef={actionRef}
        request={rule}
        // ... 其他配置
      />
    </PageContainer>
  );
};

export default TableList;
```

### 4.3 Function Handler (`src/rtc-agent/groups/rule/list.ts`)

```typescript
import { z, withMeta } from '@rtc-agent/component';
import type { FunctionDef } from '@rtc-agent/component';

/**
 * 查询规则列表
 *
 * 对应页面：/list/table-list
 *
 * 实现方式：
 * - 调用页面暴露的 React API（window.__pages__.rule.list）
 * - 页面 API 从 React Query 缓存读取数据
 * - 返回的数据 = UI 表格中显示的数据
 *
 * 前提：navigation.goto 已确保页面加载完毕，page API 已注册
 */
export const listRule: FunctionDef = {
  name: 'list',
  description: '查询规则列表，返回当前表格中显示的数据',

  zodSchema: z.object({
    current: withMeta(z.number().int().positive(), { example: 1 })
      .optional()
      .describe('当前页码，默认 1'),
    pageSize: withMeta(z.number().int().positive(), { example: 20 })
      .optional()
      .describe('每页条数，默认 20'),
  }),

  returns: {
    zodSchema: z.object({
      success: z.boolean().describe('是否成功'),
      data: z.array(z.object({
        key: z.number().describe('规则 ID'),
        name: z.string().describe('规则名称'),
        desc: z.string().describe('描述'),
        callNo: z.number().describe('调用次数'),
        status: z.number().describe('状态：0-关闭 1-运行中 2-已上线 3-异常'),
        updatedAt: z.string().describe('更新时间'),
      })).describe('规则列表（与 UI 表格显示一致）'),
      total: z.number().describe('总数'),
    }).describe('规则列表查询结果'),
  },

  handler: async (params) => {
    const { current = 1, pageSize = 20 } = params as {
      current?: number;
      pageSize?: number;
    };

    // 页面已加载，直接调用 API
    return await window.__pages__.rule.list({ current, pageSize });
  },

  hooks: {
    onStart: () => {
      console.log('[rule.list] 读取规则列表...');
    },
    onSuccess: (result) => {
      console.log(`[rule.list] 读取成功，共 ${(result as any).total} 条`);
    },
    onError: (error) => {
      console.error('[rule.list] 读取失败:', error.message);
    },
  },
};
```

### 4.4 Function Handler - 创建规则 (`src/rtc-agent/groups/rule/create.ts`)

```typescript
import { z, withMeta } from '@rtc-agent/component';
import type { FunctionDef } from '@rtc-agent/component';

/**
 * 创建规则
 *
 * 实现方式：
 * - 调用页面 API 触发创建流程
 * - 页面 API 内部使用 React 方式操作（actionRef, mutation）
 * - 创建成功后自动刷新表格
 */
export const createRule: FunctionDef = {
  name: 'create',
  description: '创建新规则，创建成功后表格会自动刷新',

  zodSchema: z.object({
    name: withMeta(z.string(), { example: '新规则' })
      .describe('规则名称'),
    desc: withMeta(z.string(), { example: '规则描述' })
      .describe('规则描述'),
  }),

  returns: {
    zodSchema: z.object({
      success: z.boolean().describe('是否成功'),
      id: z.number().optional().describe('新创建的规则 ID'),
    }).describe('创建结果'),
  },

  handler: async (params) => {
    const { name, desc } = params as { name: string; desc: string };

    // 页面已加载，直接调用 API
    return await window.__pages__.rule.create({ name, desc });
  },
};
```

### 4.5 Group 定义 (`src/rtc-agent/groups/rule/index.ts`)

```typescript
import type { AgentFunctionGroup } from '@rtc-agent/component';
import { listRule } from './list';
import { createRule } from './create';
import { updateRule } from './update';
import { removeRule } from './remove';

/**
 * 规则管理 Function Group
 *
 * 对应页面路由：/list/table-list
 *
 * 所有 function 都调用页面暴露的 React API：
 * - window.__pages__.rule.list()
 * - window.__pages__.rule.create()
 * - window.__pages__.rule.update()
 * - window.__pages__.rule.remove()
 */
export const ruleGroup: AgentFunctionGroup = {
  name: 'rule',
  description: '规则管理模块，支持规则的增删改查操作。所有操作都会反映在 UI 表格中。',
  functions: [
    listRule,
    createRule,
    updateRule,
    removeRule,
  ],
};
```

### 4.6 入口组装 (`src/rtc-agent/index.ts`)

```typescript
import type { AgentConfig } from '@rtc-agent/component';
import { ruleGroup } from './groups/rule';
import { navigationGroup } from './groups/navigation';
import { authGroup } from './groups/auth';

/**
 * 创建 admin-ui 的 AgentConfig
 *
 * 用于传递给 createRtcAgent() 的 groups 配置
 */
export function createAdminAgentConfig(): Partial<AgentConfig> {
  return {
    name: 'AdminUI',
    description: 'Ant Design Pro 后台管理系统',
    persona: `你是一个后台管理系统的 AI 助手。
你可以帮助用户：
- 导航到不同的页面
- 查询和管理规则数据
- 查看当前用户信息和权限

请始终使用已注册的 Function 来执行操作，不要尝试直接操作 DOM。`,

    groups: [
      navigationGroup,
      authGroup,
      ruleGroup,
      // 后续添加更多 groups...
    ],
  };
}

/**
 * 导出所有 groups（供测试使用）
 */
export const allGroups = [
  navigationGroup,
  authGroup,
  ruleGroup,
];
```

### 4.7 测试桥接 (`src/rtc-agent/test-harness.ts`)

```typescript
import { allGroups } from './index';

/**
 * 测试桥接模块
 *
 * 在开发/测试环境下，将 Function Registry 暴露到 window 对象
 * 供 Playwright E2E 测试直接调用
 *
 * 用法（在 Playwright 中）：
 *   const result = await page.evaluate(() => {
 *     return window.__rtc__.callFunction('rule.list', { current: 1 });
 *   });
 */

interface RtcTestHarness {
  /**
   * 调用指定 Function
   * @param fullPath - 完整路径，如 'rule.list'
   * @param params - 函数参数
   */
  callFunction: (fullPath: string, params?: Record<string, unknown>) => Promise<unknown>;

  /**
   * 列出所有可用的 Functions
   */
  listFunctions: () => Array<{ group: string; name: string; description: string }>;
}

// 构建 function map
function buildFunctionMap(): Map<string, (params?: Record<string, unknown>) => Promise<unknown>> {
  const map = new Map();

  for (const group of allGroups) {
    for (const fn of group.functions) {
      const fullPath = `${group.name}.${fn.name}`;
      map.set(fullPath, async (params?: Record<string, unknown>) => {
        return fn.handler(params || {}, () => {});
      });
    }
  }

  return map;
}

/**
 * 初始化测试桥接
 * 仅在开发环境或测试环境生效
 */
export function initTestHarness(): void {
  // 安全检查：仅在非生产环境暴露
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const functionMap = buildFunctionMap();

  const harness: RtcTestHarness = {
    callFunction: async (fullPath, params) => {
      const fn = functionMap.get(fullPath);
      if (!fn) {
        throw new Error(`Function not found: ${fullPath}`);
      }
      return fn(params);
    },

    listFunctions: () => {
      const result: Array<{ group: string; name: string; description: string }> = [];
      for (const group of allGroups) {
        for (const fn of group.functions) {
          result.push({
            group: group.name,
            name: fn.name,
            description: fn.description,
          });
        }
      }
      return result;
    },
  };

  // 暴露到 window
  (window as any).__rtc__ = harness;

  console.log('[RTC Test Harness] Initialized. Use window.__rtc__ to call functions.');
}
```

### 4.8 Navigation Group 示例

导航函数使用**事件机制**确保页面加载完毕后才返回：

```typescript
// src/rtc-agent/groups/navigation/goto.ts
import { z, withMeta } from '@rtc-agent/component';
import type { FunctionDef } from '@rtc-agent/component';

export const goto: FunctionDef = {
  name: 'goto',
  description: '导航到指定页面，等待页面加载完毕（page API 注册完成）后返回',

  zodSchema: z.object({
    path: withMeta(z.string(), { example: '/list/table-list' })
      .describe('目标页面路径'),
  }),

  returns: {
    zodSchema: z.object({
      success: z.boolean().describe('是否成功'),
      path: z.string().describe('当前页面路径'),
      title: z.string().describe('页面标题'),
    }).describe('导航结果'),
  },

  handler: async (params) => {
    const { path } = params as { path: string };

    // 提取页面名称（从路径推断 page API 的 key）
    const pageName = extractPageName(path); // '/list/table-list' -> 'rule'

    // 1. 导航到新页面
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));

    // 2. 等待页面 API 注册完成（确定性等待，不使用 setTimeout）
    if (!window.__pages__?.[pageName]) {
      await new Promise<void>((resolve) => {
        const handler = (e: Event) => {
          const customEvent = e as CustomEvent<{ page: string }>;
          if (customEvent.detail.page === pageName) {
            window.removeEventListener('page-api-ready', handler);
            resolve();
          }
        };
        window.addEventListener('page-api-ready', handler);
      });
    }

    // 3. 此时 page API 已注册，后续 Function 可以直接调用

    return {
      success: true,
      path: window.location.pathname,
      title: document.title,
    };
  },
};

// 辅助函数：从路径提取页面名称
function extractPageName(path: string): string {
  const mapping: Record<string, string> = {
    '/list/table-list': 'rule',
    '/dashboard/analysis': 'dashboard',
    // ... 其他映射
  };
  return mapping[path] || path.split('/').pop() || '';
}
```

**页面组件注册时发送事件**：

```typescript
// src/pages/table-list/index.tsx
useEffect(() => {
  const pageAPI: RulePageAPI = { /* ... */ };
  
  // 注册 API
  window.__pages__ = window.__pages__ || {};
  window.__pages__.rule = pageAPI;

  // 发送就绪事件（通知 navigation.goto）
  window.dispatchEvent(
    new CustomEvent('page-api-ready', { detail: { page: 'rule' } })
  );

  return () => {
    delete window.__pages__?.rule;
  };
}, []);
```

**使用示例**：

```typescript
// AI 调用示例
await rtcAgent.navigation.goto({ path: '/list/table-list' });
// ✅ 事件机制确保 page API 已注册

await rtcAgent.rule.list({ current: 1 });
// ✅ 直接调用，无需等待
```

### 4.9 E2E 测试 (`src/rtc-agent/e2e/specs/rule.spec.ts`)

```typescript
import { expect, test } from '../fixtures/rtc-functions';

test.describe('rule Group - 规则管理', () => {
  test.beforeEach(async ({ page, login }) => {
    // 登录并导航到规则列表页
    await login();
    await page.goto('/list/table-list');
    await page.waitForLoadState('networkidle');
  });

  test('rule.list - 读取表格数据（与 UI 一致）', async ({ page, callFunction }) => {
    // 调用 function
    const result = await callFunction('rule.list', {
      current: 1,
      pageSize: 10,
    });

    // 验证返回值结构
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');

    // 验证数据与 UI 表格一致
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    const resultData = (result as any).data;
    expect(resultData.length).toBe(tableRows);

    // 验证第一行数据
    if (resultData.length > 0) {
      const firstRowName = await page.locator('.ant-table-tbody tr:first-child td:nth-child(2)').textContent();
      expect(resultData[0].name).toBe(firstRowName?.trim());
    }
  });

  test('rule.create - 创建规则并刷新表格', async ({ page, callFunction }) => {
    // 记录创建前的行数
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // 调用 function
    const result = await callFunction('rule.create', {
      name: '测试规则',
      desc: 'E2E 测试创建的规则',
    });

    expect(result).toHaveProperty('success', true);

    // 验证表格已刷新（行数增加）
    await page.waitForTimeout(500); // 等待刷新完成
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore + 1);

    // 验证新规则出现在表格中
    const newRuleVisible = await page.locator(`text=测试规则`).isVisible();
    expect(newRuleVisible).toBe(true);
  });

  test('rule.remove - 删除规则并刷新表格', async ({ page, callFunction }) => {
    // 先创建一条规则
    await callFunction('rule.create', {
      name: '待删除规则',
      desc: '即将被删除',
    });

    // 记录当前行数
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // 找到刚创建的规则
    const targetRow = await page.locator('tr', { hasText: '待删除规则' });
    const keyCell = await targetRow.locator('td:first-child').textContent();
    const ruleKey = parseInt(keyCell || '0');

    // 调用 function 删除
    const result = await callFunction('rule.remove', {
      keys: [ruleKey],
    });

    expect(result).toHaveProperty('success', true);

    // 验证表格已刷新（行数减少）
    await page.waitForTimeout(500);
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore - 1);

    // 验证规则已从表格消失
    const ruleStillVisible = await page.locator(`text=待删除规则`).isVisible();
    expect(ruleStillVisible).toBe(false);
  });
});
```

### 4.9 Playwright Fixture (`src/rtc-agent/e2e/fixtures/rtc-functions.ts`)

```typescript
import { test as base } from '@playwright/test';

type RtcFunctionsFixtures = {
  /** 调用 RTC Function */
  callFunction: (fullPath: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** 登录 helper */
  login: () => Promise<void>;
};

export const test = base.extend<RtcFunctionsFixtures>({
  callFunction: async ({ page }, use) => {
    const callFunction = async (fullPath: string, params?: Record<string, unknown>) => {
      return page.evaluate(
        ({ path, args }) => {
          // @ts-ignore
          return window.__rtc__?.callFunction(path, args);
        },
        { path: fullPath, args: params }
      );
    };
    await use(callFunction);
  },

  login: async ({ page }, use) => {
    const login = async () => {
      await page.goto('/user/login');
      await page.fill('input[name="email"]', 'admin');
      await page.fill('input[name="password"]', 'ant.design');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard/**');
    };
    await use(login);
  },
});

export { expect } from '@playwright/test';
```

### 4.10 集成到 rtc-agent-manager.ts

```typescript
import { createAdminAgentConfig } from '@/rtc-agent';
import { initTestHarness } from '@/rtc-agent/test-harness';

// ... existing code ...

const agent = createRtcAgent({
  appLabel: 'RTC Agent',
  theme: 'system',
  server: { url: RTC_AGENT_URL },
  auth: createAdminAuthProvider(),
  workerURL: '/rtc-agent/shared-worker.js',
  databaseName: 'admin-ui',
  lang: 'zh-CN',

  // === 新增：Function Registration ===
  ...createAdminAgentConfig(),

  window: {
    defaultMode: 'minimized',
    bubblePosition: {
      corner: 'bottom-right',
      offset: { x: -24, y: 24 },
    },
  },

  on: {
    ready: () => {
      console.log('[RTC Agent] Ready');
      // === 新增：初始化测试桥接 ===
      initTestHarness();
    },
    // ... existing callbacks
  },
});
```

## 5. Page API 模式详解

### 5.1 为什么使用 Page API 模式？

#### 直接操作 DOM

- 优点：简单直接
- 缺点：❌ 违反 React 原则；❌ 不稳定（DOM 结构变化）；❌ 无法访问 React 状态

#### 直接调后端 API

- 优点：不依赖 UI
- 缺点：❌ 绕过 UI，数据不一致；❌ 用户看到的不一样；❌ 无法触发 UI 更新

#### Page API 模式（推荐）

- 优点：✅ 使用 React 原生方式；✅ 数据与 UI 一致；✅ 自动触发 UI 更新；✅ 稳定可靠
- 缺点：需要页面注册 API

### 5.2 Page API 注册时机（事件机制）

```mermaid
sequenceDiagram
    participant Nav as navigation.goto
    participant Page as 页面组件
    participant Window as window.__pages__
    participant Func as Function Handler

    Nav->>Page: 触发路由跳转
    Page->>Page: useEffect() 执行
    Page->>Window: 注册 API
    Page->>Nav: dispatchEvent('page-api-ready')
    Note over Nav: 收到事件，Promise resolve
    Nav-->>Nav: 返回成功
    
    Note over Func: 页面已加载，page API 一定存在
    
    Func->>Window: 调用 pageAPI.list()
    Window->>Page: 执行 React 操作
    Page->>Func: 返回 UI 数据

    Page->>Page: 组件卸载
    Page->>Window: 清理 API
```

**关键机制**：

- `navigation.goto` 监听 `page-api-ready` 事件
- 页面组件在 `useEffect` 中注册 API 后发送事件
- `navigation.goto` 收到事件后才返回
- 后续 Function 可以直接调用 page API，无需等待

### 5.3 Page API 可用资源

页面 API 可以访问页面内的所有 React 资源：

- **actionRef** - 操作 ProTable：`actionRef.current?.reload()`
- **formRef** - 操作 ProForm：`formRef.current?.submit()`
- **queryClient** - 访问 React Query 缓存：`queryClient.getQueryData(['rule'])`
- **React State** - 读取/更新组件状态：`setState(newValue)`
- **组件方法** - 调用组件暴露的方法：`modalRef.current?.open()`

### 5.4 Page API 设计原则

1. **返回 UI 可见数据** - API 返回的数据必须与 UI 显示一致
2. **触发 UI 更新** - 修改操作后，UI 应该自动更新
3. **使用 React 方式** - 不直接操作 DOM，使用 actionRef、formRef 等
4. **错误处理** - API 应该捕获异常并返回结构化错误
5. **类型安全** - 定义清晰的 TypeScript 接口

## 6. 开发工作流

```mermaid
flowchart LR
    subgraph DEV["开发流程"]
        direction TB
        S1["1. 定义 Page API<br/>(页面暴露的接口)"]
        S2["2. 页面注册 API<br/>(useEffect 中注册)"]
        S3["3. 定义 Function Schema<br/>(name, zodSchema, returns)"]
        S4["4. 实现 Handler<br/>(调用 page API)"]
        S5["5. 编写 E2E Spec<br/>(验证 Function + UI)"]
        S6["6. 注册到 Group<br/>(自动对 AI 可用)"]

        S1 --> S2 --> S3 --> S4 --> S5 --> S6
    end

    style S1 fill:#e8f5e9,stroke:#388e3c
    style S2 fill:#e8f5e9,stroke:#388e3c
    style S3 fill:#fff9c4,stroke:#f9a825
    style S4 fill:#fff9c4,stroke:#f9a825
    style S5 fill:#f3e5f5,stroke:#7b1fa2
    style S6 fill:#e3f2fd,stroke:#1565c0
```

```
1. 定义 Page API    → 明确页面暴露的接口（类型、参数、返回值）
2. 页面注册 API    → 在 useEffect 中注册到 window.__pages__
3. 定义 Schema    → 明确 Function 的输入输出契约
4. 实现 Handler   → 调用 page API（不直接操作 DOM 或后端）
5. 编写 E2E Spec  → 用 Playwright 验证 Function 行为和 UI 状态
6. 注册到 Group   → AI 自动发现并可以调用
```

## 7. 测试策略

### 7.1 测试层级

- **E2E Spec** - 测试对象：Function 行为 + UI 状态；工具：Playwright；频率：每次 CI
- **Unit Test** - 测试对象：Page API 逻辑；工具：Vitest；频率：每次提交
- **集成测试** - 测试对象：Group → RTC Agent；工具：Playwright；频率：每周

### 7.2 E2E Spec 测试内容

1. **返回值验证**：Function 返回的数据结构是否符合 schema
2. **UI 状态验证**：Function 执行后 UI 是否正确更新（表格刷新、弹窗关闭等）
3. **数据一致性**：Function 返回的数据与 UI 显示的数据是否一致
4. **边界情况**：空数据、分页边界、错误处理
5. **性能验证**：Function 执行时间是否合理

## 8. 新增 Page + Group 模板

当需要添加新的 Page + Function Group 时，按以下步骤：

### Step 1: 创建 Page API 类型定义

```typescript
// src/pages/<page-name>/page-api.ts

export interface MyPageAPI {
  list: (params?: ListParams) => Promise<ListResult>;
  create: (data: CreateData) => Promise<CreateResult>;
  update: (data: UpdateData) => Promise<UpdateResult>;
  remove: (ids: number[]) => Promise<RemoveResult>;
}

declare global {
  interface Window {
    __pages__?: {
      myPage?: MyPageAPI;
    };
  }
}
```

### Step 2: 页面组件注册 API

```typescript
// src/pages/<page-name>/index.tsx

import type { MyPageAPI } from './page-api';

const MyPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const pageAPI: MyPageAPI = {
      list: async (params) => {
        // 从 React Query 缓存读取（与 UI 一致）
        return queryClient.getQueryData(['myData', params]);
      },
      create: async (data) => {
        // 调用后端 API
        const result = await fetch('/api/myData', { method: 'POST', body: JSON.stringify(data) });
        // 刷新表格
        actionRef.current?.reload();
        return result.json();
      },
      // ... 其他方法
    };

    window.__pages__ = window.__pages__ || {};
    window.__pages__.myPage = pageAPI;

    return () => {
      delete window.__pages__?.myPage;
    };
  }, []);

  return <ProTable actionRef={actionRef} request={...} />;
};
```

### Step 3: 创建 Function Group

```typescript
// src/rtc-agent/groups/my-group/index.ts
import type { AgentFunctionGroup } from '@rtc-agent/component';
import { listMyData } from './list';
import { createMyData } from './create';

export const myGroup: AgentFunctionGroup = {
  name: 'myGroup',
  description: '我的模块',
  functions: [listMyData, createMyData],
};
```

### Step 4: 实现 Function Handler

```typescript
// src/rtc-agent/groups/my-group/list.ts
import { z, withMeta } from '@rtc-agent/component';
import type { FunctionDef } from '@rtc-agent/component';

export const listMyData: FunctionDef = {
  name: 'list',
  description: '查询数据列表',
  zodSchema: z.object({ /* params */ }),
  returns: { zodSchema: z.object({ /* returns */ }) },
  handler: async (params) => {
    // 调用页面 API（不是直接操作 DOM 或后端）
    const pageAPI = window.__pages__?.myPage;
    if (!pageAPI) {
      throw new Error('Page not loaded. Please navigate to the page first.');
    }
    return await pageAPI.list(params);
  },
};
```

### Step 5: 注册到总入口

```typescript
// src/rtc-agent/index.ts
import { myGroup } from './groups/my-group';

export function createAdminAgentConfig(): Partial<AgentConfig> {
  return {
    groups: [myGroup, /* ... */],
  };
}
```

### Step 6: 编写 E2E Spec

```typescript
// src/rtc-agent/e2e/specs/my-group.spec.ts
import { expect, test } from '../fixtures/rtc-functions';

test.describe('myGroup', () => {
  test('list - 读取数据', async ({ callFunction }) => {
    const result = await callFunction('myGroup.list', {});
    expect(result).toHaveProperty('data');
  });
});
```

## 9. 命名规范

- **Group Name** - 小写名词，表示业务领域：`rule`, `user`, `order`
- **Function Name** - 动词或动宾短语：`list`, `create`, `update`
- **文件命名** - camelCase：`listRule.ts`, `createUser.ts`
- **Spec 命名** - camelCase + `.spec.ts`：`rule.spec.ts`
- **Page API 命名** - 与 Group 对应：`window.__pages__.rule`
- **路由路径** - `/` 分隔：`/list/table-list`

## 10. 注意事项

1. **Handler 调用 Page API** - 不直接操作 DOM，不绕过 UI 调后端
2. **Page API 返回 UI 数据** - 从 React Query 缓存或 actionRef 读取
3. **Page API 触发 UI 更新** - 使用 actionRef.reload() 等方法
4. **错误处理** - Handler 和 Page API 都应该捕获异常并返回结构化错误
5. **Hooks 是可选的** - 用于提供 UI 反馈（toast 等）
6. **zodSchema 优先** - 使用 Zod 而不是 OpenAPI 参数定义
7. **测试桥接仅限开发环境** - 生产环境不会暴露 `window.__rtc__`
8. **Page API 生命周期** - 页面挂载时注册，卸载时清理

## 11. 后续扩展

- **更多 Groups** - 根据 admin-ui 实际业务需求添加
- **Scenario 文档** - 为复杂工作流编写 AI 场景文档
- **Function 组合** - 支持 Function 之间的依赖和组合
- **权限控制** - 根据用户角色限制可访问的 Functions
- **审计日志** - 记录 Function 调用历史
