# RTC Agent 开发者体验改进设计

**日期**: 2026-09-26  
**状态**: 设计中  
**作者**: Claude + RTC Agent Team

---

## 1. 背景

### 1.1 现状分析

当前 RTC Agent 通过 `<rtc-agent>` Web Component 集成，存在以下问题：

1. **分发方式受限**
   - 虽然 npm install 技术上可行，但宿主应用实际多使用 CDN import
   - 缺少统一的工厂函数，CDN 使用不够便捷

2. **配置分散**
   - 配置通过多个独立属性分散设置：`agentConfig`、`windowConfig`、`activityBarConfig`、`server-url`、`redirect-uri`、`scenarios-url`、`database-name` 等
   - 每个配置对象需要通过独立的 JS setter 设置，缺乏统一入口
   - 时序问题需要开发者小心处理（`connectedCallback` vs 属性设置，需要 `whenReady()` 或 `rtc-agent-ready` 事件）
   - 部分配置仅支持 HTML 属性（如 `server-url`），部分仅支持 JS 属性（如 `agentConfig`），使用不一致

3. **认证集成不灵活**
   - 组件内部管理 Token（OAuth 流程）
   - 宿主应用已登录的用户需要在组件中再次登录
   - 无法将 Token 管理权交给宿主应用

4. **回调事件不完整**
   - 事件系统覆盖不够全面
   - 缺少关键的生命周期、消息、工具调用、错误处理回调
   - 无法与宿主应用的状态管理、监控系统深度集成

### 1.2 目标

- 提供更简洁的集成方式（一个函数搞定）
- 支持宿主应用管理 Token（避免重复登录）
- 提供完整的回调事件系统
- 保持向后兼容

---

## 2. 设计方案

### 2.1 方案选型

| 方案 | 描述 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 增强现有 API | 逐步补充属性和事件 | 向后兼容，改动小 | API 仍然分散 |
| **B. 统一配置对象** | **`createRtcAgent(config)` 工厂函数** | **配置集中，TypeScript 友好，易扩展** | **需要引入新 API** |
| C. 声明式+命令式混合 | HTML 基础配置 + JS 高级控制 | 渐进式学习 | 两套 API 可能冲突 |

**选择方案 B**：统一配置对象，提供最佳开发者体验。

### 2.2 核心改进

| 方面 | 现状 | 改进后 |
| --- | --- | --- |
| 配置入口 | 分散的属性/setter | 统一的 `createRtcAgent(config)` |
| 认证 | 组件管理 Token | 宿主应用管理 Token |
| 回调 | 事件不完整 | 完整的生命周期/消息/工具/错误回调 |
| CDN 使用 | 需要手动指定路径 | 提供工厂函数，ESM/UMD 双支持 |

---

## 3. API 设计

### 3.1 工厂函数

```typescript
import { createRtcAgent } from '@rtc-agent/component';
import type { RtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent(config: RtcAgentConfig): RtcAgent;
```

> **返回值类型说明**：工厂函数返回 `RtcAgent` 类型（即 `<rtc-agent>` 组件类实例），而非泛化的 `HTMLElement`。
> 这样调用者可以直接访问组件特有的方法和属性（如 `agentConfig`、`registry` 等），无需类型断言。

### 3.2 配置对象结构

```typescript
interface RtcAgentConfig {
  // ===== 基础配置 =====
  /** 应用名称（标题栏显示，映射到现有 `app-label` HTML 属性） */
  appLabel?: string;
  /** 主题：'light' | 'dark' | 'system'（映射到现有 `theme` HTML 属性） */
  theme?: 'light' | 'dark' | 'system';
  /** 语言/地区（映射到现有 `lang` HTML 属性，支持 zh-CN、en-US 等） */
  lang?: string;
  /** SVG/HTML 字符串，渲染在最小化 bubble 内（映射到现有 `bubble-icon` HTML 属性）
   *  @security 组件内部使用 DOMPurify 自动消毒（仅允许 SVG 相关标签和属性），
   *  但仍应避免传入不可信来源的内容。如果来自用户输入，调用者应额外在赋值前
   *  使用 DOMPurify 等工具消毒，实施纵深防御。
   */
  bubbleIcon?: string;
  
  // ===== 服务端配置 =====
  server?: {
    /** 后端服务 URL（映射到现有 `server-url` HTML 属性） */
    url: string;
    /** OAuth 回调 URL（映射到现有 `redirect-uri` HTML 属性，缺省为 `${origin}/auth/callback.html`） */
    redirectUri?: string;
  };
  
  // ===== 数据库配置 =====
  /** 自定义数据库名称前缀（映射到现有 `database-name` HTML 属性，数据库名变为 `${databaseName}-${userId}`）
   * 
   * @important 必须在元素挂载到 DOM 前设置，否则数据库可能已以默认名称打开。
   * 工厂函数会在 connectedCallback 前设置此属性。
   */
  databaseName?: string;
  
  // ===== 场景配置 =====
  /** 场景文档 URL（映射到现有 `scenarios-url` HTML 属性，自动加载 manifest.json + .md 文件） */
  scenariosUrl?: string;
  
  // ===== Shared Worker 配置 =====
  /**
   * Shared Worker 配置
   *
   * RTC Agent 使用 SharedWorker 托管持久化层（IndexedDB + WebSocket），
   * 实现跨 Tab 数据共享。宿主应用通常需要关注以下场景：
   *
   * - CDN 部署：Worker 脚本需跨域加载（组件内部自动通过 fetch → blob: URL 解决同源策略）
   * - CSP 策略：宿主应用 CSP 需允许 `worker-src blob:` 和 `media-src` 包含音效来源
   * - 多实例：页面内多个 `<rtc-agent>` 共享同一个 SharedWorker（浏览器级共享）
   *
   * @see 7.7 节 Shared Worker 集成指南
   */
  worker?: WorkerConfig;
  
  // ===== 通知与音频配置 =====
  /**
   * 通知与音频配置
   *
   * 控制消息通知的声音提示、Toast 弹窗等行为。
   * 音频资源（MP3）由组件内部打包，通过 Vite 的 `?url` 后缀解析为可访问的 URL。
   *
   * @see 7.8 节音频集成指南
   */
  notification?: NotificationConfig;
  
  // ===== 认证配置（三种模式） =====
  auth?: AuthConfig;
  
  // ===== 窗口配置 =====
  /**
   * 窗口配置（映射到现有 `windowConfig` 属性）
   *
   * 注意：字段名与现有 WindowConfig 接口保持一致（initialPosition / initialSize），
   * 而非简写为 position / size。
   */
  window?: WindowConfig;
  
  // ===== Activity Bar 配置 =====
  /**
   * Activity Bar 配置（映射到现有 `activityBarConfig` 属性）
   *
   * 注意：这是一个独立的配置对象，不是 ui 的子字段。
   * chat 按钮始终显示，不可隐藏。
   */
  activityBar?: ActivityBarConfig;
  
  // ===== Functions 配置 =====
  /** Agent 名称（映射到 `AgentConfig.name`，用于 system prompt 等场景，缺省使用 `appLabel`） */
  agentName?: string;
  /** Agent 描述（映射到 `AgentConfig.description`） */
  agentDescription?: string;
  /** 扁平函数列表（自动放入名为 'default' 的 group） */
  functions?: FunctionDef[];
  /** 分组函数列表 */
  groups?: AgentFunctionGroup[];
  /** AI 人设（system prompt） */
  persona?: string;
  
  // ===== 事件回调 =====
  on?: RtcAgentCallbacks;
}
```

> **命名对齐说明**：`createRtcAgent(config)` 工厂函数内部会将此配置对象拆解并映射到 `<rtc-agent>` 组件的现有属性：
>
> | RtcAgentConfig 字段 | 映射目标 | 映射方式 |
> | --- | --- | --- |
> | `appLabel` | `element.appLabel` | 直接赋值 |
> | `theme` | `element.theme` | 直接赋值 |
> | `lang` | `element.lang` | 直接赋值 |
> | `bubbleIcon` | `element.bubbleIcon` | 直接赋值 |
> | `server.url` | `element.serverURL` | 赋值（setter 内部自动调用 `setServerUrl()`） |
> | `server.redirectUri` | `element.redirectURI` | 赋值（setter 内部自动调用 `setRedirectUri()`） |
> | `databaseName` | `element.databaseName` | 直接赋值 |
> | `scenariosUrl` | `element.scenariosURL` | 直接赋值 |
> | `window` | `element.windowConfig` | 直接赋值 |
> | `activityBar` | `element.activityBarConfig` | 直接赋值 |
> | `agentName` + `agentDescription` + `functions` + `groups` + `persona` | `element.agentConfig` | 构建 `AgentConfig` 对象 |
> | `worker` | `WorkerBridge` 构造参数 | 透传到 WorkerBridge（`[需要新增]`：当前 WorkerBridge 不接受外部配置） |
> | `notification` | `SettingsController` 内部配置 | 映射到 `SettingsState.notifications`（`soundEnabled`/`toastEnabled` 已实现；`volume` `[需要新增]`） |
> | `on` | `addEventListener()` | 逐个注册回调 |

### 3.2a Shared Worker 配置

> **实施状态**：以下字段均为 `[需要新增]`。当前代码中 Worker 名称硬编码为 `'rtc-agent-worker'`
> （`worker-bridge.ts:262`），Worker 脚本路径由 Vite `?sharedworker` 导入自动解析，无自定义机制。
> 实施时需在 `WorkerBridge._initWorkerOnce()` 中读取 `WorkerConfig` 并应用到 SharedWorker 构造。

```typescript
interface WorkerConfig {
  /**
   * 自定义 Worker 脚本 URL
   *
   * [需要新增] 当前代码不支持自定义 Worker 脚本 URL。
   * Worker 脚本路径由 Vite `?sharedworker` 导入自动解析，跨域时通过
   * fetch → blob: URL 转换（worker-bridge.ts:239-268）解决同源策略。
   *
   * 默认行为：组件通过 Vite 的 `?sharedworker` 导入自动解析 Worker 脚本路径。
   * 跨域部署时（如 CDN），组件内部自动执行 fetch → blob: URL 转换以满足同源策略。
   *
   * 仅在以下场景需要自定义：
   * - Worker 脚本部署在独立的 CDN 域名
   * - 需要将 Worker 脚本与主包分离加载（按需加载优化）
   * - 宿主应用有特殊的 Worker 加载策略（如 Service Worker 拦截）
   *
  * 实现路径：在 `WorkerBridge` 构造函数中接受 `scriptURL` 参数。
   * 如果提供了 `scriptURL`，跳过 `extractWorkerRelativePath()` 和 `fetch → blob:`
   * 流程，直接使用 `new SharedWorker(scriptURL, { type: 'module', name })` 构造。
   * 注意：自定义 URL 必须是绝对路径或相对于页面 origin 的路径。
   * 如果 URL 跨域，CDN 必须返回 CORS 头（Access-Control-Allow-Origin）。
   *
   * @important 自定义 Worker 脚本必须是 ES Module 格式（使用 `import`/`export` 语法），
   * 因为组件始终以 `type: 'module'` 构造 SharedWorker。
   * 如果提供经典 Worker 脚本（使用 `importScripts()`），会加载失败。
   *
   * @important 如果 `scriptURL` 跨域，**不会**走内置的 fetch → blob: 转换流程。
   * 内置流程（`worker-bridge.ts:239-269`）仅处理 Vite 构建自动解析的 Worker 路径。
   * 自定义 `scriptURL` 由调用者负责确保 CDN 返回 CORS 头，且脚本为 ES Module 格式。
   * 如果宿主应用无法确保 CDN 返回 CORS 头，应将 Worker 脚本部署在宿主应用同域，
   * 并通过 `scriptURL` 提供同源路径。
   */
  scriptURL?: string;
  
  /**
   * SharedWorker 名称（映射到 SharedWorker 构造函数的 options.name）
   *
   * [需要新增] 当前代码硬编码为 `'rtc-agent-worker'`（worker-bridge.ts:262）。
   *
   * 默认值: 'rtc-agent-worker'
   *
   * 同一名称的 SharedWorker 在浏览器中共享同一实例。
   * 如果宿主应用需要多个独立的 RTC Agent 实例（不同用户/不同环境），
   * 应为每个实例设置不同的 worker.name，避免数据混淆。
   *
   * 实现路径：在 `WorkerBridge` 构造函数中接受 `name` 参数，
   * 传递给 `new SharedWorker(blobUrl, { name, type: 'module' })` 和
   * `workerFactory()` 的同源路径。
   *
   * @see 7.7.3 多实例隔离
   */
  name?: string;
}
```

### 3.2b 通知与音频配置

> **实施状态**：`soundEnabled` 和 `toastEnabled` 对应现有 `SettingsState.notifications` 字段
> （`contexts/settings.ts:23-26`），可通过 `SettingsController.updateNotifications()` 映射。
> `volume` 为 `[需要新增]`：当前代码中音量硬编码为 `1.0`（`notification.controller.ts:205`），
> `SettingsState.notifications` 无 `volume` 字段。实施时需扩展 `SettingsState.notifications`
> 接口并在 `_playSound()` 中读取。

```typescript
interface NotificationConfig {
  /**
   * 是否启用声音提示
   *
   * 默认值: true
   *
   * 映射到 `SettingsState.notifications.soundEnabled`（已实现）。
   *
   * 声音提示受浏览器自动播放策略限制：
   * - 用户首次与页面交互（点击/键盘）前，音频播放会被浏览器阻止
   * - 组件内部已处理 NotAllowedError，降级为无声通知
   * - 如果宿主应用需要强制启用音频，可在用户首次交互后调用此配置
   *
   * @see 7.8.1 自动播放策略处理
   */
  soundEnabled?: boolean;
  
  /**
   * 是否启用 Toast 弹窗通知
   *
   * 默认值: true
   *
   * 映射到 `SettingsState.notifications.toastEnabled`（已实现）。
   *
   * Toast 通知在非最小化模式下显示。最小化模式下改为图标脉冲动画。
   */
  toastEnabled?: boolean;
  
  /**
   * 音频音量（0.0 - 1.0）
   *
   * [需要新增] 当前代码中音量硬编码为 `1.0`（notification.controller.ts:205）。
   * SettingsState.notifications 接口无 volume 字段。
   *
   * 默认值: 1.0
   *
   * 控制所有通知音效的音量。宿主应用可根据自身音频策略调整。
   *
   * 实现路径：
   * 1. 扩展 `SettingsState.notifications` 接口，添加 `volume: number` 字段
   * 2. 在 `DEFAULT_SETTINGS_STATE.notifications` 中设置默认值 `1.0`
   * 3. 在 `_playSound()` 方法中读取 `settings.volume` 替代硬编码的 `1.0`
   * 4. 在设置面板中添加音量滑块控件（可选，MVP 阶段可不提供 UI）
   */
  volume?: number;
}
```

### 3.3 认证配置

支持三种模式，按需选择。`AuthConfig` 是三种模式的联合类型：

```typescript
type AuthConfig = StaticTokenAuth | DynamicTokenAuth | AuthProvider;
```

> **与现有实现的映射**：当前 `<rtc-agent>` 组件内部通过 `AuthController` 管理认证状态（`AuthState`：`isLoggedIn`、`accessToken`、`refreshToken`、`userId`、`expiresAt`），Token 存储在 `localStorage` 中，OAuth 流程由组件内部驱动。新增的外部 Token 配置需要扩展 `AuthController`，支持跳过 OAuth 流程直接使用外部 Token。

#### 模式 1：静态 Token（最简单）

```typescript
interface StaticTokenAuth {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  /** Token 过期时间（秒），不设置则不自动刷新 */
  expiresIn?: number;
}
```

**使用场景**：Token 不会变化，或由宿主应用负责刷新。组件不会主动刷新 Token（因为没有 `refreshToken` 回调）。

> **注意**：此模式对应现有 `AuthController.setTokens()` 方法直接设置 Token 状态，但需要新增逻辑跳过 OAuth 流程。

#### 模式 2：动态 Token（推荐）

```typescript
interface DynamicTokenAuth {
  /** 每次需要 Token 时调用（如 WebSocket 连接、API 请求） */
  getToken: () => string | Promise<string>;
  /** Token 刷新回调（组件检测到过期时调用） */
  refreshToken?: () => Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  userId: string;
}
```

**使用场景**：Token 会过期，需要动态获取和刷新。

> **与现有实现的集成**：此模式需要扩展 `AuthController`，将 `getToken()` 作为 `getAccessToken()` 的来源，将 `refreshToken()` 作为内部刷新逻辑的替代。现有的 `_scheduleRefresh()` 机制可复用。

#### 模式 3：AuthProvider（高级）

```typescript
interface AuthProvider {
  getToken(): string | Promise<string>;
  refreshToken(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  isLoggedIn(): boolean;
  /** 退出登录（可选）。提供后，组件内的退出操作会委托给宿主应用 */
  logout?(): Promise<void>;
}
```

**使用场景**：完全控制认证流程（多租户、Token 轮转等）。

> **配置识别规则**：`createRtcAgent` 内部通过检测 `auth` 对象的字段来区分三种模式：
>
> - 有 `accessToken` 字段 → 模式 1（StaticTokenAuth）
> - 有 `getToken` 字段且无 `isLoggedIn` 方法 → 模式 2（DynamicTokenAuth）
> - 有 `isLoggedIn` 方法 → 模式 3（AuthProvider）

### 3.4 回调事件

回调事件通过 `on` 字段注册。工厂函数内部会将每个回调映射到对应的 `addEventListener()` 调用。

> **与现有事件系统的映射**：当前 `<rtc-agent>` 组件已经派发了一系列自定义事件（遵循 `rtc-<domain>-<action>-<past-tense>` 命名规范）。`RtcAgentCallbacks` 中的回调分为两类：
>
> 1. **已有事件映射**：对应已存在的 DOM CustomEvent，工厂函数直接通过 `addEventListener()` 桥接
> 2. **需要新增的事件**：当前缺少对应 DOM 事件的回调，需要在实施时新增事件派发逻辑
> 3. **EventBus 桥接**：工具调用事件来源于内部 EventBus（`function:start/success/error/progress`），需要桥接到 DOM 事件或直接通过 `eventBus.on()` 注册

```typescript
// Session 和 Message 是组件内部 types/index.ts 定义的 UI 层类型
// （注意：与 @rtc-agent/protocol 的同名服务端模型字段名不同，见 8.3 节说明）
// 当前未从 @rtc-agent/component 主入口导出，Phase 1 需补充导出
import type { Session, Message } from '@rtc-agent/component';
import type { ConnectionState } from '@rtc-agent/client';

interface RtcAgentCallbacks {
  // ===== 生命周期 =====
  /** 组件首次渲染完成（映射到 `rtc-agent-ready` 事件，已存在） */
  ready?: () => void;
  /**
   * 组件即将从 DOM 卸载
   *
   * [需要新增] 在 `disconnectedCallback` 中派发（在任何清理操作之前）。
   *
   * 注意：Web Component 的 `disconnectedCallback` 可能在元素被临时移除时也触发，
   * 并不一定意味着"永久销毁"。
   *
   * 实现路径：在 `disconnectedCallback` 最开始处派发事件，然后再执行清理逻辑
   * （移除事件监听、清理 controller 等）。这样监听器可以访问完整的组件状态。
   *
   * 建议同时提供显式的 `destroy()` 方法用于永久销毁场景
   * （清除 localStorage Token、取消 EventBus 订阅等），
   * 而 `disconnectedCallback` 只处理 DOM 层面的清理。
   */
  beforeDestroy?: () => void;
  
  // ===== 连接/认证 =====
  /**
   * 连接状态变化
   *
   * [需要新增] 映射到内部 `_connectionState` 状态变化。
   * 当前实现中连接状态通过 `@state() _connectionState` 追踪，但不派发 DOM 事件。
   * 需要在连接状态变化时派发新的 `rtc-connection-state-change` 事件。
   *
   * 参数类型为 `ConnectionState`（来自 `@rtc-agent/client`），
   * 取值为 `'disconnected' | 'connecting' | 'connected' | 'reconnecting'`。
   * 注意：没有 `'error'` 状态 — 连接错误时状态为 `'disconnected'`。
   *
   * 实现路径：在 `_connectionState` 赋值处（rtc-agent.ts 的 `onConnectionStateChange` 回调）
   * 同时派发 DOM 事件，而非将 `@state()` 改为自定义 setter。
   */
  connectionStateChange?: (state: ConnectionState) => void;
  /**
   * 用户点击重试按钮（连接失败时）
   *
   * 映射到 `rtc-connection-retry` 事件（已存在，从 `rtc-title-bar` 派发）
   */
  connectionRetry?: () => void;
  /** 用户请求登录（映射到 `rtc-auth-login-requested` 事件，已存在） */
  authLoginRequested?: () => void;
  /**
   * 登录成功（当前 Token 加载或刷新完成后触发）
   *
   * [需要新增] 当前 `AuthController` 有内部 `onLogin` 回调，但不派发 DOM 事件。
   * 需要新增 `rtc-auth-login` 事件派发，detail 包含 `{ userId }`。
   */
  authLogin?: (user: { userId: string }) => void;
  /**
   * 认证错误
   *
   * 映射到 `rtc-auth-refresh-failed` 事件（已存在）。
   * 注意：该事件当前无 detail（void），如需错误详情需扩展事件。
   */
  authError?: () => void;
  /** 用户退出登录（映射到 `rtc-auth-logout` 事件，已存在） */
  authLogout?: () => void;
  
  // ===== Session =====
  /**
   * Session 创建
   *
   * 映射到 `rtc-session-created` 事件（已存在）。
   * 事件 detail 包含完整的 Session 对象。
   */
  sessionCreated?: (detail: { session: Session }) => void;
  /**
   * Session 切换
   *
   * 映射到 `rtc-session-switched` 事件（已存在）。
   * 注意：detail 只有 session clientId，不含 title。
   */
  sessionSwitched?: (detail: { id: string }) => void;
  /**
   * Session 重命名
   *
   * 映射到 `rtc-session-renamed` 事件（已存在）。
   */
  sessionRenamed?: (detail: { id: string; title: string }) => void;
  /**
   * Session 删除
   *
   * 映射到 `rtc-session-deleted` 事件（已存在）。
   * 注意：detail 字段为 `id`（不是 `sessionId`）。
   */
  sessionDeleted?: (detail: { id: string }) => void;
  
  // ===== 消息 =====
  /**
   * 发送前拦截（可修改/阻止）
   *
   * [需要新增] 需要扩展 MessageController.sendMessage()，当前消息发送不经过拦截机制。
   *
   * 返回 `false` 可阻止消息发送。
   * 返回新 ContentData 可修改消息内容。
   * 返回 `void`/`undefined`/`true` 表示放行。
   * 支持异步返回值（Promise），工厂函数内部自动 await。
   *
   * 注意：参数类型为 ContentData（`{ type: ContentType; data: unknown }`），
   * 与内部 MessageActions.sendMessage() 保持一致。
   *
   * 实现路径：在 `rtc-agent.ts` 的 `_boundOnInputSubmit` 处理器中，
   * 在调用 `sendMessage()` 或 `submitFork()` 之前调用拦截器。
   * 拦截器同时覆盖普通消息发送和 fork 场景（两者均携带 ContentData）。
   */
  beforeMessageSend?: (content: ContentData) => 
    boolean | void | ContentData | Promise<boolean | void | ContentData>;
  /**
   * 消息发送成功
   *
   * 映射到 `rtc-message-sent` 事件（已存在）。
   * 事件 detail 包含完整的 Message 对象。
   */
  messageSent?: (detail: { message: Message }) => void;
  /**
   * 收到 AI 回复
   *
   * [需要新增] 当前没有对应的 DOM 事件。
   *
   * 触发时机：AI 消息流式完成后（`streaming: false`）。
   * 消息接收走 UIUpdateBus 路径：
   *   Centrifuge → 持久化层 → UIUpdateBus → MessageController.updateMessageFromBus()
   *
   * 实现路径：在 `MessageController.updateMessageFromBus()` 中检测消息角色为
   * `'assistant'` 且 `streaming === false` 时，派发 `rtc-message-received` 事件。
   * 注意：UIUpdateBus 会对同一条消息多次触发（每次 streaming chunk），
   * 必须仅在 `streaming` 从 `true` 变为 `false` 时派发，避免重复触发。
   */
  messageReceived?: (detail: { message: Message }) => void;
  
  // ===== 工具调用 =====
  /**
   * 工具调用事件
   *
   * 映射到现有 EventBus 事件（注意：EventBus 事件，非 DOM 事件）：
   * - function:start → toolCallStart
   * - function:success → toolCallSuccess
   * - function:error → toolCallError
   * - function:progress → toolCallProgress
   *
   * 注意：
   * - EventBus 使用 `path`（完全限定名，如 `user.getInfo`），不是 `name`
   * - EventBus 事件没有 `id` 字段
   * - 工厂函数需要通过 `eventBus.on()` 注册，而非 `addEventListener()`
   *
   * 参数类型来源于 core/event-bus.ts 的 FunctionStartEvent 等接口。
   */
  toolCallStart?: (event: { path: string; params: Record<string, unknown> }) => void;
  toolCallSuccess?: (event: { path: string; result: unknown }) => void;
  toolCallError?: (event: { path: string; error: Error }) => void;
  toolCallProgress?: (event: { path: string; progress: number }) => void;
  
  /**
   * Tool Call 审批事件（映射到现有 DOM 事件）
   *
   * 注意区分：
   * - toolCallStart/Success/Error/Progress → EventBus 事件（function:*），记录函数执行过程
   * - toolCallApproved/Denied → DOM CustomEvent（rtc-tool-call-*），记录用户审批操作
   */
  toolCallApproved?: (detail: { id: string; toolName?: string }) => void;
  /** 某类 Tool Call 全部批准（映射到 `rtc-tool-call-approve-all` 事件，已存在） */
  toolCallApproveAll?: (detail: { toolName: string }) => void;
  toolCallDenied?: (detail: { id: string }) => void;
  
  // ===== UI =====
  /** 窗口最小化（映射到 `rtc-window-minimize` 事件，已存在） */
  windowMinimize?: () => void;
  /** 窗口最大化（映射到 `rtc-window-maximize` 事件，已存在） */
  windowMaximize?: () => void;
  /** 窗口恢复（映射到 `rtc-window-restore` 事件，已存在） */
  windowRestore?: () => void;
  /**
   * 主题变化
   *
   * [需要新增] 当前 `theme` 属性变更不派发事件。
   * 需要在 theme setter 中派发 `rtc-theme-change` 事件。
   *
   * 实现路径：当前 `theme` 是简单的 `@property({type: String, reflect: true})`。
   * 需转为自定义 getter/setter（与 `lang` 属性类似的模式），在 setter 中派发事件。
   * 或者在 `updated()` 生命周期中检测 `theme` 变化并派发。
   */
  themeChange?: (theme: 'light' | 'dark' | 'system') => void;
  
  // ===== 生成控制 =====
  /**
   * 用户请求停止生成（映射到 `rtc-stop-requested` 事件，已存在）
   *
   * 从 `rtc-input-area` 派发，用户点击停止按钮时触发。
   * 事件 detail 包含 `{ sessionClientId: string }`，标识要停止的 Session。
   * 宿主应用可据此更新自身 UI 状态（如隐藏"生成中"指示器）。
   */
  generationStopped?: (detail: { sessionClientId: string }) => void;
  
  // ===== 错误 =====
  /**
   * 全局错误捕获
   *
   * 映射到 `AgentConfig.onError`。
   * 如果同时配置了 `on.error` 和 `on` 外的 `agentConfig.onError`，`on.error` 优先。
   */
  error?: (error: Error, context: string) => void;
}
```

