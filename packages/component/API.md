# createRtcAgent API

## 概述

`createRtcAgent(config: RtcAgentConfig): RtcAgentWithLifecycle` 是创建和配置 `<rtc-agent>` 实例的工厂函数。

它把声明式配置映射到组件属性，返回一个已配置好的 DOM 元素（附带 `destroy()` 生命周期方法），调用者只需将其 append 到 DOM 即可。

```ts
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({ /* ... */ });
document.body.appendChild(agent);
```

> **注意**：返回的元素 **不会** 自动挂载到 DOM，调用者必须自行 append。

---

## 配置选项 (`RtcAgentConfig`)

### 基础属性

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `appLabel` | `string` | `'RTC Agent'` | 标题栏 / 气泡 tooltip 文本 |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 视觉主题。`'system'` 跟随系统偏好 |
| `lang` | `string` | `'zh-CN'` | BCP 47 语言标签（如 `'zh-CN'`、`'en-US'`）。优先级：此属性 > localStorage > 浏览器语言 |
| `bubbleIcon` | `string` | — | SVG / HTML 字符串，渲染在最小化气泡内。组件内部会用 DOMPurify 做 sanitization |

### 服务端配置 (`server`)

| 属性 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `server.url` | `string` | 是 | 后端服务 URL（如 `'https://api.example.com'`） |
| `server.redirectUri` | `string` | 否 | OAuth 重定向 URI |

### 数据库配置

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `databaseName` | `string` | `rtc-agent-${userId}` | IndexedDB 数据库名前缀。**必须在挂载到 DOM 之前设置** |

### 场景文档

| 属性 | 类型 | 描述 |
|------|------|------|
| `scenariosUrl` | `string` | 场景文档 base URL，组件会自动加载 `manifest.json` 及关联的 `.md` 文件 |

### 窗口配置 (`window`)

类型：`WindowConfig`

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `defaultMode` | `'normal' \| 'maximized' \| 'minimized'` | `'normal'` | 默认窗口模式 |
| `initialPosition` | `{ x: number; y: number }` | 右下角 | 初始位置（仅 normal 模式） |
| `initialSize` | `{ width: number; height: number }` | `{420, 640}` | 初始尺寸（仅 normal 模式） |
| `minWidth` | `number` | `350` | 最小宽度 |
| `minHeight` | `number` | `520` | 最小高度 |
| `maxWidth` | `number` | `Infinity` | 最大宽度 |
| `maxHeight` | `number` | `Infinity` | 最大高度 |
| `draggable` | `boolean` | `true` | 是否允许拖拽 |
| `resizable` | `boolean` | `true` | 是否允许调整大小 |
| `showMinimize` | `boolean` | `true` | 是否显示最小化按钮 |
| `showMaximize` | `boolean` | `true` | 是否显示最大化按钮 |
| `showClose` | `boolean` | `false` | 是否显示关闭按钮（关闭 = 最小化） |
| `embedded` | `boolean` | `false` | 嵌入模式（禁用所有窗口交互，等同于 `draggable:false, resizable:false, showMinimize:false, showMaximize:false, showClose:false, defaultMode:'maximized'`） |
| `bubblePosition` | `BubblePosition` | 右下角 | 最小化气泡位置（见下文） |

#### BubblePosition

```ts
interface BubblePosition {
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  offset: { x: number; y: number };  // 数学笛卡尔坐标系
}
```

### Activity Bar 配置 (`activityBar`)

类型：`ActivityBarConfig`

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `disabledActivities` | `Array<'files' \| 'settings'>` | `[]` | 禁用的活动按钮（`chat` 始终显示，不可隐藏） |
| `defaultActivity` | `'files' \| 'chat' \| 'settings'` | `'chat'` | 默认活动 |

### Agent 配置

| 属性 | 类型 | 描述 |
|------|------|------|
| `agentName` | `string` | Agent 名称（用于 system prompt） |
| `agentDescription` | `string` | Agent 描述 |
| `persona` | `string` | AI 人设（system prompt） |
| `functions` | `FunctionDef[]` | 平铺函数列表（自动放入 `'default'` 组） |
| `groups` | `AgentFunctionGroup[]` | 分组函数列表 |

> `functions` 和 `groups` 可同时使用：groups 在前，functions 在后注册。

#### FunctionDef

```ts
interface FunctionDef {
  name: string;
  description: string;
  parameters?: ParameterDef[];  // OpenAPI 格式
  handler: (params: Record<string, unknown>, onProgress?: (progress: number) => void) => unknown;
}
```

#### AgentFunctionGroup

```ts
interface AgentFunctionGroup {
  name: string;
  description?: string;
  functions: FunctionDef[];
}
```

### 认证配置 (`auth`)

支持三种认证模式。如不提供，组件使用内部 OAuth 流程。

#### 模式 1: StaticTokenAuth

适用于长期有效、不需要自动刷新的 token。

```ts
auth: {
  accessToken: string;    // 必需：访问令牌
  refreshToken?: string;  // 可选：刷新令牌（静态模式暂不使用）
  userId: string;         // 必需：用户 ID
  expiresIn?: number;     // 可选：过期时间（秒）
}
```

#### 模式 2: DynamicTokenAuth（推荐）

适用于 token 会过期、需要自动刷新的场景。

