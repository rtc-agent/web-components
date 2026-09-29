# @rtc-agent/component

基于 Lit 的 Web Component 组件库，提供浮窗式 RTC Agent 交互界面。

## 快速开始

### 安装

```bash
pnpm add @rtc-agent/component
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

完整 API 文档见 [API.md](./API.md)，更多示例见 [EXAMPLES.md](./EXAMPLES.md)。

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

## 导出

### 组件

- `<rtc-agent>` — 根组件（唯一公开注册的 custom element）
  - 所有子组件均通过 side-effect 导入，在根组件 shadow DOM 内使用

### 类

- `RtcAgent` — 根组件 class，可直接 import 用于类型标注

```ts
import { RtcAgent } from '@rtc-agent/component';
const agent = document.querySelector<RtcAgent>('rtc-agent')!;
```

### 工厂函数

- `createRtcAgent` — 声明式创建 `<rtc-agent>` 实例

```ts
import { createRtcAgent } from '@rtc-agent/component';
const agent = createRtcAgent({ /* ... */ });
```

详细配置见 [API.md](./API.md)。

## 用法

### 工厂函数（推荐）

```ts
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  workerUrl: '/rtc-agent/shared-worker.js',
  auth: {
    getToken: () => localStorage.getItem('token'),
    refreshToken: async () => {
      const res = await fetch('/api/refresh');
      const data = await res.json();
      return { accessToken: data.token };
    },
    userId: 'user-123',
  },
  on: {
    ready: () => console.log('RTC Agent ready'),
    themeChange: ({ theme }) => console.log('Theme:', theme),
    toolCallStart: ({ path, params }) => console.log('Tool call:', path),
  },
});

document.body.appendChild(agent);

// 不再需要时销毁
agent.destroy();
```

### HTML 元素

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

### 架构

RTC Agent 使用 SharedWorker + Comlink 架构实现多 Tab 共享：

- 单 WebSocket 连接（SharedWorker 内）
- 共享 IndexedDB 存储
- Master Tab 选举（Web Locks API）

详细配置见 [SharedWorker 配置指南](./SHARED-WORKER-SETUP.md)。

### 公开属性

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 主题 |
| `app-label` | `string` | `'RTC Agent'` | 标题栏 / 气泡 tooltip 文本 |
| `bubble-icon` | `string` | `''` | 最小化气泡内的 SVG / HTML |
| `logo` | `{ light?: string; dark?: string } \| null` | `null` | 自定义 Logo（light/dark 两套） |
| `worker-url` | `string` | `''` | SharedWorker 文件 URL |
| `scenarios-url` | `string` | `''` | Scenario 文档 URL |
| `agentConfig` | `AgentConfig \| null` | `null` | 声明式函数注册 |
| `registry` | `FunctionRegistry \| null` | `null` | 命令式函数注册（高级） |

### 公开事件

所有公开事件遵循 `rtc-<event>` 命名模式：

**生命周期事件：**

- `rtc-agent-ready` — 组件就绪
- `rtc-before-destroy` — 组件即将销毁
- `rtc-theme-change` — 主题变化

**消息拦截事件：**

- `rtc-before-message-send` — 消息发送前（可取消或修改）

**工具调用事件（EventBus 桥接，通过 `on` 配置注册）：**

- `toolCallStart` — 工具调用开始
- `toolCallSuccess` — 工具调用成功
- `toolCallError` — 工具调用失败
- `toolCallProgress` — 工具调用进度

**会话和消息事件：**

- `rtc-session-created` / `rtc-session-switched` / `rtc-session-renamed` / `rtc-session-deleted`
- `rtc-message-sent` / `rtc-message-received`

**认证事件：**

- `rtc-auth-login-requested` / `rtc-auth-login` / `rtc-auth-refresh-failed` / `rtc-auth-logout`

### 控制器访问

```ts
agent.authController.login();
agent.authController.logout();
agent.sessionController.actions.switchSession(id);
agent.messageController.actions.sendMessage(content);
agent.skillController.actions.setRegistry(registry);
```

## 代码高亮

消息中的代码块使用 highlight.js 进行语法高亮。为控制包体积，组件按需注册了 15 种常用语言（含别名）：

| 类别 | 语言 | 别名 |
| --- | --- | --- |
| Web 开发 | JavaScript, TypeScript, XML, CSS, JSON | `js`, `ts`, `html`, `yml` |
| 后端/系统 | Python, Go, Bash, YAML, SQL | `py`, `golang`, `sh`, `shell` |
| 配置/标记 | Markdown, Diff, Plaintext | `md`, `text` |

未注册的语言将回退到无高亮纯文本渲染。如需扩展支持的语言，可在宿主应用中通过 `hljs.registerLanguage()` 注册额外语言包（需自行引入 highlight.js）。

## 稳定性与已知问题

### v0.2.7-rc.3 稳定性改进

本次发布包含多项稳定性和数据一致性修复：

**Worker 连接稳定性**：

- 开发模式下使用带时间戳的 Worker 名称（`rtc-agent-worker-dev-{timestamp}`），避免连接到调试会话残留的 stale Worker
- 改进 Worker 验证超时错误信息，提供清晰的 `chrome://inspect/#workers` 手动清理指引
- 动态模块加载（DOMPurify、highlight.js）增加自动重试机制（2 次尝试），处理 chunk hash 过期问题

**数据一致性保护**：

- VirtualFS 读-改-写操作包装在事务中，防止并发写入导致数据损坏
- `handleEditorSave` 增加 per-file 并发锁，防止 Ctrl+S 与自动-save 并行写入时旧内容覆盖新内容
- `flushGapFillBuffer` 延迟 offset 推进，确保数据持久化成功后才移动游标，防止永久数据丢失

**React StrictMode 兼容**：

- 修复 `connectedCallback → disconnectedCallback → connectedCallback` 生命周期竞态
- `RtcProcessor` 增加 `cancel()` 方法，支持组件卸载时优雅关闭 RTC 循环
- Master Tab 切换时立即退出处理循环，防止与新 Master 并发执行

**UI 与事件系统**：

- 提取 `EventBindingController`，集中管理 30+ DOM 事件监听器
- 验证错误消息翻译为英文，与 Agent 提示语言保持一致

### 开发环境注意事项

**SharedWorker 残留问题**：

如果在调试过程中遇到无限递归或其他严重错误导致 Tab 强制终止，SharedWorker 可能处于不一致状态。解决方法：

1. 访问 `chrome://inspect/#workers`
2. 终止名为 `rtc-agent-worker` 的 SharedWorker 实例
3. 刷新页面

开发模式下会自动避免此问题（每次加载创建新的 Worker 实例）。

**动态模块加载失败**：

组件库热重载后，如果遇到 "Failed to fetch dynamically imported module" 错误，组件会自动重试 2 次。如果仍然失败，清除浏览器缓存并重启开发服务器。

详细故障排除指南见 [SharedWorker 配置指南](./SHARED-WORKER-SETUP.md#故障排除)。

## License

[MIT](../../LICENSE)