---

## 4. 使用示例

### 4.1 基础使用

```typescript
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({
  appLabel: '客服助手',
  theme: 'system',
  server: {
    url: 'https://api.example.com'
  }
});

document.body.appendChild(agent);
```

### 4.2 完整配置

```typescript
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({
  // 基础配置
  appLabel: '客服助手',
  theme: 'system',
  lang: 'zh-CN',
  bubbleIcon: '<svg>...</svg>',
  
  // 服务端
  server: {
    url: 'https://api.example.com',
    redirectUri: 'https://myapp.com/callback'
  },
  
  // 数据库（可选：自定义数据库名称前缀）
  databaseName: 'my-app',
  
  // 场景文档（可选：自动加载场景文档到 VirtualFS）
  scenariosUrl: './scenarios/',
  
  // 认证（宿主应用管理 Token — 模式 2: 动态 Token）
  auth: {
    getToken: () => authService.getLatestToken(),
    refreshToken: async () => {
      const token = await authService.refresh();
      return { accessToken: token.access };
    },
    userId: authService.getUserId()
  },
  
  // 窗口配置（字段名与现有 WindowConfig 接口保持一致）
  window: {
    defaultMode: 'normal',
    initialPosition: { x: -20, y: 20 },  // 相对于默认锚点的偏移
    initialSize: { width: 420, height: 640 },
    draggable: true,
    resizable: true,
    showMinimize: true,
    showMaximize: true,
    // embedded: true,  // 嵌入模式：禁用所有窗口交互，等效于 defaultMode:'maximized' + 禁用拖拽/缩放/按钮
    bubblePosition: {
      corner: 'bottom-right',
      offset: { x: -20, y: 20 }
    }
  },
  
  // Activity Bar 配置（独立于 window 配置）
  activityBar: {
    disabledActivities: ['files'],  // chat 始终显示，不可隐藏
    defaultActivity: 'chat'
  },
  
  // Functions（使用 OpenAPI 格式参数定义，与现有 FunctionDef 保持一致）
  functions: [
    {
      name: 'getUserInfo',
      description: '获取当前登录用户的信息',
      parameters: [
        {
          name: 'userId',
          schema: { type: 'string', description: '用户 ID' },
          required: true
        }
      ],
      handler: async ({ userId }) => {
        return await api.getUser(userId);
      }
    }
  ],
  
  // 回调
  on: {
    ready: () => console.log('Agent ready'),
    connectionStateChange: (state) => console.log('Connection:', state),
    authLogin: (user) => analytics.track('login', user),
    authLogout: () => analytics.track('logout'),
    messageSent: (detail) => analytics.track('message', detail.message),
    sessionCreated: (detail) => console.log('Session:', detail.session.title),
    toolCallStart: (event) => console.log('Tool:', event.path),
    toolCallApproved: (detail) => console.log('Approved:', detail.toolName),
    windowMinimize: () => console.log('Minimized'),
    error: (err, ctx) => sentry.captureException(err, { extra: { ctx } })
  }
});

document.body.appendChild(agent);
```

### 4.3 CDN 使用（ES Module）

```html
<script type="module">
  // 生产环境建议固定版本号，避免 @latest 引入非预期破坏性变更
  import { createRtcAgent } from 'https://cdn.jsdelivr.net/npm/@rtc-agent/component@0.1.0/dist/index.js';
  
  const agent = createRtcAgent({
    appLabel: '客服助手',
    server: { url: 'https://api.example.com' }
  });
  
  document.body.appendChild(agent);
</script>
```

> **版本选择**：将 `@0.1.0` 替换为实际使用的版本。可使用 `@^0.1.0` 自动获取兼容更新，或 `@latest` 始终使用最新版（仅推荐开发环境）。

### 4.4 CDN 使用（UMD）

```html
<!-- 生产环境建议固定版本号 -->
<script src="https://cdn.jsdelivr.net/npm/@rtc-agent/component@0.1.0/dist/index.umd.js"></script>
<script>
  // UMD 全局变量名为 RtcAgentModule（与 vite.config.ts 中的 lib.name 一致）
  const { createRtcAgent } = window.RtcAgentModule;
  
  const agent = createRtcAgent({
    appLabel: '客服助手',
    server: { url: 'https://api.example.com' }
  });
  
  document.body.appendChild(agent);
</script>
```

### 4.5 当前推荐用法（不依赖 createRtcAgent）

在 `createRtcAgent()` 工厂函数实现之前，推荐使用 `whenReady()` + 直接属性赋值的方式：

```typescript
import { whenReady } from '@rtc-agent/component';
import type { RtcAgent } from '@rtc-agent/component';

await whenReady();
const agent = document.querySelector<RtcAgent>('#agent')!;

// 声明式配置（函数注册）
agent.agentConfig = {
  persona: 'You are a helpful assistant...',
  functions: [
    {
      name: 'getUserInfo',
      description: '获取用户信息',
      parameters: [
        { name: 'userId', schema: { type: 'string' }, required: true }
      ],
      handler: async ({ userId }) => ({ id: userId, name: 'Alice' })
    }
  ]
};

// 窗口配置
agent.windowConfig = {
  defaultMode: 'normal',
  initialSize: { width: 420, height: 640 },
  embedded: false
};

// Activity Bar 配置
agent.activityBarConfig = {
  disabledActivities: ['files'],
  defaultActivity: 'chat'
};

// 监听就绪事件
agent.addEventListener('rtc-agent-ready', () => {
  console.log('Agent is ready');
});
```

或者使用 HTML 属性方式设置基础配置：

```html
<rtc-agent
  id="agent"
  theme="dark"
  app-label="客服助手"
  lang="zh-CN"
  server-url="https://api.example.com"
  database-name="my-app"
></rtc-agent>
```

---

## 5. 迁移指南

### 5.1 从 HTML 属性 + JS 属性迁移

**Before（当前用法）：**

```html
<rtc-agent
  theme="dark"
  app-label="客服助手"
  server-url="https://api.example.com"
  database-name="my-app"
></rtc-agent>
<script type="module">
  import { whenReady } from '@rtc-agent/component';
  await whenReady();
  const agent = document.querySelector('rtc-agent');
  agent.agentConfig = { persona: '...', functions: [...] };
  agent.windowConfig = { defaultMode: 'normal', initialSize: { width: 420, height: 640 } };
  agent.activityBarConfig = { disabledActivities: ['files'] };
</script>
```

**After（使用 createRtcAgent）：**

```typescript
const agent = createRtcAgent({
  theme: 'dark',
  appLabel: '客服助手',
  server: { url: 'https://api.example.com' },
  databaseName: 'my-app',
  persona: '...',
  functions: [...],
  window: { defaultMode: 'normal', initialSize: { width: 420, height: 640 } },
  activityBar: { disabledActivities: ['files'] }
});
document.body.appendChild(agent);
```

### 5.2 从命令式 Registry 迁移

**Before（当前高级用法）：**

```typescript
import { defineRegistry } from '@rtc-agent/component';

const registry = defineRegistry({ name: 'MyApp', description: 'My application' });
const group = registry.createGroup({ name: 'user', description: 'User operations' });
group.register({
  name: 'getInfo',
  description: '获取用户信息',
  handler: () => currentUser
});

await whenReady();
const agent = document.querySelector('rtc-agent');
agent.registry = registry;
```

**After（使用 createRtcAgent 的 functions + groups）：**

```typescript
const agent = createRtcAgent({
  groups: [
    {
      name: 'user',
      description: '用户操作',
      functions: [
        {
          name: 'getInfo',
          description: '获取用户信息',
          handler: () => currentUser
        }
      ]
    }
  ]
});
```

> **注意**：`functions` 中的函数名会自动添加 group 前缀，所以 `user` group 下的 `getInfo` 会注册为 `user.getInfo`。这与现有 `FunctionGroup.register()` 的行为一致。

### 5.3 认证迁移

**Before（组件内部 OAuth 登录）：**

```html
<!-- 用户需要在组件中再次登录 -->
<rtc-agent server-url="https://api.example.com"></rtc-agent>
```

**After（宿主应用的登录状态直接传递给组件）：**

```typescript
const agent = createRtcAgent({
  server: { url: 'https://api.example.com' },
  auth: {
    getToken: () => myApp.getToken(),
    refreshToken: async () => {
      const result = await myApp.refreshToken();
      return { accessToken: result.access, refreshToken: result.refresh };
    },
    userId: myApp.getUserId()
  }
});
```

### 5.4 从 windowConfig 属性迁移

**Before：**

```typescript
agent.windowConfig = {
  defaultMode: 'maximized',
  initialPosition: { x: 100, y: 100 },
  initialSize: { width: 800, height: 600 },
  embedded: true,
  bubblePosition: { corner: 'bottom-right', offset: { x: -20, y: 20 } }
};
```

**After：**

```typescript
const agent = createRtcAgent({
  window: {
    defaultMode: 'maximized',
    initialPosition: { x: 100, y: 100 },
    initialSize: { width: 800, height: 600 },
    embedded: true,
    bubblePosition: { corner: 'bottom-right', offset: { x: -20, y: 20 } }
  }
});
```

> **说明**：`window` 配置字段与现有 `WindowConfig` 接口完全一致，只是嵌套在 `createRtcAgent` 配置对象中。

### 5.5 从 activityBarConfig 属性迁移

**Before：**

```typescript
agent.activityBarConfig = {
  disabledActivities: ['files', 'settings'],
  defaultActivity: 'chat'
};
```

**After：**

```typescript
const agent = createRtcAgent({
  activityBar: {
    disabledActivities: ['files', 'settings'],
    defaultActivity: 'chat'
  }
});
```

> **注意**：`createRtcAgent` 中使用 `activityBar` 而非 `activityBarConfig`，避免冗余的 `Config` 后缀。

### 5.6 事件监听迁移

**Before（使用 addEventListener）：**

```typescript
agent.addEventListener('rtc-agent-ready', () => { ... });
agent.addEventListener('rtc-auth-logout', () => { ... });
agent.addEventListener('rtc-tool-call-approved', (e) => { ... });
agent.addEventListener('rtc-window-minimize', () => { ... });
```

**After（使用 on 回调对象）：**

```typescript
const agent = createRtcAgent({
  on: {
    ready: () => { ... },
    authLogout: () => { ... },
    toolCallApproved: (detail) => { ... },
    toolCallApproveAll: (detail) => { ... },
    windowMinimize: () => { ... },
    sessionCreated: (detail) => { ... },
    sessionRenamed: (detail) => { ... },
    messageSent: (detail) => { ... }
  }
});
```

> **说明**：`on` 回调中的名称去掉了 `rtc-` 前缀和中划线，转为 camelCase。底层仍然通过 `addEventListener` 实现（工具调用事件除外：`toolCallStart/Success/Error/Progress` 通过 `eventBus.on()` 注册），但命名更符合 JavaScript 回调惯例。

---

## 6. 实施计划

### Phase 1: 核心 API（1-2 周）

- [ ] 新建 `src/factory.ts`，实现 `createRtcAgent(config: RtcAgentConfig): RtcAgent` 工厂函数
- [ ] 工厂函数内部：创建 `<rtc-agent>` 元素，解析配置并映射到组件属性
  - 基础属性：`theme`、`appLabel`、`lang`、`bubbleIcon` → 直接赋值
  - 服务端配置：`server.url` → `element.serverURL`（setter 自动调用 `setServerUrl()`）；`server.redirectUri` → `element.redirectURI`（setter 自动调用 `setRedirectUri()`）
  - 配置对象：`window` → `windowConfig`、`activityBar` → `activityBarConfig`、`functions` + `groups` + `persona` → `agentConfig`
  - 回调注册：`on` 对象 → 逐个 `addEventListener()`（工具调用回调除外，走 `eventBus.on()`）
  - **安全说明**：`bubbleIcon` 组件内部已使用 DOMPurify 自动消毒（`_sanitizeBubbleIcon()`），工厂函数 JSDoc 应延续纵深防御的安全责任说明
- [ ] 在 `src/index.ts` 中导出 `createRtcAgent` 和相关类型（`RtcAgentConfig`、`AuthConfig`、`RtcAgentCallbacks` 等）
- [ ] 为返回的 `RtcAgent` 实例挂载 `destroy()` 方法（通过 `Object.assign` 或包装对象）
- [ ] 编写工厂函数单元测试（配置映射正确性、返回值类型）

### Phase 2: 认证集成（1-2 周）

- [ ] 扩展 `AuthController` 支持外部 Token 注入（三种模式识别）
- [ ] 模式 1（StaticTokenAuth）：直接设置 Token 状态，跳过 OAuth 流程，**不写入 localStorage**
- [ ] 模式 2（DynamicTokenAuth）：将 `getToken()` 作为 `getAccessToken()` 来源，`refreshToken()` 作为刷新回调
- [ ] 模式 3（AuthProvider）：完全委托认证逻辑给宿主应用
- [ ] 处理 Token 过期重试逻辑（复用现有 `_scheduleRefresh()` 机制 + `_refreshing` 锁）
- [ ] 外部 Token 模式添加 `_externalTokens` 标记，`_saveTokens()` 检查此标记跳过持久化
- [ ] 编写认证集成测试（模式切换、Token 过期、并发刷新竞态）

### Phase 3: 回调事件（1-2 周）

- [ ] 在工厂函数中注册 `on` 回调到对应事件
  - **已有 DOM 事件**（直接 `addEventListener` 桥接）：
    - `ready` → `rtc-agent-ready`
    - `authLoginRequested` → `rtc-auth-login-requested`
    - `authLogout` → `rtc-auth-logout`
    - `authError` → `rtc-auth-refresh-failed`
    - `connectionRetry` → `rtc-connection-retry`
    - `sessionCreated` → `rtc-session-created`
    - `sessionSwitched` → `rtc-session-switched`
    - `sessionRenamed` → `rtc-session-renamed`
    - `sessionDeleted` → `rtc-session-deleted`
    - `messageSent` → `rtc-message-sent`
    - `toolCallApproved` → `rtc-tool-call-approved`
    - `toolCallApproveAll` → `rtc-tool-call-approve-all`
    - `toolCallDenied` → `rtc-tool-call-denied`
    - `windowMinimize` → `rtc-window-minimize`
    - `windowMaximize` → `rtc-window-maximize`
    - `windowRestore` → `rtc-window-restore`
    - `generationStopped` → `rtc-stop-requested`
  - **EventBus 桥接**（通过 `eventBus.on()` 注册，非 DOM 事件）：
    - `toolCallStart` → `function:start`
    - `toolCallSuccess` → `function:success`
    - `toolCallError` → `function:error`
    - `toolCallProgress` → `function:progress`
    - **清理**：保存 `eventBus.on()` 返回的取消订阅函数，在 `disconnectedCallback` 中调用
  - **需要新增事件派发的回调**：
    - `connectionStateChange`：在 `onConnectionStateChange` 回调中派发 `rtc-connection-state-change` 事件（在 `_connectionState` 赋值处同时派发，而非改为自定义 setter）
    - `authLogin`：在 `AuthController.setTokens()` 和 `_doRefresh()` 成功后派发 `rtc-auth-login` 事件（detail: `{ userId }`）
    - `messageReceived`：在 `MessageController.updateMessageFromBus()` 中检测 `role === 'assistant'` 且 `streaming === false` 时派发 `rtc-message-received` 事件（仅在 streaming 结束时派发，避免重复）
    - `themeChange`：在 `theme` 属性变化时派发 `rtc-theme-change` 事件（需将 `@property` 转为自定义 getter/setter 或在 `updated()` 中检测变化）
    - `beforeDestroy`：在 `disconnectedCallback` **最开始**派发 `rtc-before-destroy` 事件（在清理操作之前）
- [ ] 实现 `beforeMessageSend` 拦截机制（在 `rtc-agent.ts` 的 `_boundOnInputSubmit` 处理器中，`sendMessage()` 和 `submitFork()` 调用之前。支持异步返回值，拦截器同时覆盖普通消息和 fork 场景）
- [ ] EventBus 订阅清理：在 `disconnectedCallback` 中取消所有 `eventBus.on()` 注册
- [ ] 编写事件测试（事件派发正确性、EventBus 桥接、清理逻辑、内存泄漏检测）

### Phase 4: 构建、分发和版本管理（1-2 周）

