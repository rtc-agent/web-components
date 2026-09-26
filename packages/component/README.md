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

详细设计见 [docs/shared-worker-proposal.md](../../docs/shared-worker-proposal.md)。

### 公开属性

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 主题 |
| `app-label` | `string` | `'RTC Agent'` | 标题栏 / 气泡 tooltip 文本 |
| `bubble-icon` | `string` | `''` | 最小化气泡内的 SVG / HTML |
| `scenarios-url` | `string` | `''` | Scenario 文档 URL |
| `agentConfig` | `AgentConfig \| null` | `null` | 声明式函数注册 |
| `registry` | `FunctionRegistry \| null` | `null` | 命令式函数注册（高级） |

### 公开事件

所有公开事件遵循 `rtc-agent-<event>` 命名模式：

**生命周期事件：**

- `rtc-agent-ready` — 组件就绪
- `rtc-agent-beforeDestroy` — 组件即将销毁
- `rtc-agent-themeChange` — 主题变化

**消息拦截事件：**

- `rtc-agent-beforeMessageSend` — 消息发送前（可取消或修改）

**工具调用事件：**

- `rtc-agent-toolCallStart` — 工具调用开始
- `rtc-agent-toolCallSuccess` — 工具调用成功
- `rtc-agent-toolCallError` — 工具调用失败
- `rtc-agent-toolCallProgress` — 工具调用进度

**会话和消息事件：**

- `rtc-session-created` / `rtc-session-switched`
- `rtc-message-sent`

**认证事件：**

- `rtc-auth-login-requested`

### 控制器访问

```ts
agent.authController.login();
agent.authController.logout();
agent.sessionController.actions.switchSession(id);
agent.messageController.actions.sendMessage(content);
agent.skillController.actions.setRegistry(registry);
```

## License

[MIT](../../LICENSE)
