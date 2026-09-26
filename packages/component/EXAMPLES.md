# createRtcAgent 使用示例

## 示例 1: 基础使用

最简单的集成方式，只需提供服务端 URL。

```ts
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
});

document.body.appendChild(agent);

// 不再需要时销毁
agent.destroy();
```

## 示例 2: 静态 Token 认证

适用于后端提供长期 token 的场景（如开发环境、内部工具）。

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  auth: {
    accessToken: 'eyJhbGc...',
    refreshToken: 'optional-refresh-token',
    userId: 'user-123',
    expiresIn: 3600,
  },
});

document.body.appendChild(agent);
```

## 示例 3: 动态 Token 认证（推荐）

Token 过期时自动调用 `refreshToken` 回调刷新，适合生产环境。

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  auth: {
    getToken: () => localStorage.getItem('access_token') ?? '',
    refreshToken: async () => {
      const response = await fetch('/api/auth/refresh', { method: 'POST' });
      const data = await response.json();
      localStorage.setItem('access_token', data.accessToken);
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

## 示例 4: 完整 AuthProvider

适用于多租户或复杂认证流程。

```ts
import { createRtcAgent } from '@rtc-agent/component';
import { myAuthProvider } from './auth';

const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  auth: {
    getToken: () => myAuthProvider.getAccessToken(),
    refreshToken: () => myAuthProvider.refreshAccessToken(),
    isLoggedIn: () => myAuthProvider.isAuthenticated(),
    logout: () => myAuthProvider.signOut(),
  },
});

document.body.appendChild(agent);
```

## 示例 5: 监听事件

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  on: {
    ready: () => {
      console.log('Agent is ready!');
    },
    sessionCreated: ({ session }) => {
      console.log('New session:', session.title);
    },
    messageReceived: ({ message }) => {
      console.log('Received:', message.content);
    },
    messageSent: ({ message }) => {
      console.log('Sent:', message.content);
    },
    connectionStateChange: ({ state }) => {
      console.log('Connection state:', state);
    },
  },
});

document.body.appendChild(agent);
```

## 示例 6: 拦截消息发送

在消息发送前做校验、过滤或修改。

```ts
const FORBIDDEN_WORDS = ['spam', 'abuse'];

const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  on: {
    beforeMessageSend: ({ message }) => {
      // 过滤敏感词
      if (FORBIDDEN_WORDS.some(w => message.content.includes(w))) {
        return false; // 取消发送
      }

      // 就地修改（如去除首尾空白）
      message.content = message.content.trim();
      return true; // 继续发送
    },
  },
});

document.body.appendChild(agent);
```

### 异步拦截

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  on: {
    beforeMessageSend: async ({ message }) => {
      const ok = await fetch('/api/validate', {
        method: 'POST',
        body: JSON.stringify({ content: message.content }),
      }).then(r => r.json()).then(d => d.valid);
      return ok;
    },
  },
});

document.body.appendChild(agent);
```

## 示例 7: 监听工具调用

```ts
const agent = createRtcAgent({
  appLabel: 'My Assistant',
  server: { url: 'https://api.example.com' },
  on: {
    toolCallStart: ({ path, params }) => {
      console.log('Tool call started:', path, params);
    },
    toolCallSuccess: ({ path, result }) => {
      console.log('Tool call succeeded:', path, result);
    },
    toolCallError: ({ path, error }) => {
      console.error('Tool call failed:', path, error.message);
    },
    toolCallProgress: ({ path, progress }) => {
      console.log(`Progress: ${path} ${progress}%`);
    },
  },
});

document.body.appendChild(agent);
```

## 示例 8: 注册 Agent 函数

让 AI 能调用宿主应用提供的工具函数。

```ts
const agent = createRtcAgent({
  appLabel: 'Code Editor',
  server: { url: 'https://api.example.com' },
  persona: 'You are a helpful coding assistant.',
  groups: [
    {
      name: 'editor',
      description: 'Code editor operations',
      functions: [
        {
          name: 'getCode',
          description: 'Get the current code in the editor',
          handler: () => editorAPI.getCode(),
        },
        {
          name: 'setCode',
          description: 'Set code in the editor',
          handler: ({ code }) => editorAPI.setCode(code as string),
        },
      ],
    },
  ],
});

document.body.appendChild(agent);
```

## 示例 9: 嵌入模式（Embedded）

将组件嵌入页面布局，禁用拖拽和窗口控制。

```ts
const agent = createRtcAgent({
  appLabel: 'Embedded Assistant',
  server: { url: 'https://api.example.com' },
  window: {
    embedded: true,  // 等同于 maximized + 禁用所有交互
  },
});

// 挂载到指定容器
document.getElementById('agent-container')!.appendChild(agent);
```

## 示例 10: 完整配置

展示所有配置项的综合使用。

```ts
import { createRtcAgent } from '@rtc-agent/component';
import type { RtcAgentConfig } from '@rtc-agent/component';

const config: RtcAgentConfig = {
  // 基础属性
  appLabel: 'Full Assistant',
  theme: 'dark',
  lang: 'en-US',

  // 服务端
  server: {
    url: 'https://api.example.com',
    redirectUri: 'https://example.com/callback',
  },

  // 数据库
  databaseName: 'my-app',

  // 场景文档
  scenariosUrl: '/scenarios',

  // 窗口
  window: {
    defaultMode: 'normal',
    initialSize: { width: 500, height: 700 },
    embedded: false,
  },

  // Activity Bar
  activityBar: {
    disabledActivities: ['settings'],
    defaultActivity: 'chat',
  },

  // Agent
  agentName: 'FullAssistant',
  agentDescription: 'A full-featured AI assistant',
  persona: 'You are a helpful AI assistant.',
  groups: [
    {
      name: 'utils',
      description: 'Utility functions',
      functions: [
        {
          name: 'getCurrentTime',
          description: 'Get current date and time',
          handler: () => new Date().toISOString(),
        },
      ],
    },
  ],

  // 认证
  auth: {
    getToken: () => authService.getLatestToken(),
    refreshToken: () => authService.refresh(),
    userId: authService.getUserId(),
  },

  // 事件
  on: {
    ready: () => console.log('Ready'),
    sessionCreated: ({ session }) => console.log('Session:', session.title),
    messageReceived: ({ message }) => console.log('Msg:', message.content),
    toolCallStart: ({ path }) => console.log('Tool:', path),
    beforeMessageSend: ({ message }) => {
      message.content = message.content.trim();
      return true;
    },
  },
};

const agent = createRtcAgent(config);
document.body.appendChild(agent);
```