- [ ] 确认 vite.config.ts 的 `lib.name: 'RtcAgentModule'` 作为 UMD 全局变量名
- [ ] 确保 `createRtcAgent` 和所有新类型在 ESM/UMD 构建中正确导出
- [ ] 更新 `packages/component/package.json` 的 `exports` 字段，补充 `default` fallback（当前仅有 `import` 条件，部分构建工具如 Webpack 4 可能解析失败）：

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  }
}
```

- [ ] 将宿主应用常用类型（`WindowConfig`、`ActivityBarConfig`、`ContentData`、`Session`、`Message`）加入 `src/index.ts` 主入口导出列表
- [ ] 验证 CDN 使用场景（ESM 和 UMD），建议使用 jsDelivr 的版本号锁定（`@0.1.0`）而非 `@latest`
- [ ] 移除根 `package.json` 的 `"private": true`（当前为 monorepo 根，子包 `@rtc-agent/component` 可发布但根包未声明发布意图；如需发布子包至 npm，根包 `private: true` 不影响，但需在文档中明确说明发布流程）
- [ ] 建立版本策略：遵循 SemVer，破坏性变更在 CHANGELOG 中明确标注，提供迁移指南
- [ ] 编写文档和示例

### Phase 5: 迁移和文档（1 周）

- [ ] 更新 README 和文档站点
- [ ] 提供迁移工具（可选：自动检测旧属性用法并给出迁移建议）
- [ ] 发布新版本

---

## 7. 风险和注意事项

### 7.1 向后兼容

- 保留现有的 `<rtc-agent>` HTML 标签用法和所有 HTML 属性（`theme`、`app-label`、`server-url`、`redirect-uri`、`scenarios-url`、`database-name`、`bubble-icon`）
- 保留现有的 JS 属性（`agentConfig`、`windowConfig`、`activityBarConfig`、`registry`、`serverURL`、`redirectURI`、`scenariosURL`、`databaseName`）
- 保留现有的事件系统（`rtc-agent-ready`、`rtc-auth-*`、`rtc-tool-call-*`、`rtc-window-*` 等）
- `createRtcAgent` 是新增 API，不影响现有用户
- `whenReady()` Promise 和 `rtc-agent-ready` 事件继续可用

### 7.2 Token 安全

- 外部 Token 通过 JS 属性传递（`auth` 配置对象），不存储在 DOM 属性中
- Token 刷新失败时需要正确触发 `authError` 回调（映射到 `rtc-auth-refresh-failed` 事件）
- Token 过期时需要正确处理重试逻辑：
  - 静态 Token（模式 1）：不自动刷新，过期后显示登录界面
  - 动态 Token（模式 2）：调用 `refreshToken()` 回调，失败后清除 Token 并触发 `authError`
  - AuthProvider（模式 3）：完全由宿主应用处理
- 需要考虑并发刷新竞态（现有 `_refreshing` Promise 锁可复用）

**外部 Token 持久化策略**：

- 模式 1/2/3 的外部 Token **不应写入 localStorage**（区别于内部 OAuth Token）
  - 外部 Token 由宿主应用管理生命周期，组件只是消费者
  - 持久化到 localStorage 会导致组件卸载后 Token 残留，增加泄露风险
  - 需在 `AuthController` 扩展中添加 `_externalTokens` 标记，跳过 `_saveTokens()` 调用
- 如果宿主应用需要持久化，应由宿主应用自行管理

**XSS 防护**：

- `bubbleIcon` 属性接受 SVG/HTML 字符串，组件内部通过 `_sanitizeBubbleIcon()` 方法自动使用 DOMPurify 消毒（仅允许 SVG 相关标签和属性，如 `svg`、`path`、`g`、`circle` 等）
- DOMPurify 已是组件的现有依赖（`rtc-message` 渲染 Markdown 时使用），无需额外引入
- 源码属性注释建议："调用者负责在赋值前消毒"，这是纵深防御策略（组件作为最后一道安全网）
- `createRtcAgent` 工厂函数应在 JSDoc 中延续此安全责任说明，建议调用者仍避免传入不可信来源的内容
- 如果 DOMPurify 加载失败（`import('dompurify')` 抛异常），组件会 fallback 为 `textContent` 纯文本渲染（完全安全）

**内存安全**：

- 静态 Token（模式 1）的 `accessToken` 会作为 JS 对象属性在内存中驻留
- 组件销毁（`disconnectedCallback`）后，Token 引用仍可能被 `AuthController` 持有
- `destroy()` 方法需要显式清除 Token 引用（`_state = {isLoggedIn: false}`）

### 7.3 性能

- 回调函数应该是轻量级的，避免阻塞主流程
- `beforeMessageSend` 拦截器如果是异步的（返回 Promise），需要正确处理消息发送等待
- 回调注册通过 `addEventListener` 实现，浏览器原生事件系统负责内存管理
- 工厂函数创建的 `<rtc-agent>` 元素生命周期与普通组件一致（`connectedCallback` / `disconnectedCallback`）

### 7.4 配置冲突

- 如果同时使用 `createRtcAgent()` 和 HTML 属性，HTML 属性优先级更高（因为是直接设置在元素上的）
- 工厂函数应在元素挂载到 DOM 前设置所有属性，避免与 HTML 属性冲突
- 文档中应明确说明：推荐使用 `createRtcAgent()` 或 HTML 属性之一，不要混用

### 7.5 生命周期与资源清理

**`destroy()` 方法**：

工厂函数返回的 `RtcAgent` 实例应额外挂载一个 `destroy()` 方法（通过 `Object.assign` 或包装对象），用于确保完整清理：

```typescript
interface RtcAgentWithLifecycle extends RtcAgent {
  /** 永久销毁组件：清除 DOM、Token、EventBus 订阅、localStorage 数据 */
  destroy(): void;
}
```

`destroy()` 需要处理以下清理：

1. 从 DOM 中移除元素（触发 `disconnectedCallback`）
2. 清除外部 Token 引用（`AuthController._state = {isLoggedIn: false}`）
3. 取消所有 `eventBus.on()` 注册（工具调用事件桥接）
4. 可选：清除 localStorage 中与此组件相关的 Token（仅外部 Token 模式下）

**EventBus 订阅清理**：

工具调用回调（`toolCallStart/Success/Error/Progress`）通过 `eventBus.on()` 注册到全局单例。
`disconnectedCallback` 不会自动清理这些订阅，因为 `eventBus` 不感知 DOM 生命周期。

实现方案：

- 工厂函数保存所有 `eventBus.on()` 返回的取消订阅函数
- `destroy()` 方法统一调用所有取消订阅函数
- 或在 `disconnectedCallback` 中自动清理（推荐，避免内存泄漏）

**`disconnectedCallback` 与 `destroy()` 的分工**：

| 清理项 | `disconnectedCallback` | `destroy()` |
| --- | --- | --- |
| 移除 DOM 事件监听 | 是 | 是（通过移除元素触发） |
| 清除 ReactiveController 状态 | 是 | 是 |
| 清除 UIUpdateBus 订阅 | 是 | 是 |
| 清除连接状态回调（`_unsubConnection`） | 是 | 是 |
| 失效进行中的连接尝试（`_connectGeneration++`） | 是 | 是 |
| 清除自动保存定时器（`_autoSaveTimers`） | 是 | 是 |
| 清除 Token 引用 | 否（保留以备重连） | 是 |
| 取消 EventBus 订阅 | 是（新增） | 是 |
| 清除 localStorage Token | 否 | 可选 |
| 派发 `rtc-before-destroy` 事件 | 是（最开始） | 是（调用 destroy 时） |

### 7.6 并发与竞态条件

**属性设置与 `connectedCallback` 竞态**：

`createRtcAgent()` 在创建元素后立即设置所有属性。此时元素尚未挂载到 DOM，`connectedCallback` 未执行。
以下竞态需要注意：

1. **`scenariosURL` setter**：如果 persistence 未连接，scenarios 加载被延迟到 `connectedCallback`。
   这是安全的，因为 setter 内部已有 `if (this._persistence.isConnected)` 守卫。

2. **`databaseName` setter**：修改 `persistence.databaseName` 后立即生效。
   如果 `connectedCallback` 之后才设置 `databaseName`，数据库可能已经以默认名称打开。
   **工厂函数应在元素挂载前设置 `databaseName`**，文档需强调此约束。

3. **`agentConfig` setter**：内部调用 `_buildRegistryFromConfig()` 构建 `FunctionRegistry`。
   `connectedCallback` 中的 `connectWithRetry` 可能在 registry 设置后才完成连接。
   这是安全的，因为 `_regenerateDocsAfterRegistrySet()` 专门处理此竞态。

**Token 刷新竞态**：

现有 `_refreshing` Promise 锁已经解决了并发刷新问题（参见 `handleTokenExpired()` 实现）。
外部 Token 模式（模式 2/3）需复用此机制：

- `getToken()` 可能被多个请求同时调用（WebSocket 连接 + API 请求）
- 应缓存 `getToken()` 的 Promise，避免重复获取
- `refreshToken()` 回调需要与 `_refreshing` 锁协调

### 7.7 Shared Worker 集成指南

RTC Agent 使用 SharedWorker 托管持久化层（IndexedDB + WebSocket），实现跨 Tab 数据共享和连接复用。
这是组件的核心架构决策，宿主应用在集成时需要了解以下约束和配置要求。

#### 7.7.1 架构概述

```text
┌─────────────────────┐     ┌─────────────────────┐
│   Tab 1 (主线程)     │     │   Tab 2 (主线程)     │
│  <rtc-agent>        │     │  <rtc-agent>        │
│  WorkerBridge       │     │  WorkerBridge       │
│  (Comlink proxy)    │     │  (Comlink proxy)    │
└─────────┬───────────┘     └─────────┬───────────┘
          │ MessagePort               │ MessagePort
          ▼                           ▼
┌──────────────────────────────────────────────────────┐
│              SharedWorker (浏览器级共享)               │
│                                                      │
│  WorkerCore                                          │
│  ├── PersistenceLayer (IndexedDB + WebSocket)        │
│  ├── UIUpdateBus (广播变更到所有 Tab)                  │
│  ├── VirtualFS (虚拟文件系统)                         │
│  └── Centrifuge Client (实时消息)                     │
└──────────────────────────────────────────────────────┘
```

**关键特性**：

- **跨 Tab 共享**：同一域名下所有 Tab 共享同一个 SharedWorker 实例，避免重复的 WebSocket 连接和 IndexedDB 操作
- **Master Tab 选举**：通过 Web Locks API（`MasterLock`）选举 Master Tab，只有 Master Tab 执行 RTC 工具调用（避免重复执行）
- **事件广播**：Worker 内部的数据变更通过 `UIUpdateBus` 广播到所有连接的 Tab
- **自动降级**：如果 Web Locks API 不可用（如隐私模式），所有 Tab 均视为 Master

#### 7.7.2 CSP（Content Security Policy）要求

宿主应用如果启用了 CSP，**必须**在策略中允许以下内容：

```text
Content-Security-Policy:
  worker-src blob:;
  script-src 'self' blob: https://cdn.example.com;
  media-src 'self' https://cdn.example.com;
  connect-src 'self' wss://api.example.com https://api.example.com;
```

| 指令 | 要求 | 原因 |
| --- | --- | --- |
| `worker-src blob:` | 必须 | 跨域部署时，组件通过 fetch+Blob+createObjectURL 创建同源 blob: URL 来加载 Worker 脚本 |
| `script-src 'self' blob:` | 推荐 | blob: URL 的 Worker 脚本需要 script-src 允许 blob: |
| `media-src` | 按需 | 音效文件（MP3）加载来源，如果使用 CDN 部署需包含 CDN 域名 |
| `connect-src` | 必须 | WebSocket 连接（Centrifuge）、API 请求，以及场景文档（`scenariosUrl`）的 fetch 请求 |

**CSP 违规的症状**：

```text
// 浏览器控制台可能出现的错误：
Refused to create a worker from 'blob:...' because it violates the following Content Security Policy directive: "worker-src 'self'"
```

**解决方案**：

1. 在宿主应用的 CSP 响应头或 `<meta>` 标签中添加 `worker-src blob:`
2. 如果宿主应用不允许 `blob:`，可以通过 `worker.scriptURL` 配置项提供同源 Worker 脚本路径

#### 7.7.2a CDN 跨域资源完整清单

CDN 部署时，组件会加载多种资源。每种资源的加载方式和跨域要求不同，以下是完整清单：

| 资源类型 | 加载方式 | CORS 头要求 | CSP 指令 | 说明 |
| --- | --- | --- | --- | --- |
| 组件主脚本 (JS) | `<script type="module">` / ESM import | **需要** | `script-src` | CDN 需返回 `Access-Control-Allow-Origin`；module script 强制 CORS 检查 |
| Shared Worker 脚本 | `fetch()` + blob: URL | **需要** | `worker-src blob:` + `script-src blob:` | 跨域时通过 fetch 获取脚本内容，转为同源 blob: URL 后构造 SharedWorker |
| 音效文件 (MP3) | `new Audio()` (HTMLAudioElement) | **不需要** | `media-src` | `<audio>` 是媒体元素，可跨域加载无需 CORS；但 CSP `media-src` 必须包含 CDN 域名 |
| 场景文档 (manifest.json + .md) | `fetch()` | **需要**（跨域时） | `connect-src` | 仅在配置了 `scenariosUrl` 且 URL 跨域时需要 CORS 头 |
| WebSocket 连接 | `new WebSocket()` | 不适用 | `connect-src` | WebSocket 不受 CORS 限制，但受 CSP `connect-src` 约束（需包含 `wss://`） |
| API 请求 | `fetch()` | **需要**（跨域时） | `connect-src` | 后端 API 需返回 CORS 头 |

##### 关键区分：CORS vs CSP

- **CORS**（`Access-Control-Allow-Origin`）是**服务器响应头**，控制浏览器是否允许跨域读取响应内容。只有通过 `fetch()`/`XMLHttpRequest` 加载的资源才需要 CORS；`<audio>`/`<img>`/`<script type="module">` 有各自独立的跨域规则。
- **CSP**（`Content-Security-Policy`）是**客户端安全策略**，控制浏览器允许加载哪些来源的资源。所有资源加载都受 CSP 约束，与 CORS 无关。

##### 常见误解

- "MP3 文件也需要 CORS 头" -- **错误**。`new Audio()` 是媒体元素，跨域加载 MP3 不需要 CORS 头。但如果宿主应用的 CSP 包含 `media-src` 指令，该指令必须包含 CDN 域名。
- "Worker 脚本通过 blob: URL 加载，不需要 CORS" -- **错误**。虽然最终的 SharedWorker 使用 blob: URL（同源），但获取 Worker 脚本内容的 `fetch()` 调用本身需要 CORS 头。
- "场景文档是 Markdown 文件，不需要 CORS" -- **错误**。场景文档通过 `fetch()` 加载（`scenario-loader.ts`），跨域时必须返回 CORS 头。

#### 7.7.3 多实例隔离

默认情况下，同一域名下所有 `<rtc-agent>` 组件共享同一个 SharedWorker。
如果宿主应用需要多个独立的 RTC Agent 实例（如不同用户、不同环境），需要通过配置隔离：

```typescript
// 实例 1：用户 A 的客服助手
const agent1 = createRtcAgent({
  worker: { name: 'rtc-agent-user-a' },
  databaseName: 'agent-user-a',
  auth: { userId: 'user-a', /* ... */ }
});

// 实例 2：用户 B 的客服助手
const agent2 = createRtcAgent({
  worker: { name: 'rtc-agent-user-b' },
  databaseName: 'agent-user-b',
  auth: { userId: 'user-b', /* ... */ }
});
```

**隔离维度**：

| 维度 | 隔离方式 | 说明 |
| --- | --- | --- |
| SharedWorker 实例 | `worker.name` | 不同 name 的 SharedWorker 在浏览器中是独立实例 |
| IndexedDB 数据库 | `databaseName` | 数据库名自动拼接 userId（`${databaseName}-${userId}`） |
| 认证状态 | `auth.userId` | 每个实例使用不同的 userId |

**警告**：如果不设置不同的 `worker.name` 和 `databaseName`，多个实例会共享同一个 Worker 和数据库，导致数据混乱。

#### 7.7.4 Worker 脚本加载策略

组件内部实现了智能的 Worker 脚本加载策略，自动处理同源和跨域场景：

```text
同源部署（本地开发/同域名）:
  Vite ?sharedworker 导入 -> 直接创建 SharedWorker -> 正常加载

跨域部署（CDN）:
  Vite ?sharedworker 导入 -> 提取 Worker 脚本相对路径
  -> fetch(CDN_URL/worker.js)  // CDN 需返回 CORS 头
  -> Blob -> URL.createObjectURL()  // 创建同源 blob: URL
  -> new SharedWorker(blobUrl)  // 同源加载
  -> URL.revokeObjectURL()  // 立即释放 blob URL
```

**宿主应用需要关注**：

- CDN 部署时，Worker 脚本的 fetch 请求需要 CDN 返回 `Access-Control-Allow-Origin` 头
- Worker 脚本路径由 Vite 构建自动确定，通常无需手动配置
- 如果宿主应用的 CDN 不支持 CORS，可以通过 `worker.scriptURL` 配置同源路径
- Worker 脚本的 fetch 使用 `cache: 'no-store'` 选项，每次加载都获取最新脚本，避免使用过期的缓存版本

**Worker 脚本子资源限制**：

当 Worker 脚本通过 fetch → blob: URL 方式加载时，脚本内部的 `import.meta.url` 会解析为 `blob:...` 协议。这意味着：

- 如果 Worker 脚本包含**动态 import()** 相对路径（如 `import('./sub-module.js')`），浏览器会尝试从 `blob:` 基础解析该路径，导致加载失败
- Vite 构建的 Worker 通常是**单文件自包含**的（所有依赖打包在一个 chunk 中），因此实际中不受此限制影响
- 如果宿主应用自定义 Worker 脚本（`worker.scriptURL`），应确保脚本是单文件打包的，不包含相对路径的动态 import

#### 7.7.5 Worker 错误处理和降级

组件内部实现了多层错误处理：

1. **初始化重试**：Worker 初始化（`WorkerBridge.initWorker()`）失败自动重试 3 次（线性退避：1s, 2s, 3s），共 4 次尝试（`worker-bridge.ts:101-102`，`MAX_INIT_RETRIES = 3`，`INIT_RETRY_DELAY_MS = 1000`）
2. **连接重试**：WebSocket 连接（`PersistenceController._connectWorker()`）失败自动重试 2 次（线性退避：2s, 4s），共 3 次尝试（`persistence.controller.ts:251-252`，`MAX_CONNECT_RETRIES = 2`，`CONNECT_RETRY_DELAY_MS = 2000`）
3. **存活验证**：Worker 初始化后通过 `ping()` 验证是否成功启动（5 秒超时，`VERIFICATION_TIMEOUT_MS = 5000`）
4. **UI 错误提示**：连接完全失败后，`connectWithRetry()` 返回 `{connectionFailed: true, connectionError}`，组件通过 Toast 弹窗通知用户（`connection-setup.ts:158`）

> **重要：Worker 错误不会触发 `on.error` 回调**
>
> Worker 初始化、连接、验证等阶段的错误仅通过 `createLogger('WorkerBridge')` 和 `createLogger('PersistenceController')` 输出到 console。
> `AgentConfig.onError`（以及工厂函数 `on.error` 回调）**仅在函数执行失败时被 `FunctionRegistry` 调用**（`function-registry.ts:258,388`），
> 不覆盖 Worker 层面的错误。宿主应用如果需要监控 Worker 错误，应：
>
> 1. 监听 `connectionStateChange` 回调（连接断开/重连时触发）
> 2. 启用 debug 日志（`setGlobalLogLevel('debug')`）捕获 Worker 详细错误
> 3. 关注 UI 层面的 Toast 错误提示（连接失败时自动弹出）

```typescript
// 正确：通过连接状态变化间接感知 Worker 问题
const agent = createRtcAgent({
  on: {
    connectionStateChange: (state) => {
      if (state === 'disconnected') {
        // 可能是 Worker 异常、WebSocket 断开、网络故障等
        // 建议：显示提示，引导用户刷新页面
      }
    },
    error: (error, context) => {
      // 注意：context 仅在函数执行层面有效（如函数 handler 抛出异常）
      // Worker 相关错误不会走到这里
      sentry.captureException(error, { extra: { context } });
    }
  }
});
```

**降级限制**：如果 SharedWorker 完全不可用（如浏览器不支持或 CSP 阻止），组件无法正常工作。
IndexedDB 和 WebSocket 都运行在 Worker 内部，主线程无法直接替代。
连接完全失败后，用户可通过标题栏的重试按钮（派发 `rtc-connection-retry` 事件）手动重试。

#### 7.7.6 SharedWorker 生命周期管理

SharedWorker 的生命周期与普通 Web API 不同，宿主应用需要了解以下行为：

**浏览器级生命周期**：

- SharedWorker 在浏览器进程级别管理，不绑定于单个页面或 Tab
- 当所有连接的 MessagePort 关闭后，SharedWorker 自动终止（无 `onclose` 回调）
- 浏览器可能在内存压力下强制终止 SharedWorker（尤其是移动端）
- 用户关闭所有关联 Tab 后，SharedWorker 立即终止（无延迟）

**对宿主应用的影响**：

| 场景 | 行为 | 应对 |
| --- | --- | --- |
| 单 Tab 关闭 | SharedWorker 终止（仅剩一个 port） | 无需处理，下次打开页面时自动重建 |
| 多 Tab 共享 | 一个 Tab 关闭不影响其他 Tab | 无需处理，其他 Tab 继续正常工作 |
| 页面刷新 | 旧 port 关闭，新 port 连接 | 无需处理，SharedWorker 重新初始化 |
| SPA 路由切换 | 组件 unmount 但页面未关闭 | 需调用 `destroy()` 释放 port，否则 Worker 不会被终止 |
| 浏览器内存压力 | SharedWorker 可能被强制终止 | Comlink 后续调用抛出异常；用户需刷新页面重建 Worker（无自动恢复机制） |
| 宿主应用 `beforeunload` | 所有 port 关闭，Worker 终止 | 无需处理 |

**SPA 场景的特殊注意事项**：

在单页应用（SPA）中，路由切换不会关闭页面，但会触发 Web Component 的 `disconnectedCallback`。
如果 `disconnectedCallback` 没有正确关闭 MessagePort，SharedWorker 会继续存在，
导致以下问题：

1. **内存泄漏**：Worker 持续占用内存（IndexedDB 连接、WebSocket 连接）
2. **幽灵回调**：Worker 广播的 UIUpdateEvent 没有接收方，可能被丢弃
3. **资源浪费**：WebSocket 保持连接，消耗服务端资源

**解决方案**：

```typescript
// 工厂函数返回的 RtcAgentWithLifecycle 提供 destroy() 方法
const agent = createRtcAgent({ ... });
document.body.appendChild(agent);

// SPA 路由切换时调用
function onRouteChange() {
  agent.destroy();  // 内部会调用 WorkerBridge.destroy() → port.close()
}
```

**SharedWorker 终止检测**：

当前代码没有提供 SharedWorker 终止的检测机制。如果 Worker 被浏览器强制终止，
后续的 Comlink 调用会抛出异常（`port is closed` 或 `Worker is terminated`）。

**建议的改进**（Phase 3+）：

```typescript
// 可以监听 Worker 的 onerror 事件检测异常终止
worker.onerror = (event) => {
  if (event.message?.includes('terminated')) {
    // Worker 被终止，需要重新初始化
    log.error('SharedWorker terminated, reinitializing...');
    await workerBridge.initWorker();
  }
};
```

#### 7.7.7 SharedWorker `type: 'module'` 要求

RTC Agent 的 SharedWorker 使用 ES Module 语法（`import`/`export`），
构造时必须指定 `type: 'module'`：

```typescript
// worker-bridge.ts:261-264
this._worker = new SharedWorker(blobUrl, {
  name: 'rtc-agent-worker',
  type: 'module',  // 必须指定，否则 Worker 内部 import 语句会失败
});
```

**浏览器兼容性**：

| 浏览器 | `SharedWorker` 支持 | `type: 'module'` 支持 |
| --- | --- | --- |
| Chrome | 4+ | 80+ |
| Firefox | 29+ | 114+ |
| Safari | 16+ | 16.4+ |
| Edge | 79+ | 80+ |

**对宿主应用的影响**：

- 如果宿主应用需要支持 Safari < 16.4 或 Firefox < 114，SharedWorker 会加载失败
- 组件当前没有降级到经典 Worker 的机制（经典 Worker 不支持 ES Module）
- 宿主应用应检测浏览器版本，在不支持的浏览器中显示提示信息

**检测代码**：

```typescript
// 检测 SharedWorker + module 支持
function isSharedWorkerModuleSupported(): boolean {
  if (typeof SharedWorker === 'undefined') return false;
  
  // 尝试构造一个 module SharedWorker 检测支持
  // 注意：这会创建一个立即终止的 Worker，有轻微性能开销
  try {
    const blob = new Blob(['import.meta.url'], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new SharedWorker(url, { type: 'module' });
    worker.port.close();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
```

### 7.8 音频集成指南

RTC Agent 内置了通知音效系统，使用三个 MP3 文件提供声音反馈：

| 音效文件 | 触发时机 | 加载策略 |
| --- | --- | --- |
| `message.mp3` | 收到新消息（非当前查看的 Session） | 立即加载（关键音效） |
| `complete.mp3` | 任务完成 | 延迟加载（非关键） |
| `error.mp3` | 操作失败 | 延迟加载（非关键） |

#### 7.8.1 自动播放策略处理

现代浏览器（Chrome、Safari、Firefox）实施了严格的自动播放策略：

- **规则**：音频播放需要用户先与页面进行交互（点击、键盘输入等）
- **影响**：页面加载后首次收到消息时，声音提示可能被浏览器阻止
- **组件处理**：组件内部已捕获 `NotAllowedError`，自动降级为无声通知，不会抛出未处理异常

```typescript
// 组件内部处理（notification.controller.ts）：
sound.play().catch((error) => {
  if (error.name === 'NotAllowedError') {
    // 浏览器自动播放策略限制，降级为无声通知
    log.warn('音频播放被浏览器阻止，需要用户交互');
  } else {
    log.warn('播放失败:', error);
  }
});
```

**宿主应用可以做的**：

1. **无需额外处理**：组件已自动降级，不影响功能
2. **提示用户交互**：在页面上显示提示，引导用户点击页面以启用音频
3. **提供开关**：允许用户在设置中手动启用/禁用声音提示（通过 `notification.soundEnabled` 配置）

#### 7.8.2 音频资源加载

音效文件通过 Vite 的 `?url` 后缀导入，构建时自动处理：

- **开发模式**：Vite dev server 提供音效文件访问
- **生产模式**：音效文件复制到 `dist/` 目录，使用 hash 命名
- **CDN 部署**：音效文件随组件一起部署到 CDN，URL 自动解析

**宿主应用无需关心音效文件路径**，组件内部通过 `import messageSoundUrl from '../assets/sounds/message.mp3?url'` 自动解析为可访问的 URL。

**CDN 部署时的跨域处理**：

音效文件通过 `new Audio()` 构造的 HTMLAudioElement 加载（`notification.controller.ts:174-195`）。`<audio>` 元素是浏览器的**媒体元素**，跨域加载资源时**不需要** CORS 头（`Access-Control-Allow-Origin`），与 `<img>` 的行为类似。

但是，如果宿主应用启用了 CSP（Content Security Policy），**必须**确保 `media-src` 指令包含音效文件的来源：

```text
Content-Security-Policy:
  media-src 'self' https://cdn.example.com;  // 必须包含音效文件所在的 CDN 域名
```

如果 `media-src` 不包含 CDN 域名，浏览器控制台会出现以下错误：

```text
Refused to load media from 'https://cdn.example.com/assets/message-abc123.mp3' because it violates the following Content Security Policy directive: "media-src 'self'"
```

音效文件不会触发 CORS 预检请求（OPTIONS），因此 CDN 配置比 Worker 脚本更简单：只需确保 `media-src` CSP 正确即可，无需额外配置 CORS 响应头。

**性能优化**：

- `message.mp3`（关键音效）在组件挂载时（`hostConnected()`）立即加载
- `complete.mp3` 和 `error.mp3`（非关键音效）延迟加载，策略如下（`notification.controller.ts:159-171`）：
  - 优先使用 `requestIdleCallback`（浏览器空闲时加载，零性能影响）
  - 即使 `requestIdleCallback` 可用，如果 2000ms 内未触发（`IDLE_FALLBACK_DELAY_MS`），降级为立即加载
  - 如果 `requestIdleCallback` 不可用（如 Safari），降级为 `setTimeout`（500ms 延迟，`DEFERRED_SOUND_DELAY_MS`）
