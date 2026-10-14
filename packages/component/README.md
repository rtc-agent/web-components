# @rtc-agent/component

基于 Lit 的 Web Component 组件库，提供浮窗式 RTC Agent 交互界面。

## 目录

- [快速开始](#快速开始)
- [基础使用](#基础使用)
- [API 参考](#api-参考)
- [使用示例](#使用示例)
- [SharedWorker 配置](#sharedworker-配置)
- [CDN 使用](#cdn-使用)
- [架构说明](#架构说明)
- [常见问题](#常见问题)

---

## 快速开始

### 安装

```bash
pnpm add @rtc-agent/component
```

**配置 SharedWorker**（必需）：

```bash
npx rtc-agent-setup
```

或在 `package.json` 中添加 postinstall 钩子：

```json
{
  "scripts": {
    "postinstall": "rtc-agent-setup"
  }
}
```

### 使用工厂函数（推荐）

```ts
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  auth: {
    getToken: () => localStorage.getItem('token'),
    refreshToken: async () => {
      const res = await fetch('/api/refresh');
      const data = await res.json();
      return { accessToken: data.token };
    },
    userId: 'user-123',
  },
});

document.body.appendChild(agent);

// 销毁
agent.destroy();
```

### 使用 HTML 元素

```html
<script type="module">
  import '@rtc-agent/component';
</script>

<rtc-agent
  theme="system"
  app-label="RTC Agent"
  scenarios-url="./scenarios/"
></rtc-agent>
```

---

## 基础使用

### 示例 1: 最简集成

```ts
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
});

document.body.appendChild(agent);
```

### 示例 2: 动态 Token 认证（推荐）

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  auth: {
    getToken: () => localStorage.getItem('access_token') ?? '',
    refreshToken: async () => {
      const response = await fetch('/api/auth/refresh', { method: 'POST' });
      const data = await response.json();
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
      };
    },
    userId: 'user-123',
  },
});

document.body.appendChild(agent);
```

### 示例 3: 监听事件

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  on: {
    ready: () => console.log('Agent ready!'),
    sessionCreated: ({ session }) => console.log('New session:', session.title),
    messageReceived: ({ message }) => console.log('Received:', message),
  },
});

document.body.appendChild(agent);
```

---

## API 参考

### createRtcAgent(config: RtcAgentConfig)

创建并配置 `<rtc-agent>` 实例的工厂函数。

**参数**：

| 属性 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `appLabel` | `string` | `'RTC Agent'` | 标题栏 / 气泡 tooltip 文本 |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 视觉主题 |
| `lang` | `string` | `'zh-CN'` | BCP 47 语言标签 |
| `bubbleIcon` | `string` | — | 最小化气泡内的 SVG / HTML |
| `logo` | `{ light?: string; dark?: string } \| null` | `null` | 自定义 Logo（light/dark 两套） |
| `workerURL` | `string` | `undefined` | SharedWorker 文件 URL |
| `databaseName` | `string` | `rtc-agent-${userId}` | IndexedDB 数据库名前缀 |
| `scenariosURL` | `string` | — | 场景文档 URL |

### 服务端配置

```ts
server: {
  url: string;        // 后端服务 URL（必填）
  redirectUri?: string; // OAuth 重定向 URI
}
```

### 认证配置

支持三种模式：

#### 模式 1: 静态 Token

```ts
auth: {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  expiresIn?: number;
}
```

#### 模式 2: 动态 Token（推荐）

```ts
auth: {
  getToken: () => string | Promise<string>;
  refreshToken?: () => Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  userId: string;
}
```

#### 模式 3: AuthProvider

```ts
auth: {
  getToken: () => string | Promise<string>;
  refreshToken: () => Promise<{ accessToken: string }>;
  isLoggedIn: () => boolean;
  logout?: () => Promise<void>;
}
```

**窗口配置**：

```ts
window: {
  defaultMode?: 'normal' | 'maximized' | 'minimized';
  embedded?: boolean;
  initialSize?: { width: number; height: number };
  // ... 更多配置见类型定义
}
```

**事件回调**：

```ts
on: {
  ready?: () => void;
  sessionCreated?: (detail: { session: Session }) => void;
  messageReceived?: (detail: { message: Message }) => void;
  toolCallStart?: (detail: { path: string; params: Record<string, unknown> }) => void;
  // ... 更多事件见类型定义
}
```

**返回值**：`RtcAgentWithLifecycle`（DOM 元素，附带 `destroy()` 方法）

---

## 使用示例

### 拦截消息发送

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  on: {
    beforeMessageSend: ({ message }) => {
      if (message.content.includes('spam')) {
        return false; // 取消发送
      }
      message.content = message.content.trim();
      return true; // 继续发送
    },
  },
});
```

### 注册 Agent 函数

```ts
const agent = createRtcAgent({
  appLabel: 'Code Editor',
  server: { url: 'https://api.example.com' },
  groups: [
    {
      name: 'editor',
      description: 'Code editor operations',
      functions: [
        {
          name: 'getCode',
          description: 'Get current code',
          handler: () => editorAPI.getCode(),
        },
      ],
    },
  ],
});
```

### 嵌入模式

```ts
const agent = createRtcAgent({
  appLabel: 'Embedded Assistant',
  server: { url: 'https://api.example.com' },
  window: {
    embedded: true,
  },
});

document.getElementById('container')!.appendChild(agent);
```

---

## SharedWorker 配置

### 为什么需要配置？

SharedWorker 文件必须在浏览器中可访问，但 NPM 包的 worker 文件位于 `node_modules` 内部，无法直接加载。

### 自动配置（推荐）

```bash
npx rtc-agent-setup
```

工具会自动：

- 检测项目类型（Vite/Webpack/SvelteKit）
- 复制 worker 文件到 public 目录
- 创建稳定的文件名 `shared-worker.js`

### 手动配置

**Vite / SvelteKit**：

```bash
mkdir -p public/rtc-agent
cp node_modules/@rtc-agent/component/dist/assets/shared-worker-*.js \
   public/rtc-agent/shared-worker.js
```

**配置 workerURL**：

```ts
const agent = createRtcAgent({
  workerURL: '/rtc-agent/shared-worker.js',
  // ... 其他配置
});
```

### 验证配置

打开浏览器控制台，应该看到：

```text
[WorkerBridge] Using custom workerURL: /rtc-agent/shared-worker.js
```

### 故障排除

**Worker 验证超时**：

1. 访问 `chrome://inspect/#workers`
2. 终止名为 `rtc-agent-worker` 的 SharedWorker
3. 刷新页面

**动态模块加载失败**：

清除浏览器缓存（硬刷新），组件会自动重试 2 次。

---

## CDN 使用

```html
<script type="module">
  import { createRtcAgent } from 'https://cdn.example.com/@rtc-agent/component/dist/index.js';
  
  const agent = createRtcAgent({
    appLabel: 'My Assistant',
    server: { url: 'https://api.example.com' },
    auth: {
      accessToken: 'your-token',
      userId: 'user-123',
    },
  });
  
  document.body.appendChild(agent);
</script>
```

**注意**：CDN 链接需根据实际部署地址调整。

---

## 架构说明

RTC Agent 使用 SharedWorker + Comlink 架构实现多 Tab 共享：

- **单 WebSocket 连接**（SharedWorker 内）
- **共享 IndexedDB 存储**
- **Master Tab 选举**（Web Locks API）

### 导出

**组件**：

- `<rtc-agent>` — 根组件（唯一公开注册的 custom element）

**类**：

```ts
import { RtcAgent } from '@rtc-agent/component';
const agent = document.querySelector<RtcAgent>('rtc-agent')!;
```

**工厂函数**：

```ts
import { createRtcAgent } from '@rtc-agent/component';
const agent = createRtcAgent({ /* ... */ });
```

### 公开属性

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 主题 |
| `app-label` | `string` | `'RTC Agent'` | 标题栏文本 |
| `worker-url` | `string` | `''` | SharedWorker URL |
| `scenarios-url` | `string` | `''` | 场景文档 URL |

### 公开事件

**生命周期事件**：

- `rtc-agent-ready` — 组件就绪
- `rtc-before-destroy` — 组件即将销毁
- `rtc-theme-change` — 主题变化

**会话事件**：

- `rtc-session-created` / `rtc-session-switched` / `rtc-session-renamed` / `rtc-session-deleted`

**消息事件**：

- `rtc-message-sent` / `rtc-message-received`

**认证事件**：

- `rtc-auth-login` / `rtc-auth-logout` / `rtc-auth-refresh-failed`

### 代码高亮

消息中的代码块使用 highlight.js 进行语法高亮。组件按需注册了 15 种常用语言：

| 类别 | 语言 |
| --- | --- |
| Web 开发 | JavaScript, TypeScript, XML, CSS, JSON |
| 后端/系统 | Python, Go, Bash, YAML, SQL |
| 配置/标记 | Markdown, Diff, Plaintext |

---

## 常见问题

### Q: 为什么需要 SharedWorker？

SharedWorker 允许多个 Tab 共享同一个 WebSocket 连接和 IndexedDB 数据，避免重复连接和数据不一致。

### Q: 如何自定义主题？

通过 `theme` 属性设置为 `'light'`、`'dark'` 或 `'system'`（跟随系统偏好）。

### Q: 如何监听工具调用？

通过 `on` 配置注册事件回调：

```ts
on: {
  toolCallStart: ({ path, params }) => console.log('Tool call:', path),
  toolCallSuccess: ({ path, result }) => console.log('Success:', result),
  toolCallError: ({ path, error }) => console.error('Error:', error),
}
```

### Q: 如何拦截消息发送？

使用 `beforeMessageSend` 回调：

```ts
on: {
  beforeMessageSend: ({ message }) => {
    // 返回 false 取消发送
    // 返回 true 继续发送
    // 可以修改 message.content
    return true;
  },
}
```

### Q: 升级后如何更新 SharedWorker？

重新运行 `npx rtc-agent-setup`，或在 `package.json` 中配置 postinstall 钩子自动更新。

---

## 开发脚本说明

### 为什么有多个 `pre*` 脚本？

`package.json` 中包含多个 `pre*` 脚本（`prebuild`、`predev`、`pretypecheck`、`pretest`），它们都运行 `lit-localize build`。

**原因：**

1. **国际化支持**：项目使用 `@lit/localize` 进行多语言支持
2. **模板生成**：`lit-localize build` 会生成翻译模板文件（`src/generated/`）
3. **依赖检查**：TypeScript 编译、Vite 构建、测试运行都依赖这些生成的文件
4. **自动化流程**：`pre*` 钩子确保在对应命令执行前，翻译文件已就绪

**执行顺序示例：**

```bash
pnpm run build
# 自动执行：
# 1. prebuild: lit-localize build (生成翻译文件)
# 2. build: rm -rf dist && vite build && tsc --emitDeclarationOnly
```

**为什么不能合并为一个脚本？**

- `lit-localize build` 需要单独运行，因为它是独立的工具链
- `pre*` 钩子是 npm/pnpm 的标准机制，确保依赖文件在命令执行前生成
- 分离的脚本提供更清晰的错误定位（翻译错误 vs 构建错误）

**开发时的注意事项：**

- 如果修改了翻译文件（`xliff/*.xlf`），需要重新运行 `lit-localize build`
- 如果 `src/generated/` 目录丢失，运行任意 `pre*` 命令即可恢复
- 通常不需要手动运行 `lit-localize build`，`pre*` 钩子会自动处理

---

## License

[MIT](../../LICENSE)