```ts
auth: {
  getToken: () => string | Promise<string>;  // 每次需要 token 时调用
  refreshToken?: () => Promise<{             // token 过期时调用
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  userId: string;
}
```

#### 模式 3: AuthProvider

适用于多租户、自定义 token 轮换策略等复杂场景。

```ts
auth: {
  getToken: () => string | Promise<string>;
  refreshToken: () => Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  isLoggedIn: () => boolean;
  logout?: () => Promise<void>;
}
```

### 事件回调 (`on`)

类型：`EventCallbacks`

每个回调对应组件内部的 DOM CustomEvent，通过 `addEventListener()` 注册，`destroy()` 时自动清理。

#### 生命周期事件

| 回调 | 事件名 | 签名 | 描述 |
|------|--------|------|------|
| `ready` | `rtc-agent-ready` | `() => void` | 组件首次渲染完成 |
| `beforeDestroy` | `rtc-before-destroy` | `() => void` | 组件即将从 DOM 移除 |
| `themeChange` | `rtc-theme-change` | `(detail: { theme: 'light' \| 'dark' \| 'system' }) => void` | 主题变化 |

#### 连接 / 认证事件

| 回调 | 事件名 | 签名 | 描述 |
|------|--------|------|------|
| `connectionRetry` | `rtc-connection-retry` | `() => void` | 用户点击重连按钮 |
| `connectionStateChange` | `rtc-connection-state-change` | `(detail: { state: ConnectionState }) => void` | 连接状态变化 |
| `authLoginRequested` | `rtc-auth-login-requested` | `() => void` | 用户请求登录 |
| `authLogin` | `rtc-auth-login` | `(detail: { userId: string }) => void` | 登录成功 |
| `authError` | `rtc-auth-refresh-failed` | `() => void` | 认证错误 |
| `authLogout` | `rtc-auth-logout` | `() => void` | 用户登出 |

#### Session 事件

| 回调 | 事件名 | 签名 | 描述 |
|------|--------|------|------|
| `sessionCreated` | `rtc-session-created` | `(detail: { session: Session }) => void` | Session 创建 |
| `sessionSwitched` | `rtc-session-switched` | `(detail: { id: string }) => void` | Session 切换 |
| `sessionRenamed` | `rtc-session-renamed` | `(detail: { id: string; title: string }) => void` | Session 重命名 |
| `sessionDeleted` | `rtc-session-deleted` | `(detail: { id: string }) => void` | Session 删除 |

#### Message 事件

| 回调 | 事件名 | 签名 | 描述 |
|------|--------|------|------|
| `messageReceived` | `rtc-message-received` | `(detail: { message: Message }) => void` | 收到消息 |
| `messageSent` | `rtc-message-sent` | `(detail: { message: Message }) => void` | 消息已发送 |

#### 消息拦截

| 回调 | 签名 | 描述 |
|------|------|------|
| `beforeMessageSend` | `(detail: { message: { content: string; metadata?: Record<string, unknown> } }) => boolean \| Promise<boolean>` | 消息发送前拦截。返回 `false` 取消发送；可就地修改 `message.content` |

支持同步和异步回调：

```ts
// 同步过滤
beforeMessageSend: ({ message }) => {
  return !FORBIDDEN_WORDS.some(w => message.content.includes(w));
}

// 异步校验
beforeMessageSend: async ({ message }) => {
  const ok = await validateMessage(message.content);
  return ok;
}

// 就地修改
beforeMessageSend: ({ message }) => {
  message.content = message.content.trim();
  return true;
}
```

#### Tool Call 事件（EventBus 桥接）

| 回调 | EventBus 事件 | 签名 | 描述 |
|------|---------------|------|------|
| `toolCallStart` | `function:start` | `(detail: { path: string; params: Record<string, unknown> }) => void` | 工具调用开始 |
| `toolCallSuccess` | `function:success` | `(detail: { path: string; result: unknown }) => void` | 工具调用成功 |
| `toolCallError` | `function:error` | `(detail: { path: string; error: Error }) => void` | 工具调用失败 |
| `toolCallProgress` | `function:progress` | `(detail: { path: string; progress: number }) => void` | 工具调用进度 |

---

## 返回值 (`RtcAgentWithLifecycle`)

返回的实例是 `<rtc-agent>` 自定义元素，附带以下生命周期方法：

### `destroy(): void`

永久销毁 agent 实例，执行完整清理：

1. 从 DOM 移除元素（触发 `disconnectedCallback`）
2. 清除外部 token 引用
3. 取消所有 DOM 事件订阅
4. 取消所有 EventBus 订阅
5. 释放所有内部引用

调用 `destroy()` 后，实例不应再被使用。

---

## 类型导入

所有公共类型均可从 `@rtc-agent/component` 导入：

```ts
import type {
  // 工厂函数
  RtcAgentConfig,
  RtcAgentWithLifecycle,

  // 认证
  AuthConfig,
  StaticTokenAuth,
  DynamicTokenAuth,
  AuthProvider,

  // 事件
  EventCallbacks,

  // 数据模型
  Session,
  Message,
  ConnectionState,

  // 配置
  WindowConfig,
  ActivityBarConfig,
  AgentConfig,
  AgentFunctionGroup,
  FunctionDef,
} from '@rtc-agent/component';
```