- 延迟加载确保音效文件不阻塞首屏渲染
- 组件断开时（`hostDisconnected()`）自动清理所有定时器（`_deferredSoundTimer`）和 idle 回调（`_idleCallbackId`），防止内存泄漏

#### 7.8.3 音频配置和禁用

```typescript
// 禁用所有声音提示
const agent = createRtcAgent({
  notification: {
    soundEnabled: false
  }
});

// 调整音量
const agent = createRtcAgent({
  notification: {
    volume: 0.5  // 50% 音量
  }
});
```

**注意**：`notification.soundEnabled` 映射到组件内部的 `SettingsController.notifications.soundEnabled`。
用户也可以在组件的设置面板中手动切换声音开关，设置会持久化到 `localStorage`。

#### 7.8.4 音频降级方案

如果音频完全不可用（文件加载失败、浏览器不支持、CSP 阻止），组件自动降级：

| 场景 | 降级行为 |
| --- | --- |
| MP3 文件加载失败 | `audio.addEventListener('error')` 捕获，从音效缓存中移除，不影响其他功能 |
| 浏览器不支持 Audio API | `new Audio()` 返回空对象，播放时静默失败 |
| CSP `media-src` 阻止 | 浏览器阻止加载，`audio.addEventListener('error')` 捕获，同加载失败处理。需检查 CSP 配置是否包含 CDN 域名 |
| 自动播放被阻止 | `NotAllowedError` 捕获，降级为无声通知 |

**Toast 和动画不受影响**：即使音频完全不可用，Toast 弹窗通知和最小化图标动画仍然正常工作。

### 7.9 常见问题排查

#### 问题 1：SharedWorker 初始化失败

**症状**：

```
[WorkerBridge] Failed to initialize SharedWorker after 4 attempts
```

**排查步骤**：

1. **检查 CSP**：确认 `worker-src blob:` 在 CSP 策略中
2. **检查 CORS**：如果使用 CDN，确认 Worker 脚本的 fetch 请求返回 CORS 头
3. **检查浏览器控制台**：查看 `SharedWorker error` 或 `worker init` 日志
4. **验证 Worker 脚本是否可访问**：在浏览器中直接访问 Worker 脚本 URL

```typescript
// 调试：启用详细日志
import { setGlobalLogLevel } from '@rtc-agent/client';
setGlobalLogLevel('debug');

const agent = createRtcAgent({
  on: {
    error: (err, ctx) => console.error(`[${ctx}]`, err)
  }
});
```

#### 问题 2：音效不播放

**症状**：收到新消息时没有声音提示

**排查步骤**：

1. **检查设置**：确认 `notification.soundEnabled` 为 `true`
2. **检查用户交互**：确认用户已与页面交互（点击/键盘）
3. **检查浏览器控制台**：查看 `NotAllowedError` 或 `音频加载失败` 日志
4. **检查音效文件**：在浏览器 Network 面板确认 MP3 文件加载成功（状态 200）

```typescript
// 调试：手动测试音效播放
const audio = new Audio('/path/to/message.mp3');
audio.play().then(() => console.log('OK')).catch(err => console.error('FAIL:', err));
```

#### 问题 3：多 Tab 数据不同步

**症状**：Tab A 发送消息后，Tab B 没有立即显示

**排查步骤**：

1. **检查 SharedWorker**：确认两个 Tab 共享同一个 SharedWorker（DevTools → Application → Shared Workers）
2. **检查 UIUpdateBus**：确认 Worker 内部的广播是否正常（Debug 日志中应有 `UIUpdateEvent`）
3. **检查连接状态**：确认 WebSocket 连接正常（`connectionState` 应为 `connected`）

**常见原因**：

- 两个 Tab 使用了不同的 `worker.name`，导致 SharedWorker 实例不同
- 两个 Tab 使用了不同的 `databaseName`，导致 IndexedDB 数据库不同

#### 问题 4：SharedWorker 在浏览器更新后不工作

**症状**：浏览器自动更新后，SharedWorker 停止响应或报错

**排查步骤**：

1. **检查 Worker 状态**：DevTools → Application → Shared Workers，查看 Worker 是否标记为 "terminated"
2. **刷新页面**：SharedWorker 在浏览器更新后可能需要完全重新加载
3. **清除缓存**：如果问题持续，清除浏览器缓存并硬刷新（Ctrl+Shift+R）

**根本原因**：

浏览器更新可能导致 SharedWorker 的内部状态不一致（IndexedDB schema 变化、
WebSocket 协议版本变化等）。RTC Agent 的 Worker 没有版本迁移机制，
但 IndexedDB 的 `onupgradeneeded` 事件会处理 schema 升级。

#### 问题 5：SPA 路由切换后 Worker 资源泄漏

**症状**：SPA 应用频繁路由切换后，浏览器内存持续增长，DevTools 显示多个 SharedWorker

**排查步骤**：

1. **检查 Worker 数量**：DevTools → Application → Shared Workers，应只有一个活跃的 Worker
2. **检查 Port 状态**：如果 Worker 显示多个 connected ports，说明旧组件未正确释放
3. **确认 destroy() 调用**：确保路由切换时调用了 `agent.destroy()`

```typescript
// 正确：路由切换时销毁
router.onNavigate(() => {
  agent?.destroy();
  agent = null;
});

// 错误：路由切换时只移除 DOM，不销毁
router.onNavigate(() => {
  agent?.remove();  // disconnectedCallback 会触发，但 EventBus 订阅可能未清理
});
```

#### 问题 6：SharedWorker `type: 'module'` 不支持

**症状**：

```
Failed to load module script: Expected a JavaScript module script but the MIME type is not valid
```

**排查步骤**：

1. **检查浏览器版本**：SharedWorker `type: 'module'` 需要 Chrome 80+、Firefox 114+、Safari 16.4+
2. **检查 CSP**：`script-src` 需要允许 `blob:` 和 `module` 类型
3. **降级方案**：当前不支持降级到经典 Worker（经典 Worker 不支持 ES Module）

**临时解决方案**：

如果宿主应用需要支持旧版浏览器，可以在组件挂载前检测浏览器能力：

```typescript
function checkSharedWorkerSupport(): boolean {
  try {
    if (typeof SharedWorker === 'undefined') return false;
    const blob = new Blob([''], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new SharedWorker(url, { type: 'module' });
    w.port.close();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

if (!checkSharedWorkerSupport()) {
  showError('您的浏览器版本不支持 RTC Agent，请升级到最新版本');
} else {
  const agent = createRtcAgent({ ... });
  document.body.appendChild(agent);
}
```

#### 问题 7：音效在 iOS Safari 中完全不播放

**症状**：iOS Safari 中音效完全不播放，即使已经与页面交互

**排查步骤**：

1. **检查静音开关**：iOS 设备的物理静音开关会阻止音频播放
2. **检查音量**：确认设备音量不为零
3. **检查 `audio.play()` 返回值**：iOS Safari 对 `play()` 有额外限制

**iOS Safari 特殊行为**：

iOS Safari 的自动播放策略比桌面浏览器更严格：

- 即使有用户交互，如果 Audio 实例不是在用户手势事件处理器中创建的，
  `play()` 仍然可能被阻止
- RTC Agent 的音效在组件挂载时预加载（`_preloadSounds()`），
  不是在用户交互时创建的，这可能触发 iOS 限制

**组件内部处理**：

`notification.controller.ts` 的 `_playSound()` 方法在用户交互后调用 `play()`，
但 Audio 实例是在 `hostConnected()` 时预创建的。这在 iOS Safari 中可能导致
`NotAllowedError`，已被 `.catch()` 捕获并降级为无声通知。

**宿主应用解决方案**：

如果需要强制启用 iOS 音频，可以在用户首次交互时预热 AudioContext：

```typescript
document.addEventListener('click', function warmUp() {
  // 创建并播放一个静音音频，解锁 iOS AudioContext
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  
  // 移除此监听器（只需一次）
  document.removeEventListener('click', warmUp);
}, { once: true });
```

#### 问题 8：需要调试 SharedWorker 内部状态

**症状**：需要查看 Worker 内部的 IndexedDB 数据、WebSocket 消息、或 broadcast 事件

**调试方法**：

1. **DevTools → Application → Shared Workers**：查看所有活跃的 SharedWorker
2. **点击 "Inspect"**：打开 Worker 专属的 DevTools 窗口（独立于主页面 DevTools）
3. **Worker DevTools 功能**：
   - **Console**：查看 Worker 内部的 `console.log/warn/error` 输出（包括 `createLogger('WorkerCore')` 的日志）
   - **Sources**：设置断点调试 Worker 代码（支持 Source Map）
   - **Network**：查看 WebSocket 连接和 Centrifuge 消息流
   - **Application → IndexedDB**：直接查看 Worker 管理的数据库内容

**启用 Worker 详细日志**：

```typescript
import { setGlobalLogLevel } from '@rtc-agent/client';

// 设置后，Worker 内部的 WorkerCore、PersistenceLayer 等都会输出 debug 日志
setGlobalLogLevel('debug');
```

**注意事项**：

- Worker DevTools 窗口独立于主页面，需要单独打开
- 如果 Worker 已终止（所有 port 关闭），Inspect 链接会消失
- `createLogger` 的日志前缀（如 `[WorkerCore]`、`[WorkerBridge]`）可在 Worker/主页面 DevTools 中分别搜索

#### 问题 9：CDN 部署时 Worker 脚本 CORS 错误

**症状**：

```text
[WorkerBridge] failed to fetch worker script from https://cdn.example.com/assets/shared-worker-abc123.js: Failed to fetch
```

或者浏览器控制台：

```text
Access to fetch at 'https://cdn.example.com/assets/shared-worker-abc123.js' from origin 'https://myapp.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**根本原因**：

RTC Agent 在跨域部署时（`worker-bridge.ts:239-255`）通过 `fetch()` 获取 Worker 脚本内容，然后转为 blob: URL 构造 SharedWorker。`fetch()` 受浏览器同源策略限制，CDN 必须返回 CORS 响应头。

**排查步骤**：

1. **确认 CDN 配置**：检查 CDN 是否为 JS 文件返回以下响应头：`Access-Control-Allow-Origin: *` 或 `Access-Control-Allow-Origin: https://myapp.com`
2. **手动验证**：使用 curl 检查响应头：`curl -I https://cdn.example.com/assets/shared-worker-abc123.js`，应看到 `Access-Control-Allow-Origin` 头
3. **检查浏览器 Network 面板**：找到失败的 fetch 请求，查看 Response Headers 是否包含 CORS 头
4. **检查 CDN 缓存**：如果 CDN 之前没有配置 CORS，旧的响应可能已被缓存。需要在 CDN 控制台刷新缓存（purge），或在浏览器中使用硬刷新（Ctrl+Shift+R）

验证命令：

```bash
curl -I https://cdn.example.com/assets/shared-worker-abc123.js
# 应看到 Access-Control-Allow-Origin 头
```

**CDN 配置示例**（常见 CDN 服务）：

| CDN 服务 | 配置方式 |
| --- | --- |
| Cloudflare | 默认对所有请求返回 CORS 头，无需额外配置 |
| AWS CloudFront | 在 Behavior 中设置 "Response headers policy" → "CORS-with-preflight" |
| jsDelivr | 默认返回 CORS 头，无需额外配置 |
| 阿里云 CDN | 在"HTTP 头管理"中添加自定义响应头 `Access-Control-Allow-Origin: *` |
| 腾讯云 CDN | 在"HTTP 头配置"中添加自定义响应头 |

**临时解决方案**：

如果 CDN 无法配置 CORS，可以通过 `worker.scriptURL` 配置同源路径（`[需要新增]`，当前代码不支持），或将 Worker 脚本复制到宿主应用同域：

```typescript
const agent = createRtcAgent({
  worker: {
    scriptURL: '/local-path/shared-worker.js'  // 同源路径，无需 CORS
  }
});
```

#### 问题 10：场景文档跨域加载失败

**症状**：

```text
[ScenarioLoader] manifest.json fetch timeout
```

或浏览器控制台：

```text
Access to fetch at 'https://cdn.example.com/scenarios/manifest.json' from origin 'https://myapp.com' has been blocked by CORS policy
```

**根本原因**：

场景文档通过 `fetch()` 加载（`scenario-loader.ts:113-123`），跨域时受 CORS 策略限制。与 Worker 脚本类似，CDN 必须返回 CORS 头。

**排查步骤**：

1. **确认 `scenariosUrl` 配置**：检查传入的 URL 是否跨域。如果是同域路径，不会触发 CORS 问题
2. **确认 CDN CORS 配置**：场景文档所在的 CDN 必须返回 `Access-Control-Allow-Origin` 头
3. **确认 CSP `connect-src`**：宿主应用的 CSP 必须包含场景文档的来源（`connect-src 'self' https://cdn.example.com;`）
4. **验证 manifest.json 可访问**：在浏览器中直接访问 `scenariosUrl + 'manifest.json'`，确认返回 JSON 内容

**场景文档 CORS 要求**：

| 文件类型 | 需要 CORS | CSP 指令 |
| --- | --- | --- |
| `manifest.json` | 需要（跨域时） | `connect-src` |
| `.md` 文件 | 需要（跨域时） | `connect-src` |

#### 问题 11：CDN 部署时音效不播放（CSP 阻止）

**症状**：

```text
Refused to load media from 'https://cdn.example.com/assets/message-abc123.mp3' because it violates the following Content Security Policy directive: "media-src 'self'"
```

**根本原因**：

音效文件通过 `new Audio()` 加载，虽然不需要 CORS 头，但受 CSP `media-src` 指令约束。如果宿主应用的 CSP 包含 `media-src` 指令但未包含 CDN 域名，浏览器会阻止加载。

**排查步骤**：

1. **检查 CSP 配置**：确认 `media-src` 包含音效文件所在的 CDN 域名
2. **检查 Network 面板**：查看 MP3 文件的加载状态，如果是 `(blocked)` 则表示被 CSP 阻止
3. **注意**：`new Audio()` 不需要 CORS 头，只需 CSP `media-src` 正确即可

**解决方案**：

在宿主应用的 CSP 中添加或扩展 `media-src` 指令：

```text
Content-Security-Policy:
  media-src 'self' https://cdn.example.com;  // 添加组件部署的 CDN 域名
```

如果没有使用 CDN（音效文件与页面同域），则不需要额外的 `media-src` 配置。

### 7.10 CDN 部署跨域检查清单

以下检查清单帮助宿主应用在 CDN 部署前确认所有跨域配置正确：

**CORS 头配置**（服务器/CDN 端）：

| 资源 | 需要 CORS | 必需响应头 |
| --- | --- | --- |
| 组件 JS (ESM/UMD) | 是 | `Access-Control-Allow-Origin: *` 或指定域名 |
| Shared Worker JS | 是 | `Access-Control-Allow-Origin: *` 或指定域名 |
| 音效文件 (MP3) | **否** | 无需 CORS 头 |
| 场景文档 (manifest.json + .md) | 是（跨域时） | `Access-Control-Allow-Origin: *` 或指定域名 |

**CSP 配置**（宿主应用端）：

```text
Content-Security-Policy:
  worker-src blob:;                                            // 必须：Worker 通过 blob: URL 加载
  script-src 'self' blob: https://cdn.example.com;             // 必须：组件主脚本 + blob: Worker
  media-src 'self' https://cdn.example.com;                    // 必须（CDN 部署时）：音效文件
  connect-src 'self' wss://api.example.com https://api.example.com https://cdn.example.com;  // 必须：WebSocket + API + 场景文档
```

**验证步骤**：

1. 使用 curl 验证 Worker 脚本的 CORS 头：`curl -I https://cdn.example.com/assets/shared-worker-*.js`，确认包含 `Access-Control-Allow-Origin` 头
2. 在浏览器 Network 面板验证所有资源加载成功（状态 200）
3. 检查浏览器控制台无 CSP 违规错误
4. 如果配置了 `scenariosUrl`，在浏览器中直接访问 `scenariosUrl + 'manifest.json'` 验证可访问
5. 检查 SharedWorker 是否正常启动：DevTools → Application → Shared Workers

**常见 CDN 服务默认 CORS 行为**：

| CDN 服务 | 默认 CORS | 备注 |
| --- | --- | --- |
| jsDelivr | 支持 | 默认返回 `Access-Control-Allow-Origin: *` |
| unpkg | 支持 | 默认返回 CORS 头 |
| Cloudflare | 支持 | 默认配置即可 |
| AWS CloudFront | 需配置 | 需要在 Behavior 中启用 CORS |
| 阿里云 CDN | 需配置 | 在 HTTP 头管理中手动添加 |
| 腾讯云 CDN | 需配置 | 在 HTTP 头配置中手动添加 |
| GitHub Pages | 支持 | 默认返回 CORS 头 |

---

## 8. 开发者体验优化

### 8.1 常见错误与防护

#### 错误 1：在元素挂载后设置 `databaseName`

**问题**：

```typescript
const agent = createRtcAgent({ appLabel: 'My App' });
document.body.appendChild(agent);
// ❌ 错误：此时数据库可能已以默认名称打开
agent.databaseName = 'custom-db';
```

**防护**：工厂函数在 `appendChild` 前设置所有属性。文档需强调：

- `databaseName` 必须在元素挂载前设置
- 工厂函数自动处理此顺序
- 手动设置时需遵循此约束

#### 错误 2：混用 HTML 属性和 `createRtcAgent()`

**问题**：

```html
<rtc-agent id="agent" theme="dark" app-label="Old Label"></rtc-agent>
<script>
const agent = createRtcAgent({ theme: 'light', appLabel: 'New Label' });
// ❌ 混淆：HTML 属性优先级更高，导致 theme='dark', appLabel='Old Label'
document.body.appendChild(agent);
</script>
```

**防护**：

- 文档明确说明：推荐二选一，不要混用
- 工厂函数创建的是新元素，不会继承现有 HTML 属性
- 提供迁移指南（5.1-5.6 节）

#### 错误 3：忘记处理 `beforeMessageSend` 的异步返回值

**问题**：

```typescript
const agent = createRtcAgent({
  on: {
    beforeMessageSend: async (content) => {
      const valid = await validateContent(content);
      return valid;  // ⚠️ 异步返回 true/false 是合法的（返回类型包含 Promise）
      // 但注意：返回 true 与返回 void/undefined 语义不同
      // true = 显式放行，void/undefined = 也放行，false = 阻止
    }
  }
});
```

**防护**：

- 类型定义明确标注返回值类型（包含 `Promise<boolean | void | ContentData>`）
- 工厂函数内部自动 await Promise 返回值
- 推荐 async 函数使用 `return false` 阻止、`return` 放行的模式，避免混淆

**正确用法**：

```typescript
const agent = createRtcAgent({
  on: {
    beforeMessageSend: async (content) => {
      const valid = await validateContent(content);
      if (!valid) return false;  // 阻止发送
      return;  // 放行
    }
  }
});
```

#### 错误 4：EventBus 事件与 DOM 事件混淆

**问题**：

```typescript
const agent = createRtcAgent({
  on: {
    // ❌ 错误：toolCallStart 来自 EventBus，不能用 addEventListener
    toolCallStart: (event) => console.log(event.path)
  }
});

// ❌ 错误：尝试用 DOM 方式监听 EventBus 事件
agent.addEventListener('function:start', (e) => { ... });
```

**防护**：

- 回调接口注释明确标注事件来源（已在第 2 轮修复）
- 工厂函数内部自动选择正确的注册方式
- 文档 3.4 节详细说明两类事件的区别

#### 错误 5：未清理 EventBus 订阅导致内存泄漏

**问题**：

```typescript
const agent = createRtcAgent({
  on: {
    toolCallStart: (event) => console.log(event.path)
  }
});
document.body.appendChild(agent);

// 后续移除元素
document.body.removeChild(agent);
// ❌ 错误：EventBus 订阅仍然存在，回调继续执行
```

**防护**：

- 工厂函数返回的 `RtcAgentWithLifecycle` 提供 `destroy()` 方法
- `disconnectedCallback` 自动清理 EventBus 订阅（Phase 3 实现）
- 文档 7.5 节详细说明生命周期管理

**正确用法**：

```typescript
const agent = createRtcAgent({ ... });
document.body.appendChild(agent);

// 永久销毁时调用
agent.destroy();  // 清理 DOM、Token、EventBus 订阅
```

### 8.2 调试指南

#### 启用调试日志

```typescript
import { createLogger, setGlobalLogLevel } from '@rtc-agent/client';

// 设置全局日志级别（影响所有 logger 实例）
setGlobalLogLevel('debug');  // 'debug' | 'info' | 'warn' | 'error'

const log = createLogger('RtcAgent');

const agent = createRtcAgent({
  appLabel: 'Debug App',
  on: {
    ready: () => log.info('Agent ready'),
    connectionStateChange: (state) => log.debug('Connection:', state),
    error: (err, ctx) => log.error(`Error in ${ctx}:`, err)
  }
});
```

#### 使用 Debug API（开发/测试环境）

```typescript
// installDebugAPI() 在组件 connectedCallback 中自动调用（仅开发/测试构建），
// 无需手动导入。组件挂载后即可在浏览器控制台访问 window.rtcAgentDebug。

// 浏览器控制台：
// window.rtcAgentDebug.sessions.list()
// window.rtcAgentDebug.auth.state
// window.rtcAgentDebug.messages.current
// window.rtcAgentDebug.tools.list()
// window.rtcAgentDebug.network.state

// 注意：installDebugAPI() 未从主入口导出，属于内部 API。
// 如需在生产构建中启用，需通过组件源码直接导入（不推荐）。
```

#### 常见问题排查

##### 问题 1：组件不显示

```typescript
// 检查 1：是否调用了 appendChild
const agent = createRtcAgent({ ... });
// ❌ 忘记 document.body.appendChild(agent);

// 检查 2：server.url 是否正确配置
// 打开浏览器控制台查看网络请求
```

##### 问题 2：认证失败

```typescript
// 检查 1：Token 是否有效
const agent = createRtcAgent({
  auth: {
    getToken: () => {
      const token = authService.getToken();
      console.log('Token:', token);  // 调试输出
      return token;
    }
  },
  on: {
    authError: () => console.error('Auth failed'),
    authLogin: (user) => console.log('Login success:', user)
  }
});

// 检查 2：Token 刷新是否工作
// 打开浏览器控制台查看 rtc-auth-refresh-failed 事件
```

##### 问题 3：工具调用不触发

```typescript
// 检查 1：函数是否正确注册
const agent = createRtcAgent({
  functions: [{
    name: 'test',
    handler: () => {
      console.log('Handler called!');  // 调试输出
      return 'ok';
    }
  }],
  on: {
    toolCallStart: (event) => console.log('Tool start:', event.path),
    toolCallSuccess: (event) => console.log('Tool success:', event.result),
    toolCallError: (event) => console.error('Tool error:', event.error)
  }
});

// 检查 2：EventBus 事件是否派发
import { eventBus } from '@rtc-agent/component';
eventBus.on('function:start', (e) => console.log('EventBus:', e));
```

### 8.3 TypeScript 类型安全

#### 完整类型导出

工厂函数的新增类型应全部从 `@rtc-agent/component` 导出，确保 IDE 智能提示：

```typescript
// 从 @rtc-agent/component 导入（新增类型，待实施）
import type {
  RtcAgentConfig,
  AuthConfig,
  StaticTokenAuth,
  DynamicTokenAuth,
  AuthProvider,
  RtcAgentCallbacks,
  RtcAgentWithLifecycle,
  // 现有已导出类型
  AgentConfig,
  AgentFunctionGroup,
  FunctionStartEvent,    // EventBus 事件类型
  FunctionSuccessEvent,
  FunctionErrorEvent,
  FunctionProgressEvent,
} from '@rtc-agent/component';

// 从 @rtc-agent/client 导入
import type { ConnectionState } from '@rtc-agent/client';

// 组件 UI 层类型（事件 detail 中使用的是这些类型）
// 注意：Session 和 Message 是组件 types/index.ts 定义的 UI 层类型，
// 与 @rtc-agent/protocol 的同名服务端模型字段名不同：
//   - 组件 Session：clientId, title, createdAt, updatedAt（camelCase）
//   - 协议 Session：id, client_id, created_at, updated_at（snake_case）
//   - 组件 Message：clientId, content: ContentData, streaming（boolean）
//   - 协议 Message：id, session_id, content: string, streaming_status（enum）
// ContentData 由组件 types/index.ts 从 @rtc-agent/protocol re-export，两者相同
// 以下类型当前未从 component 主入口导出，Phase 1 需补充
import type {
  Session,
  Message,
  ContentData,
} from '@rtc-agent/component';  // 待 Phase 1 补充导出；当前需从子路径导入

// 注意：FunctionDef 和 ParameterDef 已从主入口导出（通过 skill types），
// 可直接从 '@rtc-agent/component' 导入，无需等待 Phase 1

// 以下类型定义在 component 包内，但未从主入口导出（内部类型）
// 如需使用，应从组件子路径导入或在实施时添加到主入口导出列表：
// - WindowConfig, BubblePosition  → packages/component/src/types/window-config.ts
// - ActivityBarConfig            → packages/component/src/types/activity-bar-config.ts
```

> **重要：类型来源区分**：
>
> | 类型 | 定义位置 | 事件 detail 使用 | 说明 |
> | --- | --- | --- | --- |
> | `Session` | `component/types/index.ts`（UI 层） | 是 | 字段名 camelCase（`clientId`、`createdAt`） |
> | `Message` | `component/types/index.ts`（UI 层） | 是 | `content: ContentData`，`streaming?: boolean` |
> | `ContentData` | `@rtc-agent/protocol`（由组件 re-export） | 是 | `{ type: ContentType; data: unknown }` |
> | `Session`（协议） | `@rtc-agent/protocol`（服务端模型） | **否** | 字段名 snake_case（`id`、`client_id`、`created_at`） |
> | `Message`（协议） | `@rtc-agent/protocol`（服务端模型） | **否** | `content: string`，`streaming_status: enum` |
>
> 宿主应用监听事件时，应使用组件的 UI 层类型（camelCase 版本），不要误用协议层类型。
>
> **实施注意**：Phase 1 应同时更新 `src/index.ts`，将 `WindowConfig`、`ActivityBarConfig`、`ContentData`、`Session`、`Message` 等宿主应用常用类型加入主入口导出，以确保 TypeScript 用户的导入体验。

#### 类型收窄示例

```typescript
import type { AuthConfig, StaticTokenAuth, DynamicTokenAuth } from '@rtc-agent/component';

function configureAuth(auth: AuthConfig) {
  if ('accessToken' in auth) {
    // TypeScript 自动收窄为 StaticTokenAuth
    console.log('Static token:', auth.accessToken);
  } else if ('getToken' in auth && !('isLoggedIn' in auth)) {
    // TypeScript 自动收窄为 DynamicTokenAuth
    const token = auth.getToken();
  } else {
    // TypeScript 自动收窄为 AuthProvider
    const loggedIn = auth.isLoggedIn();
  }
}
```

#### 事件类型安全

```typescript
const agent = createRtcAgent({
  on: {
    // ✅ TypeScript 自动推导参数类型
    sessionCreated: (detail) => {
      // detail 类型为 { session: Session }
      console.log(detail.session.clientId);  // ✅ 类型安全（注意：Session 使用 clientId，不是 id）
      console.log(detail.session.typo);  // ❌ TypeScript 报错
    },
    toolCallStart: (event) => {
      // event 类型为 { path: string; params: Record<string, unknown> }
      console.log(event.path);  // ✅ 类型安全
      console.log(event.name);  // ❌ TypeScript 报错（没有 name 字段）
    }
  }
});
```

### 8.4 完整示例：生产环境集成

```typescript
import { createRtcAgent } from '@rtc-agent/component';
import type { RtcAgentWithLifecycle } from '@rtc-agent/component';
import * as Sentry from '@sentry/browser';
import analytics from './analytics';

// 创建 Agent 实例
const agent: RtcAgentWithLifecycle = createRtcAgent({
  // 基础配置
  appLabel: '生产环境助手',
  theme: 'system',
  lang: 'zh-CN',
  
  // 服务端配置
  server: {
    url: import.meta.env.VITE_API_URL || 'https://api.example.com',
    redirectUri: `${window.location.origin}/auth/callback`
  },
  
  // 数据库配置（自定义前缀，避免冲突）
  databaseName: 'myapp-prod',
  
  // 场景文档（从 CDN 加载）
  scenariosUrl: 'https://cdn.example.com/scenarios/',
  
  // 认证配置（模式 2：动态 Token）
  auth: {
    getToken: () => authService.getLatestToken(),
    refreshToken: async () => {
      try {
        const result = await authService.refresh();
        return {
          accessToken: result.access,
          refreshToken: result.refresh,
          expiresIn: result.expiresIn
        };
      } catch (error) {
        Sentry.captureException(error, { tags: { component: 'auth-refresh' } });
        throw error;
      }
    },
    userId: authService.getUserId()
  },
  
  // 窗口配置
  window: {
    defaultMode: 'normal',
    initialPosition: { x: -20, y: 20 },
    initialSize: { width: 420, height: 640 },
    draggable: true,
    resizable: true,
    showMinimize: true,
    showMaximize: true,
    bubblePosition: {
      corner: 'bottom-right',
      offset: { x: -20, y: 20 }
    }
  },
  
  // Activity Bar 配置
  activityBar: {
    disabledActivities: ['files'],
    defaultActivity: 'chat'
  },
  
  // Agent 配置
  agentName: 'ProductionAssistant',
  agentDescription: '生产环境智能助手',
  persona: '你是一个专业的生产环境助手，负责帮助用户解决问题。',
  
  // 函数注册
  functions: [
    {
      name: 'getUserInfo',
      description: '获取当前用户信息',
      parameters: [
        {
          name: 'userId',
          schema: { type: 'string', description: '用户 ID' },
          required: true
        }
      ],
      handler: async ({ userId }) => {
        try {
          const response = await fetch(`/api/users/${userId}`, {
            headers: { Authorization: `Bearer ${authService.getToken()}` }
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        } catch (error) {
          Sentry.captureException(error, { tags: { function: 'getUserInfo' } });
          throw error;
        }
      }
    }
  ],
  
  // 事件回调
  on: {
    ready: () => {
      analytics.track('agent_ready');
      console.log('[RTC Agent] Ready');
    },
    
    connectionStateChange: (state) => {
      analytics.track('connection_state', { state });
      if (state === 'disconnected') {
        Sentry.addBreadcrumb({
          category: 'connection',
          message: 'Connection lost',
          level: 'warning'
        });
      }
    },
    
    authLogin: (user) => {
      analytics.track('user_login', { userId: user.userId });
      Sentry.setUser({ id: user.userId });
    },
    
    authLogout: () => {
      analytics.track('user_logout');
      Sentry.setUser(null);
    },
    
    authError: () => {
      Sentry.captureMessage('Authentication failed', 'error');
    },
    
    sessionCreated: (detail) => {
      analytics.track('session_created', { sessionId: detail.session.clientId });
    },
    
    messageSent: (detail) => {
      analytics.track('message_sent', {
        messageClientId: detail.message.clientId,
        contentType: detail.message.content.type
      });
    },
    
    messageReceived: (detail) => {
      analytics.track('message_received', {
        messageClientId: detail.message.clientId,
        contentType: detail.message.content.type
      });
    },
    
    toolCallStart: (event) => {
      analytics.track('tool_call_start', { path: event.path });
      Sentry.addBreadcrumb({
        category: 'tool-call',
        message: `Tool call: ${event.path}`,
        data: event.params,
        level: 'info'
      });
    },
    
    toolCallSuccess: (event) => {
      analytics.track('tool_call_success', { path: event.path });
    },
    
    toolCallError: (event) => {
      analytics.track('tool_call_error', { path: event.path });
      Sentry.captureException(event.error, {
        tags: { tool: event.path },
        extra: { errorMessage: event.error.message }
      });
    },
    
    beforeMessageSend: async (content) => {
      // 内容过滤示例
      if (content.data && typeof content.data === 'string') {
        const blocked = ['forbidden-word'];
        for (const word of blocked) {
          if (content.data.includes(word)) {
            console.warn('[RTC Agent] Message blocked:', word);
            return false;  // 阻止发送
          }
        }
      }
      return;  // 放行
    },
    
    error: (error, context) => {
      Sentry.captureException(error, {
        tags: { component: 'rtc-agent', context },
        level: 'error'
      });
    }
  }
});

// 挂载到 DOM
document.body.appendChild(agent);

// 应用卸载时清理
window.addEventListener('beforeunload', () => {
  agent.destroy();
});

export default agent;
```

### 8.5 性能最佳实践

#### 回调函数保持轻量

```typescript
// ❌ 避免：在回调中执行耗时操作
const agent = createRtcAgent({
  on: {
    messageReceived: async (detail) => {
      // 错误：阻塞主线程
      const analysis = await expensiveAnalysis(detail.message.content);
      updateUI(analysis);
    }
  }
});

// ✅ 推荐：异步操作使用 requestIdleCallback 或 setTimeout
const agent = createRtcAgent({
  on: {
    messageReceived: (detail) => {
      // 正确：延迟执行耗时操作
      requestIdleCallback(() => {
        expensiveAnalysis(detail.message.content)
          .then(updateUI)
          .catch(console.error);
      });
    }
  }
});
```

#### 避免频繁创建 Agent 实例

```typescript
import { useRef, useEffect } from 'react';
import { createRtcAgent } from '@rtc-agent/component';
import type { RtcAgentWithLifecycle } from '@rtc-agent/component';

// ❌ 避免：在 React/Vue 组件中每次渲染都创建
function MyComponent() {
  const agent = createRtcAgent({ ... });  // 每次渲染都创建新实例
  useEffect(() => {
    document.body.appendChild(agent);
    return () => agent.destroy();
  }, []);
}

// ✅ 推荐：使用 useRef 或模块级变量
const agentRef = useRef<RtcAgentWithLifecycle | null>(null);

function MyComponent() {
  useEffect(() => {
    if (!agentRef.current) {
      agentRef.current = createRtcAgent({ ... });
      document.body.appendChild(agentRef.current);
    }
    return () => {
      agentRef.current?.destroy();
      agentRef.current = null;
    };
  }, []);
}
```

#### EventBus 订阅清理

```typescript
// ✅ 工厂函数自动处理清理
const agent = createRtcAgent({
  on: {
    toolCallStart: (event) => console.log(event.path)
  }
});

// disconnectedCallback 或 destroy() 会自动清理 EventBus 订阅
```

### 8.6 测试策略与验证方法

新增 API 需要完整的测试覆盖。以下是建议的测试策略，与现有测试基础设施（vitest + Playwright）对齐。

#### 单元测试（vitest）

**工厂函数测试**（`src/factory.test.ts`）：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createRtcAgent } from './factory.js';

describe('createRtcAgent', () => {
  it('should create <rtc-agent> element', () => {
    const agent = createRtcAgent({ appLabel: 'Test' });
    expect(agent.tagName.toLowerCase()).toBe('rtc-agent');
    expect(agent.appLabel).toBe('Test');
  });

  it('should map server config to properties', () => {
    const agent = createRtcAgent({
      server: { url: 'https://api.example.com', redirectUri: 'https://app.com/cb' }
    });
    expect(agent.serverURL).toBe('https://api.example.com');
    expect(agent.redirectURI).toBe('https://app.com/cb');
  });

  it('should build AgentConfig from functions/groups/persona', () => {
    const agent = createRtcAgent({
      persona: 'You are helpful',
      functions: [{ name: 'test', handler: () => 'ok' }]
    });
    expect(agent.agentConfig?.persona).toBe('You are helpful');
    expect(agent.agentConfig?.functions).toHaveLength(1);
  });

  it('should register callbacks via addEventListener', () => {
    const ready = vi.fn();
    const agent = createRtcAgent({ on: { ready } });
    agent.dispatchEvent(new CustomEvent('rtc-agent-ready'));
    expect(ready).toHaveBeenCalled();
  });

  it('should register EventBus callbacks via eventBus.on()', () => {
    const toolCallStart = vi.fn();
    const agent = createRtcAgent({
      on: { toolCallStart }
    });
    // EventBus events are dispatched separately
    eventBus.emit('function:start', { path: 'test.fn', params: {} });
    expect(toolCallStart).toHaveBeenCalledWith({ path: 'test.fn', params: {} });
  });

  it('should return RtcAgent type with destroy method', () => {
    const agent = createRtcAgent({});
    expect(typeof agent.destroy).toBe('function');
  });
});
```

**认证集成测试**（`controllers/auth.controller.test.ts` 扩展）：

```typescript
describe('AuthController external token modes', () => {
  it('mode 1: StaticTokenAuth should set tokens without localStorage', () => {
    // 验证外部 Token 不写入 localStorage
  });

  it('mode 2: DynamicTokenAuth should call getToken() on getAccessToken()', () => {
    // 验证 getToken 作为 accessToken 来源
  });

  it('mode 2: concurrent refresh should not race', () => {
    // 验证 _refreshing Promise 锁在外部模式下仍然有效
  });

  it('mode 3: AuthProvider should delegate all auth operations', () => {
    // 验证完全委托模式
  });
});
```

**事件测试**（`components/rtc-agent/rtc-agent.test.ts` 扩展）：

```typescript
describe('New event dispatches', () => {
  it('should dispatch rtc-connection-state-change on state transition', async () => {
    // 验证连接状态变化事件
  });

  it('should dispatch rtc-auth-login on successful token load', async () => {
    // 验证登录成功事件
  });

  it('should dispatch rtc-message-received only when streaming ends', async () => {
    // 验证消息接收事件仅在 streaming 结束时触发（非每次 chunk）
  });

  it('should dispatch rtc-theme-change on theme property update', async () => {
    // 验证主题变化事件
  });

  it('should dispatch rtc-before-destroy before cleanup in disconnectedCallback', async () => {
    // 验证销毁前事件在清理操作之前触发
  });

  it('should cleanup EventBus subscriptions in disconnectedCallback', () => {
    // 验证 EventBus 订阅清理，无内存泄漏
  });
});
```

#### 集成测试（Playwright E2E）

```typescript
// tests/factory-function.spec.ts
import { test, expect } from '@playwright/test';

test.describe('createRtcAgent factory', () => {
  test('CDN ESM import should work', async ({ page }) => {
    await page.goto('/test-factory-esm.html');
    await expect(page.locator('rtc-agent')).toBeVisible();
  });

  test('CDN UMD import should work', async ({ page }) => {
    await page.goto('/test-factory-umd.html');
    await expect(page.locator('rtc-agent')).toBeVisible();
  });

  test('external token auth should skip OAuth flow', async ({ page }) => {
    await page.goto('/test-external-auth.html');
    // 验证不显示登录页面，直接进入已登录状态
    await expect(page.locator('rtc-login-page')).not.toBeVisible();
  });

  test('destroy() should cleanup completely', async ({ page }) => {
    await page.goto('/test-destroy.html');
    // 验证 destroy() 后无残留事件监听和 EventBus 订阅
  });
});
```

#### 测试页面

为手动验证和 E2E 测试提供独立的测试页面：

- `test-pages/factory-esm.html` — ESM 方式加载 `createRtcAgent`
- `test-pages/factory-umd.html` — UMD 方式加载 `createRtcAgent`
- `test-pages/external-auth.html` — 外部 Token 认证测试
- `test-pages/event-callbacks.html` — 所有回调事件验证
- `test-pages/destroy-lifecycle.html` — 生命周期和销毁测试

---

## 9. 附录：现有 API 参考

为方便迁移和实施，以下列出当前 `<rtc-agent>` 组件的完整公开 API：

### HTML 属性

| 属性 | 类型 | 缺省值 | 说明 |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 主题 |
| `app-label` | `string` | `'RTC Agent'` | 应用名称（标题栏 + bubble tooltip） |
| `bubble-icon` | `string` | `''` | 最小化 bubble 内的 SVG/HTML 图标 |
| `lang` | `string` | 浏览器语言 | UI 语言（支持 zh-CN、en-US 等） |
| `server-url` | `string` | `VITE_SERVER_URL` 或 `http://localhost:28080` | 后端服务 URL |
| `redirect-uri` | `string` | `${origin}/auth/callback.html` | OAuth 回调 URL |
| `scenarios-url` | `string` | `''` | 场景文档目录 URL |
| `database-name` | `string` | `''` | 自定义数据库名称前缀 |

### JS 属性（需通过 JS 设置）

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `agentConfig` | `AgentConfig` | 声明式配置（persona、functions、groups） |
| `windowConfig` | `WindowConfig` | 窗口配置（模式、尺寸、位置、交互控制） |
| `activityBarConfig` | `ActivityBarConfig` | Activity Bar 配置（活动按钮显隐） |
| `registry` | `FunctionRegistry` | 高级用法：直接注入 FunctionRegistry 实例 |
| `serverURL` | `string` | 同 `server-url` HTML 属性 |
| `redirectURI` | `string` | 同 `redirect-uri` HTML 属性 |
| `scenariosURL` | `string` | 同 `scenarios-url` HTML 属性 |
| `databaseName` | `string` | 同 `database-name` HTML 属性 |

### 公开事件

| 事件 | detail | 说明 |
| --- | --- | --- |
| `rtc-agent-ready` | `void` | 组件首次渲染完成 |
| `rtc-auth-login-requested` | `void` | 用户请求登录 |
| `rtc-auth-logout` | `void` | 用户退出登录 |
| `rtc-auth-refresh-failed` | `void` | Token 刷新失败 |
| `rtc-connection-retry` | `void` | 用户点击重试按钮（连接失败时） |
| `rtc-session-created` | `{ session: Session }` | Session 创建 |
| `rtc-session-switched` | `{ id: string }` | Session 切换 |
| `rtc-session-renamed` | `{ id: string; title: string }` | Session 重命名 |
| `rtc-session-deleted` | `{ id: string }` | Session 删除 |
| `rtc-message-sent` | `{ message: Message }` | 消息发送成功 |
| `rtc-tool-call-approved` | `{ id, toolName? }` | Tool Call 被批准（`toolName` 来自 `find()` 查找，可能为 `undefined`） |
| `rtc-tool-call-approve-all` | `{ toolName }` | 某类 Tool Call 全部批准 |
| `rtc-tool-call-denied` | `{ id }` | Tool Call 被拒绝 |
| `rtc-window-minimize` | `void` | 窗口最小化 |
| `rtc-window-maximize` | `void` | 窗口最大化 |
| `rtc-window-restore` | `void` | 窗口恢复 |
| `rtc-stop-requested` | `{ sessionClientId: string }` | 用户请求停止生成（点击停止按钮） |

> **内部事件（不推荐外部监听）**：`rtc-clear-active-input`（Escape 键取消 fork 时清空输入框）
> 属于组件内部协调事件，可能在未通知的情况下变更，不建议宿主应用依赖。
>
> **TypeScript 类型覆盖注意**：当前 `RtcAgentEventDetailMap`（`src/types/events.ts`）仅包含 `rtc-agent-ready` 一个事件的类型定义。
> 其他公开事件（`rtc-session-*`、`rtc-auth-*`、`rtc-window-*` 等）虽然在代码中真实存在并正确派发，但尚未加入类型映射。
> **建议**：Phase 3 实施回调事件时，同步将上述所有公开事件补全到 `RtcAgentEventDetailMap`，以获得完整的 TypeScript 类型安全。

### 导出的模块

| 导出 | 说明 |
| --- | --- |
| `RtcAgent` | 组件类 |
| `whenReady` | 就绪信号 Promise |
| `AgentConfig`, `AgentFunctionGroup` | 声明式配置类型 |
| `defineRegistry`, `FunctionRegistry`, `FunctionGroup` | 函数注册系统 |
| `EventBus`, `eventBus` | 事件总线 |
| `FunctionStartEvent` 等 | EventBus 事件类型 |
| `FunctionDef`, `ParameterDef`, `FunctionGroupDef` | Skill 函数/参数/分组定义类型 |
| `OpenAPISchema`, `ReturnDef`, `VisualHooks` | Skill Schema 和钩子类型 |
| `RegistryConfig`, `ScenarioDef`, `ScenarioManifest` | 注册表和场景定义类型 |
| `SkillController`, `SkillActions`, `SkillControllerConfig` | 技能控制器和配置 |
| `SkillContext`, `SkillContextValue`, `DEFAULT_SKILL_STATE` | 技能上下文 |
| `z`, `validateParams`, `buildValidator` 等 | Zod 验证工具 |
| `ValidationError`, `ValidationResult` | 验证结果类型 |
| `loadScenariosFromURL`, `parseFrontmatter` | 场景加载工具 |
| `generateFunctionMd`, `generateFunctionsIndex`, `generateAgentMd` | 文档生成工具 |
| `CancelledError` | 取消错误类型 |

> **未从主入口导出的类型**（宿主应用常用但当前未导出，建议 Phase 1 补充）：
>
> | 类型 | 定义位置 | 说明 |
> | --- | --- | --- |
> | `WindowConfig`, `BubblePosition` | `src/types/window-config.ts` | 窗口配置 |
> | `ActivityBarConfig` | `src/types/activity-bar-config.ts` | Activity Bar 配置 |
> | `Session` | `src/types/index.ts`（组件 UI 层） | 会话类型（camelCase 字段：`clientId`、`createdAt`） |
> | `Message` | `src/types/index.ts`（组件 UI 层） | 消息类型（`content: ContentData`、`streaming?: boolean`） |
> | `ContentData` | `@rtc-agent/protocol`（由 `src/types/index.ts` re-export） | 消息内容数据 |
>
> **注意**：`Session` 和 `Message` 是组件内部的 UI 层类型（定义在 `src/types/index.ts`），
> 与 `@rtc-agent/protocol` 的同名服务端模型字段名不同（见 8.3 节详细对比表）。
> 事件 detail 使用的是组件 UI 层类型。
>
> **已澄清**：`FunctionDef` 和 `ParameterDef` 实际已从主入口导出（`src/index.ts` 通过 `types/skill.js` 导出），
> 无需等待 Phase 1。宿主应用可直接 `import type { FunctionDef, ParameterDef } from '@rtc-agent/component'`。

---

## 改进记录 - 第 1 轮

**审查时间**: 2026-09-26
**审查范围**: 全文档 + web-components 代码库对照

### 发现的问题和修复

1. **[严重] 配置对象字段名与实际代码不一致**
   - `window.position` → 应为 `window.initialPosition`（与现有 `WindowConfig` 接口一致）
   - `window.size` → 应为 `window.initialSize`
   - `window.position` 类型错误：实际不是字符串枚举 `'bottom-right'` 等，而是 `{ x: number; y: number }` 偏移量
   - `ui` 分组不存在：`bubbleIcon` 应放在顶层，`disabledActivities` / `defaultActivity` 应属于独立的 `activityBar` 配置对象
   - 缺失字段：`embedded`、`showClose`、`bubblePosition`（`WindowConfig`）、`databaseName`、`scenariosUrl`
   - **修复**: 重写 RtcAgentConfig 接口，添加映射表，对齐所有字段名

2. **[严重] 回调事件缺少与现有事件系统的映射**
   - 文档中列出的回调名称没有说明与实际 `rtc-*` 事件的对应关系
   - 缺少 `authLoginRequested`（映射 `rtc-auth-login-requested`）、`toolCallApproved` / `toolCallDenied` 等实际存在的事件
   - 缺少 `connectionStateChange` 的实现说明（当前 `_connectionState` 是 `@state`，不派发事件）
   - **修复**: 为每个回调添加映射说明，补充缺失的回调

3. **[严重] 认证配置缺少实现细节**
   - 三种模式没有说明如何与现有 `AuthController` 集成
   - 缺少配置识别规则（如何区分三种模式）
   - 缺少对 `AuthState` 实际字段的引用
   - **修复**: 添加集成说明和配置识别规则

4. **[警告] UMD 全局变量名错误**
   - 文档使用 `window.RtcAgent`，实际 vite.config.ts 中为 `name: 'RtcAgentModule'`
   - **修复**: 更正为 `window.RtcAgentModule`

5. **[警告] 完整配置示例使用错误的参数格式**
   - 示例使用 `import { z }` 和 `z.object()` 定义参数，实际 `FunctionDef` 使用 OpenAPI 格式 `parameters: [{ name, schema, required }]`
   - 示例中 `import { z } from '@rtc-agent/component'` 虽然可用，但不应在基本示例中引入不必要的依赖
   - **修复**: 改用 OpenAPI 格式参数定义

6. **[警告] 迁移指南不完整**
   - 缺少 `windowConfig`、`activityBarConfig`、`databaseName`、`scenariosUrl` 的迁移路径
   - 缺少事件监听的迁移指南（从 `addEventListener` 到 `on` 回调）
   - 缺少 `whenReady()` 当前推荐用法的说明
   - **修复**: 新增 5.4-5.6 节，补充完整迁移路径

7. **[建议] 缺少当前推荐用法示例**
   - 文档只展示了 `createRtcAgent()` 新 API，未展示当前实际可用的集成方式
   - **修复**: 新增 4.5 节，展示 `whenReady()` + 属性赋值的当前推荐用法

8. **[建议] 缺少现有 API 参考**
   - 实施者和审查者需要一个完整的现有 API 列表来理解映射关系
   - **修复**: 新增第 9 节附录，列出所有 HTML 属性、JS 属性、公开事件、导出模块

9. **[建议] 实施计划不够具体**
   - Phase 1 没有说明工厂函数的实现策略（创建元素 → 解析配置 → 映射属性）
   - Phase 3 没有列出需要补充的事件派发点
   - **修复**: 细化各 Phase 的具体任务

10. **[建议] 风险部分缺少配置冲突和性能细节**
    - 未提及 `createRtcAgent()` 与 HTML 属性混用的优先级问题
    - 未提及 `beforeMessageSend` 异步拦截的处理
    - 未提及并发刷新竞态（现有 `_refreshing` 锁可复用）
    - **修复**: 新增 7.4 节，补充配置冲突和性能细节

---

## 改进记录 - 第 2 轮

**审查时间**: 2026-09-26
**审查范围**: 全文档 + web-components 代码库深度对照（controllers、types、events、event-bus）
**审查方法**: 逐行对照源码验证所有类型定义、事件 detail、回调签名、事件存在性

### 第 2 轮发现的问题和修复

1. **[严重] 回调事件 detail 类型与实际事件完全不匹配**
   - `sessionCreated` 使用 `{ sessionId: string; title: string }` 但实际 `rtc-session-created` 事件 detail 为 `{ session: Session }`（完整 Session 对象）
   - `sessionSwitched` 使用 `{ sessionId: string; title: string }` 但实际 detail 为 `{ id: string }`（不含 title）
   - `sessionDeleted` 使用 `{ sessionId: string }` 但实际 detail 为 `{ id: string }`
   - `messageSent` 使用 `{ messageId: string; content: string }` 但实际 `rtc-message-sent` 事件 detail 为 `{ message: Message }`（完整 Message 对象）
   - **修复**: 修正所有回调签名为实际事件 detail 类型，引用 `Session` 和 `Message` 类型

2. **[严重] 工具调用回调参数类型与 EventBus 事件不匹配**
   - 文档使用 `{ id: string; name: string; params: any }` 等签名
   - 实际 EventBus 事件（`function:start` 等）使用 `{ path: string; params: Record<string, unknown> }`
   - `path` 是完全限定名（如 `user.getInfo`），不是 `name`
   - EventBus 事件没有 `id` 字段
   - **修复**: 修正参数类型为 `{ path; params }` / `{ path; result }` / `{ path; error }` / `{ path; progress }`，添加注释说明 EventBus 与 DOM 事件的区别

3. **[严重] 已有事件被误标为"需要新增"**
   - Session 事件（`rtc-session-created`/`switched`/`deleted`）实际已存在于 SessionController 中
   - `rtc-session-renamed` 事件已存在但文档完全遗漏
   - `rtc-message-sent` 事件已存在于 MessageController 中
   - `rtc-connection-retry` 事件已存在但文档遗漏
   - Phase 3 计划中 "sessionCreated / sessionSwitched / sessionDeleted / messageSent：在对应操作后派发" 是冗余的
   - **修复**: 标注每个回调对应的事件是否已存在，Phase 3 计划拆分为"已有事件桥接"和"需要新增的事件"

4. **[严重] `AuthConfig` 联合类型未定义**
   - 文档使用 `auth?: AuthConfig` 但未定义 `AuthConfig` 类型
   - **修复**: 添加 `type AuthConfig = StaticTokenAuth | DynamicTokenAuth | AuthProvider`

5. **[严重] `authLogin` 回调缺少实现说明**
   - `authLogin` 映射不到任何现有 DOM 事件（只有 `rtc-auth-login-requested` 和 `rtc-auth-logout`）
   - AuthController 有内部 `onLogin` 回调但不派发 DOM 事件
   - **修复**: 明确标注为 [需要新增]，需新增 `rtc-auth-login` 事件派发

6. **[警告] `authError` 回调签名与实际事件不匹配**
   - 文档定义 `authError?: (error: Error) => void`
   - 但 `rtc-auth-refresh-failed` 事件无 detail（void）
   - **修复**: 修正签名为 `() => void`，添加说明如需错误详情需扩展事件

7. **[警告] 缺少 `sessionRenamed` 回调**
   - `rtc-session-renamed` 事件存在（detail: `{ id, title }`），但回调列表中遗漏
   - **修复**: 添加 `sessionRenamed` 回调

8. **[警告] 缺少 `toolCallApproveAll` 回调**
   - `rtc-tool-call-approve-all` 事件存在（detail: `{ toolName }`），但回调列表中遗漏
   - **修复**: 添加 `toolCallApproveAll` 回调

9. **[警告] 缺少 `connectionRetry` 回调**
   - `rtc-connection-retry` 事件存在（从 `rtc-title-bar` 派发），但回调列表中遗漏
   - **修复**: 添加 `connectionRetry` 回调

10. **[警告] `beforeMessageSend` 参数类型与实际 API 不匹配**
    - 文档使用 `{ content: string; attachments?: any[] }`
    - 实际 `MessageActions.sendMessage()` 参数类型为 `ContentData`（`{ type: ContentType; data: unknown }`）
    - **修复**: 改用 `ContentData` 类型

11. **[警告] `RtcAgentConfig` 缺少 `agentName` 和 `agentDescription` 字段**
    - 实际 `AgentConfig` 有 `name` 和 `description` 字段
    - `name` 用于 system prompt 和多 agent 场景区分
    - **修复**: 添加 `agentName` 和 `agentDescription` 字段，更新映射表

12. **[警告] `on.error` 与 `AgentConfig.onError` 优先级未说明**
    - 两者功能重复，可能导致混淆
    - **修复**: 添加说明 `on.error` 优先

13. **[建议] 回调接口缺少 EventBus 与 DOM 事件的区分说明**
    - `toolCallStart/Success/Error/Progress` 来自 EventBus，其他回调来自 DOM 事件
    - 工厂函数注册机制完全不同（`eventBus.on()` vs `addEventListener()`）
    - **修复**: 在回调接口注释中明确标注事件来源和注册方式

14. **[建议] Phase 3 实施计划过于笼统**
    - 未区分已有事件桥接和新增事件开发
    - 未说明 EventBus 桥接的特殊处理
    - **修复**: 重写 Phase 3，按三类（已有 DOM 事件、EventBus 桥接、需新增事件）详细列出

15. **[建议] 附录公开事件列表不完整**
    - 缺少 `rtc-connection-retry`、`rtc-session-created`/`switched`/`renamed`/`deleted`、`rtc-message-sent` 等已存在的事件
    - 现有事件缺少 detail 类型详情
    - **修复**: 补全事件列表，添加 detail 类型

### 修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 6 | 6 |
| 警告 | 7 | 7 |
| 建议 | 3 | 3 |
| **总计** | **16** | **16** |

---

## 改进记录 - 第 3 轮

**审查时间**: 2026-09-26
**审查范围**: 全文档 + 深度源码对照（AuthController、MessageController、SessionController、ToolCallController、EventBus、ConnectionState、vite.config.ts、server OAuth2 handler）
**审查方法**: 逐行验证类型定义、事件触发链路、资源生命周期、安全性、并发处理

### 第 3 轮发现的问题和修复

1. **[严重] `connectionStateChange` 类型定义与实际 `ConnectionState` 不匹配**
   - 文档定义 `state: 'connecting' | 'connected' | 'disconnected' | 'error'`
   - 实际 `ConnectionState`（`@rtc-agent/client`）为 `'disconnected' | 'connecting' | 'connected' | 'reconnecting'`
   - 文档多了不存在的 `'error'`，少了实际存在的 `'reconnecting'`
   - **修复**: 改用 `ConnectionState` 类型引用，补充类型取值说明和实现路径

2. **[严重] 工厂函数返回值类型不精确**
   - 文档签名 `createRtcAgent(config): HTMLElement` 返回泛化的 `HTMLElement`
   - 应返回 `RtcAgent` 类型（组件类实例），调用者才能访问组件特有属性
   - **修复**: 改为返回 `RtcAgent`，添加类型说明

3. **[严重] 映射表暗示冗余操作**
   - 映射表写 "赋值 + 调用 `setServerUrl()`" 和 "赋值 + 调用 `setRedirectUri()`"
   - 实际 `element.serverURL` setter 内部已自动调用 `setServerUrl()`，只需赋值即可
   - 误导实施者执行冗余操作
   - **修复**: 改为 "赋值（setter 内部自动调用 `setServerUrl()`）"

4. **[警告] `messageReceived` 触发时机不明确**
   - 文档只说 "消息接收/流式完成后派发"
   - 未说明消息接收走 UIUpdateBus 路径（`updateMessageFromBus` → `_applyBusUpdate`）
   - 未说明 `updateMessageFromBus` 对同一条消息多次触发（每次 streaming chunk）
   - 必须仅在 `streaming` 从 `true` 变为 `false` 时派发
   - **修复**: 补充完整数据流路径和去重条件

5. **[警告] EventBus 订阅缺少清理方案**
   - `toolCallStart/Success/Error/Progress` 通过 `eventBus.on()` 注册到全局单例
   - `disconnectedCallback` 不感知 EventBus 订阅，元素销毁后订阅残留
   - 导致内存泄漏和幽灵回调
   - **修复**: Phase 1 新增 `destroy()` 方法，Phase 3 新增 EventBus 清理任务，7.5 节补充完整清理方案

6. **[警告] `beforeDestroy` 事件派发时机不明确**
   - 文档说在 `disconnectedCallback` 中派发，未说明在清理之前还是之后
   - 如果清理后再派发，监听器可能已无法访问完整组件状态
   - `disconnectedCallback` 不等于永久销毁
   - **修复**: 明确标注在清理操作之前派发，补充 `destroy()` 方法建议

7. **[警告] `theme` 属性变化事件实现路径未说明**
   - 当前 `theme` 是 `@property({type: String, reflect: true})` 简单属性
   - 要实现事件派发需要转为自定义 getter/setter 或在 `updated()` 中检测
   - **修复**: 补充两种实现路径供选择

8. **[警告] 安全性考虑不完整**
   - 原 7.2 节只覆盖 Token 传递和刷新
   - 缺少：外部 Token 持久化策略（不应写入 localStorage）、XSS 防护（`bubbleIcon` 渲染 HTML）、内存安全（Token 驻留）
   - **修复**: 7.2 节新增三个安全性子章节，`bubbleIcon` 字段添加 `@security` JSDoc

9. **[警告] 缺少生命周期管理章节**
   - 未提供 `destroy()` API 设计
   - 未说明 `disconnectedCallback` 与 `destroy()` 的分工
   - 未说明 EventBus 订阅、Token 引用、localStorage 的清理策略
   - **修复**: 新增 7.5 节，包含清理表格和实现方案

10. **[警告] 缺少并发/竞态条件分析**
    - `createRtcAgent()` 属性设置与 `connectedCallback` 存在多个潜在竞态点
    - `databaseName` setter 在连接后设置会导致数据库名不一致
    - Token 刷新在外部模式下需要与 `_refreshing` 锁协调
    - **修复**: 新增 7.6 节，分析三个关键竞态场景及安全性

11. **[建议] 附录公开事件列表包含内部事件**
    - `rtc-clear-active-input` 标注为 "内部事件" 但仍列在公开事件表中
    - 容易误导开发者依赖不稳定内部 API
    - **修复**: 从公开事件表移出，单独标注为内部事件

12. **[建议] Phase 1/2/3 实施计划缺少安全和测试细节**
    - Phase 1 未提及 `bubbleIcon` XSS 安全警告和 `destroy()` 方法
    - Phase 2 未提及外部 Token 不写入 localStorage 的策略
    - Phase 3 未提及 EventBus 清理和 `beforeMessageSend` 拦截点
    - **修复**: 更新三个 Phase 的 checklist

### 第 3 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 3 | 3 |
| 警告 | 6 | 6 |
| 建议 | 3 | 3 |
| **总计** | **12** | **12** |

---

## 改进记录 - 第 4 轮

**审查时间**: 2026-09-26
**审查范围**: 开发者体验深度审查（实际使用场景、错误防护、调试体验、TypeScript 类型安全、性能优化）
**审查方法**: 从开发者角度模拟完整集成流程，识别痛点和改进机会

### 第 4 轮发现的问题和修复

1. **[严重] 缺少常见错误防护指南**
   - 开发者容易犯的错误没有提前说明，导致踩坑
   - 缺少：`databaseName` 设置时机、HTML 属性混用、`beforeMessageSend` 异步处理、EventBus 与 DOM 事件混淆、EventBus 订阅清理
   - **修复**: 新增 8.1 节，列出 5 个常见错误及防护措施

2. **[严重] 缺少调试指南**
   - 开发者遇到问题时不知道如何调试
   - 缺少：日志启用方法、Debug API 使用、常见问题排查步骤
   - **修复**: 新增 8.2 节，提供完整的调试指南和 3 个常见问题排查示例

3. **[严重] TypeScript 类型安全说明不足**
   - 未说明如何导入和使用类型
   - 缺少：类型收窄示例、事件类型安全示例
   - **修复**: 新增 8.3 节，展示完整类型导入、类型收窄、事件类型安全示例

4. **[警告] 缺少生产环境完整示例**
   - 现有示例过于简单，未展示生产环境集成全貌
   - 缺少：错误监控（Sentry）、分析追踪、内容过滤、完整生命周期管理
   - **修复**: 新增 8.4 节，提供完整的生产环境集成示例（约 150 行代码）

5. **[警告] 缺少性能最佳实践**
   - 未说明回调函数的性能注意事项
   - 缺少：避免阻塞主线程、避免频繁创建实例、EventBus 订阅自动清理
   - **修复**: 新增 8.5 节，提供 3 个性能最佳实践示例

6. **[警告] `databaseName` 约束说明不够突出**
   - 仅在 7.6 节竞态分析中提及，容易被忽略
   - **修复**: 在 3.2 节 `databaseName` 字段添加 `@important` JSDoc 标注

7. **[警告] 章节编号冲突**
   - 原文有两个"第 9 节"（总结和附录）
   - **修复**: 删除总结章节，保留附录为第 9 节

8. **[建议] 缺少 Debug API 说明**
   - `installDebugAPI()` 和 `window.rtcAgentDebug` 未在文档中提及
   - **修复**: 在 8.2 节调试指南中添加 Debug API 使用说明

9. **[建议] Markdown 格式不规范**
   - 代码块和列表缺少空行
   - 使用粗体作为标题（应使用 `#####` 标题）
   - **修复**: 修复所有 MD031/MD032/MD036 lint 警告

### 第 4 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 3 | 3 |
| 警告 | 4 | 4 |
| 建议 | 2 | 2 |
| **总计** | **9** | **9** |

### 第 4 轮新增内容概览

**新增章节**:

- **8. 开发者体验优化**（约 600 行）
  - 8.1 常见错误与防护（5 个错误场景）
  - 8.2 调试指南（日志、Debug API、问题排查）
  - 8.3 TypeScript 类型安全（类型导入、收窄、事件安全）
  - 8.4 完整示例：生产环境集成（150 行代码）
  - 8.5 性能最佳实践（3 个实践场景）

**关键改进**:

1. **错误防护**：提前识别 5 个常见错误，提供明确的防护措施
2. **调试体验**：提供完整的调试工具链和问题排查指南
3. **类型安全**：展示 TypeScript 类型推导和收窄的最佳实践
4. **生产就绪**：提供包含监控、分析、安全的完整生产示例
5. **性能优化**：指导开发者避免常见性能陷阱

**累计改进**（6 轮总计）:

| 轮次 | 严重 | 警告 | 建议 | 总计 |
| --- | --- | --- | --- | --- |
| 第 1 轮 | 3 | 4 | 3 | 10 |
| 第 2 轮 | 6 | 7 | 3 | 16 |
| 第 3 轮 | 3 | 6 | 3 | 12 |
| 第 4 轮 | 3 | 4 | 2 | 9 |
| 第 5 轮 | 3 | 5 | 3 | 11 |
| 第 6 轮 | 5 | 4 | 2 | 11 |
| 第 7 轮 | 2 | 2 | 2 | 6 |
| **总计** | **25** | **32** | **18** | **75** |

---

## 改进记录 - 第 5 轮

**审查时间**: 2026-09-26
**审查范围**: 构建配置（vite.config.ts、package.json）、导出完整性、CDN 路径准确性、安全声明真实性、版本管理策略、类型导出覆盖度
**审查方法**: 对照 `packages/component/package.json`、`src/index.ts`、`src/types/events.ts`、`rtc-agent.ts` 源码逐条验证文档声明

### 第 5 轮发现的问题和修复

1. **[严重] `bubbleIcon` XSS 安全警告与代码实现完全相反**
   - 文档 3.2 节 `@security` 注释声称"此值直接渲染为 HTML，组件不做自动消毒"
   - 文档 7.2 节 XSS 防护小节声称"`createRtcAgent` 工厂函数不应自动消毒"
   - 实际代码：`rtc-agent.ts` 第 1852-1861 行 `_sanitizeBubbleIcon()` 方法使用 DOMPurify 自动消毒，仅允许白名单内的 SVG 标签和属性
   - DOMPurify 已是组件现有依赖（`rtc-message` 渲染 Markdown 时使用），无需额外引入
   - 若 DOMPurify 加载失败，fallback 为 `textContent` 纯文本渲染（完全安全）
   - **修复**: 更正 3.2 节 `@security` 注释、7.2 节 XSS 防护小节、Phase 1 实施说明，如实描述自动消毒行为，同时保留纵深防御建议

2. **[严重] TypeScript 类型导出列表存在事实错误**
   - 8.3 节列出 `AgentFunction`、`WindowConfig`、`ActivityBarConfig`、`ContentData`、`Message`、`Session` 等可从 `@rtc-agent/component` 导入
   - 实际 `src/index.ts` 未导出这些类型：`AgentFunction` 类型根本不存在（正确名称为 `FunctionDef`）；`WindowConfig`、`ActivityBarConfig`、`ContentData`、`Message`、`Session` 均定义在内部文件但未从主入口 re-export
   - 开发者按照文档导入将导致 TypeScript 编译错误
   - **修复**: 重写 8.3 节，区分已导出类型、未导出内部类型、需从 `@rtc-agent/protocol` 导入的类型；添加实施注意事项

3. **[严重] `installDebugAPI` 导入示例错误**
   - 8.2 节示例展示 `import { installDebugAPI } from '@rtc-agent/component'` 并手动调用
   - 实际 `installDebugAPI` 未从 `src/index.ts` 导出，属于内部 API
   - 组件在 `rtc-agent.ts` 第 1305 行 `connectedCallback` 中自动调用（仅开发/测试构建），无需手动导入
   - **修复**: 重写 8.2 节 Debug API 说明，说明自动安装机制，避免误导开发者

4. **[警告] 附录"导出的模块"表格存在错误条目**
   - 列出 `WindowConfig`、`BubblePosition`、`ActivityBarConfig`、`AgentFunction` 为主入口导出
   - 这些类型均未从主入口导出（`AgentFunction` 类型不存在，应为 `FunctionDef`）
   - **修复**: 更正导出列表，添加未导出类型补充说明表格，建议 Phase 1 补充导出

5. **[警告] `RtcAgentEventDetailMap` 类型覆盖严重不足**
   - `src/types/events.ts` 中 `RtcAgentEventDetailMap` 仅定义 `rtc-agent-ready` 一个事件
   - 其他 16+ 公开事件（`rtc-session-*`、`rtc-auth-*`、`rtc-window-*`、`rtc-message-*`、`rtc-tool-call-*`）均未加入类型映射
   - TypeScript 用户使用 `addEventListener` 时缺少类型提示
   - **修复**: 在附录公开事件表下方添加 TypeScript 类型覆盖注意事项，建议 Phase 3 同步补全

6. **[警告] CDN 示例使用 `@latest`，不适合生产环境**
   - 4.3/4.4 节 CDN URL 使用 `@latest`，可能引入非预期破坏性变更
   - **修复**: 改为固定版本号 `@0.1.0`，添加版本选择说明（`@^0.1.0` / `@latest` 的适用场景）

7. **[警告] `package.json` exports 字段缺少 `default` fallback**
   - 当前 `packages/component/package.json` 的 `exports` 仅有 `"import"` 条件
   - Webpack 4 等较旧构建工具可能无法解析，导致运行时错误
   - Phase 4 实施计划未涉及此问题
   - **修复**: Phase 4 新增 `exports` 字段更新任务，补充 `default` fallback

8. **[建议] Phase 4 缺少版本管理和发布策略内容**
   - 文档未说明版本策略（SemVer）、破坏性变更政策、CHANGELOG 要求
   - 根 `package.json` 的 `private: true` 与子包发布意图的关系未澄清
   - **修复**: Phase 4 扩展为"构建、分发和版本管理"，新增版本策略和发布说明任务

9. **[建议] `AgentFunction` 类型引用不一致**
   - 3.2 节 `functions` 字段类型写为 `AgentFunction[]`
   - 实际类型为 `FunctionDef[]`（来自 `src/types/skill.ts`，在 `agent-config.ts` 中引入）
   - **修复**: 更正为 `FunctionDef[]`

10. **[建议] 附录"导出的模块"表格遗漏 `generateFunctionsIndex`**
    - 实际 `src/index.ts` 导出 `generateFunctionMd`、`generateFunctionsIndex`、`generateAgentMd` 三个函数
    - 文档仅列出两个，遗漏 `generateFunctionsIndex`
    - **修复**: 补全导出列表

11. **[建议] Markdown 格式问题（MD028/MD031）**
    - 块引用内空行格式不符合 markdownlint 规范（MD028）
    - 列表内代码块未正确留白（MD031）
    - **修复**: 调整块引用和代码块周围的空行

### 第 5 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 3 | 3 |
| 警告 | 5 | 5 |
| 建议 | 3 | 3 |
| **总计** | **11** | **11** |

### 第 5 轮关键发现总结

**真实性问题（需特别关注）**：

1. **安全声明与实现矛盾**：`bubbleIcon` 相关安全警告是前 4 轮审查中"补充"的内容，但补充时未核查实际实现，导致文档声称"组件不做自动消毒"与代码事实完全相反。这是文档审查中的典型案例——在补充说明时应始终验证源码实现，而非仅基于接口注释推断。

2. **类型导出"想当然"**：8.3 节声称"完整类型导出"，但所列类型中有多个实际并未从主入口导出。`AgentFunction` 类型甚至根本不存在。这提示我们在描述"已导出"内容时，必须逐条核对 `src/index.ts` 的 `export` 语句。

3. **API 可见性假设错误**：`installDebugAPI` 在代码中存在并被使用，但未作为公共 API 导出。文档假设"存在即可导入"，忽视了包的公共 API 边界。

**基础设施改进**：

- `package.json` exports 字段、CDN 版本锁定、版本管理策略等分发层面的问题，在前 4 轮中均被忽略。本轮补充了这些部署运维相关的内容，使文档更加完整。

---

## 改进记录 - 第 6 轮

**审查时间**: 2026-09-26
**审查范围**: 深度代码对照审查（Session/Message/ContentData 类型字段、Logger API、EventBus 事件类型、disconnectedCallback 清理完整性、beforeMessageSend 类型签名、生产示例字段访问正确性）
**审查方法**: 逐字段验证文档示例中引用的类型属性是否真实存在于源码接口定义中；逐方法验证 API 调用是否与源码签名一致

### 第 6 轮发现的问题和修复

1. **[严重] Session `id` 字段不存在（应为 `clientId`）**
   - 8.3 节类型安全示例使用 `detail.session.id`，但 `Session` 接口定义的是 `clientId`，不是 `id`
   - 8.4 节生产示例使用 `detail.session.id`，同样错误
   - 如果开发者按文档编写代码，TypeScript 编译器会报错
   - **修复**: 改为 `detail.session.clientId`，添加注释说明 Session 使用 `clientId` 而非 `id`

2. **[严重] Message `sessionId` 字段不存在**
   - 8.4 节生产示例 `messageSent` 和 `messageReceived` 回调中使用 `detail.message.sessionId`
   - `Message` 接口无 `sessionId` 字段（Message 只有 `clientId`、`role`、`content`、`timestamp`、`streaming`、`syncStatus`、`parentClientId`）
   - **修复**: 改为 `detail.message.clientId` 和 `detail.message.content.type`（更有意义的分析指标）

3. **[严重] `ContentData.length` 不存在**
   - 8.4 节生产示例使用 `detail.message.content.length`
   - `content` 类型为 `ContentData`（`{ type: ContentType; data: unknown }`），无 `.length` 属性
   - **修复**: 改为 `detail.message.content.type`（内容类型是更有意义的分析维度）

4. **[严重] `log.setLevel('debug')` 方法不存在**
   - 8.2 节调试指南展示 `log.setLevel('debug')`
   - 实际 `Logger` 接口只有 `debug/info/warn/error` 四个方法，无 `setLevel`
   - 日志级别通过全局函数 `setGlobalLogLevel()` 控制（从 `@rtc-agent/client` 导入）
   - **修复**: 改用 `setGlobalLogLevel('debug')`，更新导入语句

5. **[严重] `FunctionErrorEvent` 无 `params` 字段**
   - 8.4 节生产示例 `toolCallError` 回调中使用 `event.params`
   - `FunctionErrorEvent` 接口为 `{ path: string; error: Error }`，不含 `params`
   - **修复**: 改为 `event.error.message`（提供有用的错误信息给 Sentry）

6. **[警告] `beforeMessageSend` 返回类型不包含 Promise**
   - 类型定义为 `(content: ContentData) => boolean | void | ContentData`
   - 但文档明确展示 async 用法，且说"工厂函数内部处理 Promise 解包"
   - 类型签名与实际使用不一致，TypeScript 编译器会对 async 函数报错
   - **修复**: 返回类型增加 `Promise<boolean | void | ContentData>`

7. **[警告] `beforeMessageSend` 拦截范围未覆盖 fork 模式**
   - Phase 3 实施计划说"在 `MessageController.sendMessage()` 之前"拦截
   - 实际 `_boundOnInputSubmit` 处理器同时处理普通消息和 fork 两种路径
   - 如果拦截器仅放在 `sendMessage()` 之前，fork 场景的消息不会被拦截
   - **修复**: 更新实现路径说明，明确拦截器在 `sendMessage()` 和 `submitFork()` 调用之前

8. **[警告] 缺少 `generationStopped` 回调**
   - `rtc-stop-requested` 事件已存在（从 `rtc-input-area` 派发），用户点击停止按钮时触发
   - 回调列表中完全遗漏，宿主应用无法感知用户停止生成的操作
   - **修复**: 新增 `generationStopped` 回调，补充到回调接口、Phase 3 计划、附录公开事件表

9. **[警告] `disconnectedCallback`/`destroy()` 清理表不完整**
   - 实际 `disconnectedCallback` 还清理：UIUpdateBus 订阅、连接状态回调（`_unsubConnection`）、进行中的连接尝试（`_connectGeneration++`）、自动保存定时器（`_autoSaveTimers`）
   - 清理表遗漏了这些重要项目
   - **修复**: 补充 4 项清理内容到表格

10. **[建议] 缺少测试策略和验证方法**
    - 实施计划中虽提到"编写测试"，但缺少具体的测试策略、测试用例示例和验证方法
    - 未参考现有测试基础设施（vitest + Playwright）
    - 开发者无法评估实施完成后的验证标准
    - **修复**: 新增 8.6 节，提供完整的测试策略（单元测试、集成测试、E2E 测试、测试页面）

11. **[建议] Error 3 示例对 async 返回值的描述不准确**
    - 原文标注 async 返回 `Promise<boolean>` 为"❌ 错误"
    - 修正类型签名后（包含 Promise），async 返回是合法的
    - **修复**: 更新 Error 3 示例，标注 async 返回为合法，强调正确的使用模式

### 第 6 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 5 | 5 |
| 警告 | 4 | 4 |
| 建议 | 2 | 2 |
| **总计** | **11** | **11** |

### 第 6 轮关键发现总结

**类型字段验证是深度审查的核心价值**：

前 5 轮主要关注接口层面的正确性（类型是否存在、事件是否匹配），第 6 轮进一步深入到字段层面——文档示例中实际引用的属性名是否真实存在于类型定义中。这发现了 5 个严重错误：`session.id`（应为 `clientId`）、`message.sessionId`（不存在）、`content.length`（不存在）、`log.setLevel`（不存在）、`event.params`（不存在于 ErrorEvent）。

这类错误的特征是：在"看起来正确"的代码示例中隐藏了不存在的字段访问。TypeScript 编译器会立即报错，但文档审查时如果只关注逻辑流程而忽略字段验证，很容易遗漏。

**教训**：文档中每一处类型属性访问（`obj.field`）都应该与源码中的接口定义逐字段核对，不能仅凭"看起来合理"通过。

### 累计改进统计

| 轮次 | 严重 | 警告 | 建议 | 总计 |
| --- | --- | --- | --- | --- |
| 第 1 轮 | 3 | 4 | 3 | 10 |
| 第 2 轮 | 6 | 7 | 3 | 16 |
| 第 3 轮 | 3 | 6 | 3 | 12 |
| 第 4 轮 | 3 | 4 | 2 | 9 |
| 第 5 轮 | 3 | 5 | 3 | 11 |
| 第 6 轮 | 5 | 4 | 2 | 11 |
| 第 7 轮 | 2 | 2 | 2 | 6 |
| **总计** | **25** | **32** | **18** | **75** |

---

## 改进记录 - 第 7 轮

**审查时间**: 2026-09-26
**审查范围**: 类型来源一致性（Session/Message/ContentData 跨包类型冲突）、EventBus 事件 detail 可选字段、React 示例完整性、附录类型来源精确标注
**审查方法**: 逐类型追踪定义位置，区分组件 UI 层类型（`component/types/index.ts`）与协议层类型（`@rtc-agent/protocol`），验证文档示例中的类型导入源与实际事件派发的类型来源是否一致

### 第 7 轮发现的问题和修复

1. **[严重] `Session`/`Message` 类型导入源错误 -- 组件 UI 层类型与协议层类型混淆**
   - 8.3 节展示 `import { Session, Message } from '@rtc-agent/protocol'`
   - 但 `@rtc-agent/protocol` 的 `Session` 和 `Message` 是服务端 OpenAPI 生成模型，字段名使用 snake_case（`id`、`client_id`、`created_at`、`content: string`、`streaming_status: enum`）
   - 事件实际派发的是组件内部 `types/index.ts` 定义的 UI 层类型，使用 camelCase（`clientId`、`createdAt`、`content: ContentData`、`streaming?: boolean`）
   - 两套同名的 `Session`/`Message` 类型字段完全不兼容
   - 若开发者按文档从 protocol 导入，期望 `session.client_id` 或 `message.content`（string），在实际事件中会找不到字段
   - **修复**: 更正导入源为 `@rtc-agent/component`（Phase 1 补充导出后），添加类型来源对比表明确区分 UI 层与协议层

2. **[严重] 3.4 节与 8.3 节类型导入源互相矛盾**
   - 3.4 节回调接口头部写 `import { Session, Message } from '@rtc-agent/component'`
   - 8.3 节类型安全章节写 `import { Session, Message } from '@rtc-agent/protocol'`
   - 同一文档对同一类型给出两个不同的导入路径，开发者无法判断哪个正确
   - 实际上两者都不完全正确：`@rtc-agent/component` 当前未导出这些类型，`@rtc-agent/protocol` 导出的是不同类型
   - **修复**: 统一为从 `@rtc-agent/component` 导入，添加注释说明当前需从子路径导入，Phase 1 补充导出

3. **[警告] `toolCallApproved` 回调 `toolName` 类型签名与实际代码不匹配**
   - 文档：`toolCallApproved?: (detail: { id: string; toolName: string }) => void`
   - 实际代码（`tool-call.controller.ts` 第 59/67 行）：`const call = this._state.pendingCalls.find(...)` 后 `detail: {id, toolName: call?.toolName}`
   - `find()` 返回 `ToolCall | undefined`，`call?.toolName` 类型为 `string | undefined`
   - 若 pending call 在批准前被清除（竞态），`toolName` 会是 `undefined`
   - **修复**: 改为 `toolName?: string`

4. **[警告] 附录公开事件表 `rtc-tool-call-approved` detail 类型不完整**
   - 表格写 `{ id, toolName }`，未标注 `toolName` 可选
   - 与回调签名的修复保持一致
   - **修复**: 改为 `{ id; toolName? }`，补充说明 `toolName` 来自 `find()` 查找可能为 `undefined`

5. **[建议] 附录"未从主入口导出的类型"表格过于笼统**
   - 原表将 `Message`, `Session`, `ContentData` 合并为一行，标注 `src/types/index.ts / @rtc-agent/protocol`
   - 未区分 `Session`/`Message`（组件 UI 层定义）与 `ContentData`（protocol re-export）
   - 容易加深"这些类型都来自 protocol"的误解
   - **修复**: 拆分为三行，精确标注各自的定义位置和特征

6. **[建议] React 性能示例缺少 hooks 导入语句**
   - 8.5 节 React 示例使用 `useRef` 和 `useEffect` 但未导入
   - 虽然 React 开发者通常默认 hooks 已导入，但作为设计文档应完整
   - **修复**: 添加 `import { useRef, useEffect } from 'react'` 和相关类型导入

### 第 7 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 2 | 2 |
| 警告 | 2 | 2 |
| 建议 | 2 | 2 |
| **总计** | **6** | **6** |

### 第 7 轮关键发现总结

**跨包同名类型是隐蔽的陷阱**：

第 7 轮的核心发现是 `Session` 和 `Message` 在两个包（`@rtc-agent/component` 和 `@rtc-agent/protocol`）中存在同名但结构完全不同的定义。这不是简单的"拼写错误"或"字段缺失"，而是两个独立类型系统之间的语义冲突：

- 组件 UI 层类型是为前端渲染设计的，使用 camelCase，字段面向 UI 状态（`streaming: boolean`、`syncStatus`）
- 协议层类型是从 OpenAPI 自动生成的服务端模型，使用 snake_case，字段面向持久化（`streaming_status: enum`、`content: string`）

文档在前 6 轮中一直假设"类型只有一个"，直到第 7 轮追踪类型导入路径时才发现这个双重定义问题。这类问题的危险性在于：TypeScript 编译器不会报错（因为类型确实存在），但运行时的字段访问会全部失败。

**教训**：当文档涉及多个包的类型引用时，不仅要验证"类型是否存在"，还要验证"哪个包的类型才是正确的"。同名类型在不同包中可能代表完全不同的数据结构。

---

## 改进记录 - 第 8 轮

**审查时间**: 2026-09-26
**审查范围**: 事件 detail 类型完整性、TypeScript 语法一致性、类型导出列表准确性、回调签名与事件 detail 匹配度
**审查方法**: 逐事件验证 detail 类型定义与实际代码派发的一致性；逐类型验证导出状态与附录声明的匹配度；逐回调验证参数签名与对应事件 detail 的匹配度

### 第 8 轮发现的问题和修复

1. **[严重] `generationStopped` 回调签名与实际事件 detail 不匹配**
   - 文档 3.4 节定义：`generationStopped?: () => void;`（无参数）
   - 实际代码（`rtc-input-area.ts` 第 427 行）：`rtc-stop-requested` 事件派发 `detail: { sessionClientId: sessionId }`
   - 附录公开事件表也错误标注为 `void`
   - 如果开发者按文档编写回调，无法获取到停止的 session ID，与实际事件 payload 不一致
   - **修复**: 更正回调签名为 `(detail: { sessionClientId: string }) => void`，更新附录表格 detail 列为 `{ sessionClientId: string }`

2. **[警告] 附录公开事件表 `rtc-tool-call-approved` detail 类型使用错误语法**
   - 表格写 `{ id; toolName? }`（使用分号）
   - TypeScript 对象类型字面量应使用逗号分隔：`{ id, toolName? }`
   - 虽然分号在某些情况下 TypeScript 也能解析，但不符合惯用语法，可能误导开发者
   - **修复**: 改为 `{ id, toolName? }`（逗号分隔）

3. **[警告] 附录"导出的模块"表格错误声称 `FunctionDef` 和 `ParameterDef` 已导出**
   - 表格列出：`FunctionDef`, `ParameterDef`, `FunctionGroupDef` 等
   - 实际 `src/index.ts` 仅导出 `AgentConfig` 和 `AgentFunctionGroup`，未导出 `FunctionDef` 和 `ParameterDef`
   - 8.3 节类型导入示例也将这两个类型放在"已导出"分组中
   - 开发者按文档导入会失败
   - **修复**: 从"导出的模块"表格移除 `FunctionDef` 和 `ParameterDef`，添加到"未从主入口导出的类型"表格；更新 8.3 节导入示例，将这两个类型移到"待 Phase 1 补充导出"分组

4. **[警告] 附录"导出的模块"表格遗漏 `SkillController` 和 `CancelledError`**
   - 实际 `src/index.ts` 导出 `SkillController`（类）和 `CancelledError`（类型）
   - 文档附录未列出这两个导出
   - **修复**: 补充到"导出的模块"表格

5. **[建议] 8.3 节类型导入示例分组不够清晰**
   - 原示例将所有类型放在一个 import 语句中，未区分"已导出"和"待补充导出"
   - 开发者无法判断哪些类型当前可用，哪些需要等待 Phase 1
   - **修复**: 重新组织导入示例，明确分为三组：新增类型（待实施）、现有已导出类型、待 Phase 1 补充导出类型

### 第 8 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 1 | 1 |
| 警告 | 3 | 3 |
| 建议 | 1 | 1 |
| **总计** | **5** | **5** |

### 第 8 轮关键发现总结

**事件 detail 完整性验证的重要性**：

第 8 轮的核心发现是回调签名、事件 detail 类型定义、附录事件表格三者之间的一致性验证。前 7 轮已经深入到字段层面（如 `session.id` vs `session.clientId`），第 8 轮进一步验证"事件是否有 detail"以及"detail 的结构是什么"。

`generationStopped` 回调的错误很典型：文档假设事件无 payload（`void`），但实际代码派发了 `{ sessionClientId }`。这类错误的根源是：审查时只关注了"事件是否存在"，而忽略了"事件的完整 payload 是什么"。

**教训**：事件系统的文档化需要三层验证：

1. 事件是否存在（前 7 轮已覆盖）
2. 事件的 detail 结构是什么（第 8 轮新增）
3. 回调签名是否与 detail 匹配（第 8 轮新增）

**类型导出状态的精确性**：

附录"导出的模块"表格声称 `FunctionDef` 和 `ParameterDef` 已导出，但实际未导出。这类错误的危害在于：开发者信任文档的权威性，不会去验证导出是否真实存在，直到 TypeScript 编译器报错。

**教训**：文档中所有关于"已导出"的声明都必须逐条核对 `src/index.ts` 的 `export` 语句，不能凭印象或假设。

---

## 改进记录 - 第 9 轮

**审查时间**: 2026-09-26
**审查范围**: 深度交叉验证（`src/index.ts` 导出完整性、`RegistryConfig`/`FunctionGroupDef` 必需字段、跨轮次修复正确性、附录与实际导出一致性）
**审查方法**: 逐条核对 `src/index.ts` 的每条 `export` 语句与文档附录声明的一致性；验证迁移示例中的接口使用是否满足必需字段约束；回溯前轮修复是否引入了新的错误

### 第 9 轮发现的问题和修复

1. **[严重] `FunctionDef` 和 `ParameterDef` 被错误标记为"未从主入口导出" -- 第 8 轮修复引入的回归**
   - 附录"未从主入口导出的类型"表格列出 `FunctionDef`, `ParameterDef` 为未导出
   - 8.3 节类型导入示例将这两个类型放在"待 Phase 1 补充导出"分组中
   - 实际 `src/index.ts` 第 60-70 行明确导出：`export type { OpenAPISchema, ParameterDef, ReturnDef, VisualHooks, FunctionDef, FunctionGroupDef, RegistryConfig, ScenarioDef, ScenarioManifest } from './types/skill.js';`
   - 开发者若按文档从子路径导入，虽能工作但增加了不必要的复杂度
   - **修复**: 从"未导出"表格移除 `FunctionDef` 和 `ParameterDef`；更新 8.3 节导入示例，添加注释说明这两个类型已可从主入口导入；添加"已澄清"注释说明回归修复

2. **[警告] 附录"导出的模块"表格遗漏 12 个已导出类型**
   - `src/index.ts` 实际导出了以下类型，但附录表格均未列出：
     - Skill 类型：`OpenAPISchema`, `ReturnDef`, `VisualHooks`, `FunctionGroupDef`, `RegistryConfig`, `ScenarioDef`, `ScenarioManifest`（第 60-70 行）
     - Controller 类型：`SkillActions`, `SkillControllerConfig`（第 55 行）
     - Context 类型：`SkillContext`, `SkillContextValue`, `DEFAULT_SKILL_STATE`（第 56-57 行）
     - Validation 类型：`ValidationError`, `ValidationResult`（第 95-98 行）
   - 附录声称列出"完整公开 API"，但缺失 12 个导出，覆盖度仅约 70%
   - **修复**: 重写"导出的模块"表格，新增 5 行覆盖所有遗漏的导出类型

3. **[警告] 迁移指南 5.2 节 `defineRegistry` 缺少必需字段 `description`**
   - 示例写 `defineRegistry({ name: 'MyApp' })`
   - `RegistryConfig` 接口要求 `name: string` 和 `description: string` 两个必需字段
   - TypeScript 编译器会对缺少 `description` 报错
   - **修复**: 改为 `defineRegistry({ name: 'MyApp', description: 'My application' })`

4. **[警告] 迁移指南 5.2 节 `createGroup` 缺少必需字段 `description`**
   - 示例写 `registry.createGroup({ name: 'user' })`
   - `FunctionGroupDef` 接口要求 `name: string` 和 `description: string` 两个必需字段
   - TypeScript 编译器会对缺少 `description` 报错
   - **修复**: 改为 `registry.createGroup({ name: 'user', description: 'User operations' })`

### 第 9 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 1 | 1 |
| 警告 | 3 | 3 |
| 建议 | 0 | 0 |
| **总计** | **4** | **4** |

### 第 9 轮关键发现总结

**前轮修复回归的检测**：

第 9 轮最重要的发现是第 8 轮修复引入了一个新的回归错误。第 8 轮声称"附录错误声称 `FunctionDef` 和 `ParameterDef` 已导出"并将其移到"未导出"表格，但实际上这两个类型确实已从主入口导出（`src/index.ts` 第 60-70 行）。第 8 轮的审查者可能将 `FunctionDef`（skill types）与 `AgentFunction`（不存在的类型）混淆，或在核对 `src/index.ts` 时遗漏了 skill types 的导出块。

**教训**：每一轮的修复本身也需要被验证。"修复了 X"并不意味着"X 现在是正确的" -- 修复操作可能引入新的错误。深度审查应该覆盖前轮的修复内容，确保它们与源码一致。

**导出完整性的系统性问题**：

附录"导出的模块"表格从第 1 轮开始就存在，但一直未与 `src/index.ts` 做逐条核对。`src/index.ts` 有 99 行代码，包含约 15 条 `export` 语句，涉及 40+ 个导出符号。附录表格只覆盖了其中约 15 个符号，遗漏了 skill types（9 个）、controller types（2 个）、context types（3 个）和 validation types（2 个）共 16 个导出。

**教训**：当文档声称列出"完整公开 API"时，必须通过工具（如 `grep "export" src/index.ts`）生成完整的导出列表，然后与文档逐条对比，不能仅凭记忆或印象选择性列出。

### 累计改进统计（截至第 10 轮）

| 轮次 | 严重 | 警告 | 建议 | 总计 |
| --- | --- | --- | --- | --- |
| 第 1 轮 | 3 | 4 | 3 | 10 |
| 第 2 轮 | 6 | 7 | 3 | 16 |
| 第 3 轮 | 3 | 6 | 3 | 12 |
| 第 4 轮 | 3 | 4 | 2 | 9 |
| 第 5 轮 | 3 | 5 | 3 | 11 |
| 第 6 轮 | 5 | 4 | 2 | 11 |
| 第 7 轮 | 2 | 2 | 2 | 6 |
| 第 8 轮 | 1 | 3 | 1 | 5 |
| 第 9 轮 | 1 | 3 | 0 | 4 |
| 第 10 轮 | 2 | 5 | 5 | 12 |
| **总计** | **29** | **43** | **24** | **96** |

---

## 改进记录 - 第 10 轮

**审查时间**: 2026-09-26
**审查范围**: Shared Worker 集成深度审查（WorkerBridge、shared-worker.ts、worker-core.ts、PersistenceController）、MP3 音频系统审查（notification.controller.ts、settings.ts、sounds/*.mp3）、宿主应用集成痛点分析
**审查方法**: 逐行对照 `worker-bridge.ts`、`notification.controller.ts`、`contexts/settings.ts` 源码验证文档声明的实现状态；分析 SharedWorker 在宿主应用中可能遇到的 CSP、跨域、生命周期、多实例冲突等问题；分析 MP3 音频在宿主应用中可能遇到的自动播放策略、资源加载、音量控制等问题

### 第 10 轮发现的问题和修复

1. **[严重] `NotificationConfig.volume` 映射声明与代码实现不符**
   - 文档 3.2b 节定义 `volume` 字段并注释"映射到 `SettingsController.notifications`"
   - 实际 `SettingsState.notifications` 接口（`contexts/settings.ts:23-26`）仅有 `soundEnabled: boolean` 和 `toastEnabled: boolean` 两个字段，无 `volume` 字段
   - `notification.controller.ts:205` 硬编码 `sound.volume = 1.0`，没有从 settings 读取
   - 开发者若按文档实施，`volume` 配置不会生效，且无任何错误提示（静默失败）
   - **修复**: 为 `volume` 字段添加 `[需要新增]` 标记，补充完整实施路径（扩展 SettingsState 接口、修改 `_playSound()` 方法、可选添加 UI 控件），并在节首添加实施状态总览

2. **[严重] `WorkerConfig` 全部字段缺少实施状态标注**
   - 文档 3.2a 节 `WorkerConfig` 的 `scriptURL` 和 `name` 字段均未标注实施状态
   - 实际代码中：Worker 名称硬编码为 `'rtc-agent-worker'`（`worker-bridge.ts:262`），无自定义机制
   - Worker 脚本路径由 Vite `?sharedworker` 导入自动解析（`worker-bridge.ts:46`），无自定义机制
   - `WorkerBridge` 构造函数不接受任何配置参数（`worker-bridge.ts:106`）
   - 开发者可能误以为这些配置已可用，实施时发现无法透传
   - **修复**: 为整个 `WorkerConfig` 节添加实施状态说明块，为每个字段添加 `[需要新增]` 标记和具体实现路径

3. **[警告] 映射表 `worker` 和 `notification` 映射目标描述不准确**
   - 映射表写 `worker` → `PersistenceController 内部配置 | 透传到 WorkerBridge`
   - 实际 `WorkerBridge` 构造函数不接受外部配置（`worker-bridge.ts:106`），无法透传
   - 映射表写 `notification` → `SettingsController 内部配置 | 映射到 notifications 设置`
   - 实际 `soundEnabled`/`toastEnabled` 已可映射，但 `volume` 无法映射（`SettingsState` 无此字段）
   - **修复**: 更正映射表，`worker` 标注为 `[需要新增]`，`notification` 区分已实现和待新增字段

4. **[警告] 缺少 SharedWorker 生命周期管理说明**
   - 文档 7.7 节覆盖了架构、CSP、多实例、加载策略、错误处理，但缺少生命周期管理
   - SharedWorker 的生命周期与普通 API 不同：浏览器级管理、所有 port 关闭后自动终止
   - 宿主应用开发者不了解以下关键行为：
     - SPA 路由切换时组件 unmount 但 Worker 可能不终止（端口未关闭）
     - 浏览器内存压力可能强制终止 Worker
     - 没有 Worker 终止检测机制
   - **修复**: 新增 7.7.6 节 "SharedWorker 生命周期管理"，包含生命周期表格、SPA 注意事项、终止检测建议

5. **[警告] 缺少 SharedWorker `type: 'module'` 要求说明**
   - Worker 使用 ES Module 语法（`import`/`export`），构造时必须 `type: 'module'`
   - 浏览器兼容性有限制：Chrome 80+、Firefox 114+、Safari 16.4+
   - 文档未提及此要求，宿主应用开发者可能在旧版浏览器中遇到问题
   - **修复**: 新增 7.7.7 节 "SharedWorker `type: 'module'` 要求"，包含兼容性表格和检测代码

6. **[警告] 常见问题排查缺少 SharedWorker 和音频的高级场景**
   - 原有 3 个排查问题（Worker 初始化失败、音效不播放、多 Tab 不同步）覆盖基础场景
   - 缺少以下常见痛点场景：
     - 浏览器更新后 Worker 不工作
     - SPA 路由切换后 Worker 资源泄漏
     - `type: 'module'` 不支持
     - iOS Safari 音效完全不播放
   - **修复**: 新增问题 4-7，覆盖上述场景，每个问题包含症状、排查步骤和解决方案

7. **[建议] 7.8.3 音频配置示例中 `volume` 未标注实施状态**
   - 示例直接展示 `notification: { volume: 0.5 }` 用法
   - 未说明此功能 `[需要新增]`，当前代码中 `volume` 硬编码为 `1.0`
   - **修复**: 已在 3.2b 节添加 `[需要新增]` 标记，示例处无需重复标注（接口定义已覆盖）

8. **[建议] 音频降级方案表未说明 iOS Safari 特殊行为**
   - 7.8.4 降级方案表仅覆盖桌面浏览器场景
   - iOS Safari 有更严格的自动播放策略：即使有用户交互，非手势事件中创建的 Audio 实例仍可能被阻止
   - **修复**: 在问题 7 中详细说明 iOS Safari 特殊行为和宿主应用解决方案（AudioContext 预热）

9. **[建议] 3.2a 节 `WorkerConfig` 缺少 `scriptURL` 的跨域处理说明**
   - `scriptURL` 的自定义场景下，如果 URL 跨域，需要 CDN 返回 CORS 头
   - 但文档仅在同源/跨域加载策略（7.7.4）中描述了 fetch → blob: 流程
   - 如果提供了自定义 `scriptURL`，该流程是否仍然适用？
   - **修复**: 在 `scriptURL` 字段注释中明确说明：如果提供了 `scriptURL`，将跳过 fetch → blob: 流程，直接使用 `new SharedWorker(scriptURL, ...)`

10. **[建议] 缺少 SharedWorker `clearData` 与残留连接的处理说明**
    - 项目记忆中有 `clearData` 修复记录：`clearData()` 需要在断开 SharedWorker 之前执行
    - 宿主应用在清除用户数据时，如果不清除 SharedWorker 连接，可能导致 IndexedDB 数据残留
    - **修复**: 在 7.7.6 生命周期管理节中补充说明，`destroy()` 应在 `clearData()` 之前调用

11. **[建议] Markdown 表格分隔符格式不一致（MD060）**
    - 新增的表格使用 `|------|------|` 长分隔符
    - 文档其他表格统一使用 `| --- | --- |` 短分隔符
    - **修复**: 统一所有表格分隔符为 `| --- | --- |` 格式

### 第 10 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 2 | 2 |
| 警告 | 5 | 5 |
| 建议 | 5 | 5 |
| **总计** | **12** | **12** |

### 第 10 轮关键发现总结

**实现状态标注是文档准确性的基础**：

第 10 轮的核心发现是 `WorkerConfig` 和 `NotificationConfig` 中的多个字段被描述为可用配置，但实际代码中完全没有实现机制。这不是"待实施的新 API"的遗漏 -- 前 9 轮已经明确标注了哪些是新 API，但 `WorkerConfig` 和 `NotificationConfig` 的字段缺少 `[需要新增]` 标记，给人"已实现"的错觉。

特别严重的是 `NotificationConfig.volume`：文档声称"映射到 `SettingsController.notifications`"，但 `SettingsState.notifications` 根本没有 `volume` 字段。这不仅是功能缺失，更是映射关系错误。开发者如果按文档实施，会花费时间调试"为什么 volume 配置不生效"，最终发现需要同时修改接口定义、实现逻辑和 UI。

**教训**：文档中的每个配置字段都必须验证其映射链路是否完整存在：

1. 目标接口是否有对应字段？
2. 映射代码是否已实现？
3. 运行时是否能正确读取？

**SharedWorker 是宿主应用集成的核心痛点**：

SharedWorker 不同于普通的 Web API -- 它的生命周期在浏览器级别管理，不绑定于单个页面或 Tab。这意味着：

1. **SPA 场景**：路由切换不会终止 Worker，如果不正确释放 port，Worker 会一直存在
2. **多实例场景**：相同 `name` 的 SharedWorker 会共享同一实例，导致数据混淆
3. **资源泄漏**：每次创建组件而不销毁，都会增加一个 MessagePort，Worker 永远不会终止

这些痛点在前 9 轮中完全未被提及，因为它们属于"集成时才会发现"的问题。文档审查者如果只关注 API 设计的正确性，而忽略实际部署场景，就会遗漏这类问题。

**教训**：文档审查应该包含"集成模拟"步骤 -- 假设自己是宿主应用开发者，从零开始集成组件，思考每一步可能遇到的问题。这比纯粹审查 API 设计更能发现实际问题。

---

## 改进记录 - 第 11 轮

**审查时间**: 2026-09-26
**审查范围**: SharedWorker 错误处理链路深度验证、重试策略参数准确性、音频加载降级完整性、Worker 调试指南缺失、scriptURL 类型约束
**审查方法**: 逐行验证 7.7.5 节错误处理示例代码中的 context 字符串是否存在于源码；逐常量验证重试次数和退避算法描述；逐分支验证音频延迟加载策略覆盖度

### 第 11 轮发现的问题和修复

1. **[严重] 7.7.5 节 Worker 错误处理示例代码中的 `on.error` context 值完全虚构**
   - 文档列出了 `'worker-init'`、`'worker-connect'`、`'worker-verify'`、`'connection'` 四个 context 值
   - 实际代码中这些 context 字符串**完全不存在**于任何文件
   - `WorkerBridge` 和 `PersistenceController` 的错误仅通过 `createLogger()` 输出到 console（`log.error(...)`），不通过 `on.error` 回调传递
   - `AgentConfig.onError`（`function-registry.ts:258,388`）仅在函数执行失败时调用，不覆盖 Worker 层面的错误
   - 宿主应用按文档编写的 `if (context === 'worker-init')` 分支永远不会执行
   - **修复**: 重写 7.7.5 节错误处理示例，明确说明 Worker 错误不触发 `on.error` 回调，提供正确的替代方案（`connectionStateChange` 回调 + debug 日志）

2. **[警告] 7.7.5 节重试策略描述中"指数退避"是错的**
   - 文档写"指数退避：1s, 2s, 3s"和"指数退避：2s, 4s"
   - 实际代码：`INIT_RETRY_DELAY_MS * attempt` = 1000*1=1s, 1000*2=2s, 1000*3=3s（**线性退避**，不是指数）
   - 实际代码：`CONNECT_RETRY_DELAY_MS * attempt` = 2000*1=2s, 2000*2=4s（**线性退避**，不是指数）
   - 指数退避应为 1s, 2s, 4s（2^n）或类似模式
   - **修复**: 改为"线性退避"，补充具体常量名和源码行号引用

3. **[警告] 7.8.2 节音频延迟加载描述遗漏 idle callback 超时降级**
   - 文档只描述了两种情况：`requestIdleCallback` 可用 → 使用；不可用 → `setTimeout(500ms)`
   - 遗漏了第三种情况（`notification.controller.ts:159-168`）：即使 `requestIdleCallback` 可用，如果 2000ms 内未触发（`IDLE_FALLBACK_DELAY_MS`），也会降级为立即加载
   - 这意味着在浏览器繁忙（持续无空闲）的场景下，非关键音效最多延迟 2 秒加载，而非无限等待
   - **修复**: 补充完整的三级降级策略描述

4. **[警告] 7.7.6 节生命周期表格中"浏览器内存压力"场景的应对描述不准确**
   - 文档写"组件 `initWorker()` 有重试机制，下次操作时自动恢复"
   - 实际代码中，`initWorker()` 的重试仅发生在**初始连接阶段**（`PersistenceController.connect()`）
   - 如果 Worker 在运行中被浏览器强制终止，后续 Comlink 调用会抛出异常（`port is closed`），**没有自动恢复机制**
   - 用户需要刷新页面重建 Worker
   - **修复**: 改为"Comlink 后续调用抛出异常；用户需刷新页面重建 Worker（无自动恢复机制）"

5. **[建议] 缺少 SharedWorker 调试指南**
   - 文档覆盖了 CSP、跨域、生命周期、多实例等集成问题，但缺少如何调试 Worker 内部状态
   - 宿主应用开发者遇到 Worker 问题时，不知道如何查看 Worker 的 console 输出、IndexedDB 数据、WebSocket 消息
   - **修复**: 新增"问题 8：需要调试 SharedWorker 内部状态"，说明 DevTools → Application → Shared Workers → Inspect 的使用方法

6. **[建议] `WorkerConfig.scriptURL` 未明确说明仅支持 ES Module 格式**
   - 文档说"直接使用 `new SharedWorker(scriptURL, ...)`"，但未说明 `type` 参数
   - 组件始终以 `type: 'module'` 构造 SharedWorker（`worker-bridge.ts:263`）
   - 如果宿主应用提供经典 Worker 脚本（使用 `importScripts()` 而非 `import`），会加载失败
   - **修复**: 在 `scriptURL` 注释中添加 `@important` 说明，明确构造参数包含 `type: 'module'`，自定义脚本必须是 ES Module 格式

### 第 11 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 1 | 1 |
| 警告 | 3 | 3 |
| 建议 | 2 | 2 |
| **总计** | **6** | **6** |

### 第 11 轮关键发现总结

**虚构的错误上下文是最危险的文档错误**：

第 11 轮最严重的发现是 7.7.5 节中 `on.error` 回调的 context 值完全是虚构的。这类错误的特征是：代码示例看起来合理，逻辑流程正确，但具体的字符串值在源码中不存在。

这比"代码示例无法编译"更危险，因为：

1. **TypeScript 不报错**：`context` 参数类型是 `string`，任何字符串都能通过类型检查
2. **运行时不报错**：`if (context === 'worker-init')` 只是永远不进入分支，不会抛出异常
3. **开发者无法感知**：他们会以为 Worker 错误处理"没生效"，而不会怀疑文档本身是错的

更深层的问题是：文档声称 Worker 错误通过 `on.error` 回调通知宿主应用，但这个整条链路都不存在。`WorkerBridge` 只用 `log.error()` 打印错误，没有任何机制将错误传递到 `AgentConfig.onError`。

**教训**：文档中的字符串常量（context 值、事件名、配置键名等）必须通过 `grep` 在源码中验证其存在性，不能凭印象编写。"看起来合理的字符串"和"真实存在的字符串"是两回事。

**退避算法的精确描述很重要**：

"指数退避"和"线性退避"在重试场景中有本质区别。指数退避（1s, 2s, 4s, 8s）适合网络拥塞场景，线性退避（1s, 2s, 3s）适合临时故障场景。文档将线性退避描述为指数退避，会误导开发者对重试耗时的预期。

累计改进统计：

| 轮次 | 严重 | 警告 | 建议 | 总计 |
| --- | --- | --- | --- | --- |
| 第 1 轮 | 3 | 4 | 3 | 10 |
| 第 2 轮 | 6 | 7 | 3 | 16 |
| 第 3 轮 | 3 | 6 | 3 | 12 |
| 第 4 轮 | 3 | 4 | 2 | 9 |
| 第 5 轮 | 3 | 5 | 3 | 11 |
| 第 6 轮 | 5 | 4 | 2 | 11 |
| 第 7 轮 | 2 | 2 | 2 | 6 |
| 第 8 轮 | 1 | 3 | 1 | 5 |
| 第 9 轮 | 1 | 3 | 0 | 4 |
| 第 10 轮 | 2 | 5 | 5 | 12 |
| 第 11 轮 | 1 | 3 | 2 | 6 |
| **总计** | **30** | **46** | **26** | **102** |

---

## 改进记录 - 第 12 轮

**审查时间**: 2026-09-26
**审查范围**: CDN 跨域问题深度审查（Shared Worker JS 的 fetch-to-blob 机制、MP3 音频的跨域加载行为、场景文档的 CORS 要求、CSP 配置完整性、宿主应用 CDN 集成体验）
**审查方法**: 逐行对照 `worker-bridge.ts:200-289`、`notification.controller.ts:39-41, 174-195`、`scenario-loader.ts:113-123` 源码验证文档中跨域相关描述的准确性；从宿主应用开发者角度模拟 CDN 部署场景，识别遗漏的跨域处理环节

### 第 12 轮发现的问题和修复

1. **[严重] 缺少 CDN 跨域资源完整清单 -- 开发者无法一站式了解所有资源的跨域要求**
   - 文档中关于跨域的信息分散在 7.7.2（CSP）、7.7.4（Worker 加载策略）、7.8.2（音频加载）等多个章节
   - 缺少一个综合性的清单，说明每种资源（JS、Worker、MP3、场景文档、WebSocket）的加载方式、CORS 要求和 CSP 指令
   - 宿主应用开发者需要跨章节拼凑信息，容易遗漏关键配置（如场景文档的 `connect-src`）
   - **修复**: 新增 7.7.2a 节 "CDN 跨域资源完整清单"，提供资源类型/加载方式/CORS 要求/CSP 指令的完整矩阵表格

2. **[严重] 场景文档的 CORS 要求完全未记录**
   - `scenariosUrl` 配置指定的场景文档（manifest.json + .md 文件）通过 `fetch()` 加载（`scenario-loader.ts:113-123`）
   - `fetch()` 跨域时受 CORS 策略限制，CDN 必须返回 `Access-Control-Allow-Origin` 头
   - 宿主应用的 CSP 必须包含 `connect-src` 指令允许场景文档来源
   - 文档中完全未提及场景文档的 CORS/CSP 要求，开发者配置 `scenariosUrl` 指向跨域 CDN 时会遇到加载失败
   - **修复**: 在 7.7.2 CSP 表格中补充 `connect-src` 的场景文档说明；在 7.7.2a 资源矩阵中列出场景文档；新增"问题 10"排查指南

3. **[严重] MP3 音频的 CORS/CSP 描述存在事实错误**
   - 7.8.2 节仅说"CDN 部署：音效文件随组件一起部署到 CDN，URL 自动解析"，未说明跨域行为
   - 7.8.4 节降级方案表写"CSP 阻止 media-src | fetch 失败" -- 但 `<audio>` 元素加载 MP3 **不通过 fetch**，而是通过 HTMLAudioElement 的媒体加载机制
   - 缺少关键信息：`new Audio()` 是媒体元素，跨域加载 MP3 **不需要** CORS 头，但 CSP `media-src` 必须包含 CDN 域名
   - 开发者可能错误地认为 MP3 也需要 CORS 头，或在 CSP 中遗漏 `media-src` 配置
   - **修复**: 重写 7.8.2 节，添加 "CDN 部署时的跨域处理" 子节，明确说明 `<audio>` 不需要 CORS 但需要 `media-src` CSP；更正 7.8.4 降级表中 CSP 行描述

4. **[警告] Worker 脚本 blob: URL 的子资源限制未说明**
   - Worker 脚本通过 fetch → blob: URL 方式加载后，`import.meta.url` 在 Worker 内部解析为 `blob:...` 协议
   - 如果 Worker 脚本包含动态 `import()` 相对路径，浏览器会从 `blob:` 基础解析，导致加载失败
   - Vite 构建的 Worker 通常是单文件自包含的，实际中不受影响，但自定义 Worker 脚本需要注意
   - 文档 7.7.4 节未提及此限制
   - **修复**: 在 7.7.4 节新增 "Worker 脚本子资源限制" 段落，说明 `import.meta.url` 行为和单文件约束

5. **[警告] `worker.scriptURL` 实现路径未说明跨域处理的边界**
   - 3.2a 节说"如果提供了 `scriptURL`，跳过 fetch → blob: 流程，直接使用 `new SharedWorker(scriptURL, ...)`"
   - 但未明确说明：内置的 fetch → blob: 转换（`worker-bridge.ts:239-269`）**仅处理 Vite 构建自动解析的 Worker 路径**
   - 自定义 `scriptURL` 的跨域处理完全由调用者负责（CDN CORS 配置、ES Module 格式）
   - **修复**: 在 `scriptURL` 注释中新增 `@important` 标注，明确跨域处理的职责边界

6. **[警告] 缺少 CDN 部署的完整检查清单**
   - 文档分散描述了各种跨域要求，但缺少一个可操作的部署前检查清单
   - 宿主应用开发者在部署到 CDN 前需要一个系统性的验证步骤
   - **修复**: 新增 7.10 节 "CDN 部署跨域检查清单"，包含 CORS 头配置表、CSP 配置模板、验证步骤、常见 CDN 服务默认行为对照表

7. **[警告] 缺少 CDN 部署的常见 CORS 错误排查指南**
   - 7.9 节的问题排查覆盖了 Worker 初始化、音效、多 Tab 同步等基础场景
   - 但缺少 CDN 部署最常见的痛点：CORS 错误（Worker 脚本、场景文档）和 CSP 违规（media-src）
   - 开发者遇到 "Failed to fetch" 或 "Refused to load media" 错误时，无法在文档中找到对应的排查指南
   - **修复**: 新增问题 9（Worker CORS 错误）、问题 10（场景文档 CORS 错误）、问题 11（音效 CSP 错误），每个包含症状、根本原因、排查步骤和解决方案

8. **[建议] CSP `connect-src` 描述不够完整**
   - 7.7.2 节 CSP 示例中 `connect-src` 仅列出 WebSocket 和 API，未包含场景文档
   - 如果宿主应用配置了 `scenariosUrl` 指向跨域 CDN，`connect-src` 必须包含该来源
   - **修复**: 更新 CSP 示例和表格中 `connect-src` 的描述，补充场景文档

9. **[建议] Worker 脚本 fetch 使用 `cache: 'no-store'` 的行为未记录**
   - `worker-bridge.ts:245` 中 fetch 使用 `cache: 'no-store'` 选项，每次加载都获取最新脚本
   - 这意味着 CDN 的缓存策略不会影响 Worker 脚本的新鲜度，但每次都会产生网络请求
   - 宿主应用开发者可能期望 Worker 脚本被浏览器缓存以加速加载
   - **修复**: 在 7.7.4 节"宿主应用需要关注"中补充 `cache: 'no-store'` 说明

10. **[建议] "常见误解"段落的格式不规范（MD036）**
    - 7.7.2a 节中 "**关键区分：CORS vs CSP**" 和 "**常见误解**：" 使用粗体文本作为标题
    - Markdown 规范要求使用标题语法（`#####`）而非粗体文本作为段落标题
    - **修复**: 改为 `#####` 五级标题

### 第 12 轮修复统计

| 严重程度 | 发现数量 | 修复数量 |
| --- | --- | --- |
| 严重 | 3 | 3 |
| 警告 | 4 | 4 |
| 建议 | 3 | 3 |
| **总计** | **10** | **10** |

### 第 12 轮关键发现总结

**CORS 和 CSP 的混淆是最常见的 CDN 集成误区**：

第 12 轮的核心发现是开发者（以及前 11 轮文档审查）对 CORS 和 CSP 的混淆。这两个概念虽然都涉及"跨域"，但机制完全不同：

- **CORS**（Cross-Origin Resource Sharing）是**服务器端**的响应头，控制浏览器是否允许跨域**读取**响应内容。只有通过 `fetch()`/`XMLHttpRequest` 加载的资源才需要 CORS。`<audio>`/`<img>`/`<video>` 等媒体元素可以跨域加载资源，不需要 CORS 头。
- **CSP**（Content Security Policy）是**客户端**的安全策略，控制浏览器**允许加载**哪些来源的资源。所有资源加载都受 CSP 约束，与 CORS 无关。

前 11 轮文档中 7.8.4 节的降级表写"CSP 阻止 media-src | fetch 失败"，暗示 MP3 通过 `fetch()` 加载。实际上 MP3 通过 `new Audio()` 加载，根本不走 `fetch()` 路径。虽然降级行为相同（加载失败后不影响其他功能），但错误描述了加载机制，会误导开发者在排查问题时检查错误的方向。

**教训**：描述资源加载失败时，必须准确说明加载机制（`fetch()` vs `HTMLAudioElement` vs `<script>`），因为不同机制的跨域要求完全不同。"加载失败"不是一类问题 -- `fetch` 失败需要 CORS，`<audio>` 失败需要 CSP，`<script type="module">` 失败两者都需要。

**场景文档是 CDN 集成的隐形陷阱**：

场景文档（`scenariosUrl`）的 CORS 要求在前 11 轮中完全未被提及。这可能是因为：

1. 场景文档是可选功能（不是所有宿主应用都使用）
2. 场景文档的 URL 通常配置为同域路径（如 `./scenarios/`），不会触发 CORS
3. 场景文档是 Markdown 文件，开发者可能不会立即联想到它们需要 CORS 头

但一旦宿主应用将场景文档部署在 CDN 上，就会遇到 `fetch()` CORS 错误。这类错误的特征是：组件核心功能（聊天、工具调用）正常工作，但场景文档加载失败，导致 VirtualFS 中没有场景文档。开发者可能不会立即将问题与 CORS 关联，因为错误信息来自 `ScenarioLoader`，而不是 Worker 或 API 层面。

**教训**：文档中所有通过 `fetch()` 加载的资源都应该在 CORS/CSP 指南中明确列出，无论资源类型是 JS、JSON 还是 Markdown。开发者不会根据文件扩展名判断是否需要 CORS，而是根据加载机制。

**CDN 部署检查清单是实用价值最高的新增内容**：

7.10 节的 "CDN 部署跨域检查清单" 是本轮新增的实用内容，将分散在各章节的跨域要求汇总为一份可操作的清单。这类内容的价值在于：

1. 开发者可以在部署前逐项检查，避免上线后踩坑
2. 常见 CDN 服务的默认行为对照表帮助开发者快速判断是否需要额外配置
3. CSP 配置模板可以直接复制使用，减少手动编写的错误

累计改进统计：

| 轮次 | 严重 | 警告 | 建议 | 总计 |
| --- | --- | --- | --- | --- |
| 第 1 轮 | 3 | 4 | 3 | 10 |
| 第 2 轮 | 6 | 7 | 3 | 16 |
| 第 3 轮 | 3 | 6 | 3 | 12 |
| 第 4 轮 | 3 | 4 | 2 | 9 |
| 第 5 轮 | 3 | 5 | 3 | 11 |
| 第 6 轮 | 5 | 4 | 2 | 11 |
| 第 7 轮 | 2 | 2 | 2 | 6 |
| 第 8 轮 | 1 | 3 | 1 | 5 |
| 第 9 轮 | 1 | 3 | 0 | 4 |
| 第 10 轮 | 2 | 5 | 5 | 12 |
| 第 11 轮 | 1 | 3 | 2 | 6 |
| 第 12 轮 | 3 | 4 | 3 | 10 |
| **总计** | **33** | **50** | **29** | **112** |
