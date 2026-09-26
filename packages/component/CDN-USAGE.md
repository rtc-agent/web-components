# CDN 使用指南

本文档介绍如何通过 CDN 引入 RTC Agent 组件并在纯 HTML 环境中使用。

## 快速开始

### 1. 通过 CDN 引入

```html
<script type="module">
  import { createRtcAgent } from 'https://cdn.example.com/@rtc-agent/component/dist/index.js';
</script>
```

**注意**：CDN 链接需要根据实际部署地址调整。如果是本地部署，可以使用相对路径或绝对路径。

### 2. 初始化组件

```html
<!DOCTYPE html>
<html>
<head>
  <title>RTC Agent CDN Example</title>
  <script type="module">
    import { createRtcAgent } from 'https://cdn.example.com/@rtc-agent/component/dist/index.js';
    
    const agent = createRtcAgent({
      appLabel: 'My Assistant',
      theme: 'dark',
      server: {
        url: 'https://api.example.com',
      },
      auth: {
        accessToken: 'your-token',
        userId: 'user-123',
      },
      on: {
        ready: () => console.log('Agent ready'),
        sessionCreated: ({ session }) => console.log('Session:', session),
      },
    });
    
    document.body.appendChild(agent);
  </script>
</head>
<body>
</body>
</html>
```

## 配置选项

`createRtcAgent` 接受一个配置对象，支持以下选项：

### 基础配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `appLabel` | `string` | `'RTC Agent'` | 应用标签，显示在标题栏 |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 主题模式 |
| `lang` | `string` | `'zh-CN'` | 语言（BCP 47 格式，如 `'en-US'`, `'zh-CN'`） |
| `bubbleIcon` | `string` | - | 最小化气泡图标（SVG 或 HTML） |

### 服务器配置

```typescript
server: {
  url: string;        // 后端服务器 URL（必填）
  redirectUri?: string; // OAuth 重定向 URI
}
```

### 认证配置

支持三种认证模式：

#### 模式 1：静态 Token（最简单）

```typescript
auth: {
  accessToken: string;    // 访问令牌
  refreshToken?: string;  // 刷新令牌（可选）
  userId: string;         // 用户 ID
  expiresIn?: number;     // 过期时间（秒，可选）
}
```

#### 模式 2：动态 Token（推荐）

```typescript
auth: {
  getToken: () => string | Promise<string>;  // 获取 token 的回调
  refreshToken?: () => Promise<{              // 刷新 token 的回调
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  userId: string;
}
```

#### 模式 3：AuthProvider（高级）

```typescript
auth: {
  getToken(): string | Promise<string>;
  refreshToken(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  isLoggedIn(): boolean;
  logout?(): Promise<void>;
}
```

### 窗口配置

```typescript
window: {
  defaultMode?: 'normal' | 'maximized' | 'minimized'; // 默认模式
  embedded?: boolean;                                    // 是否嵌入模式
  // ... 更多配置见 WindowConfig 类型定义
}
```

### 活动栏配置

```typescript
activityBar: {
  disabledActivities?: string[];  // 禁用的活动标签
  defaultActivity?: string;        // 默认活动标签
}
```

### Agent 配置

```typescript
{
  agentName?: string;         // Agent 名称
  agentDescription?: string;  // Agent 描述
  persona?: string;           // AI 人设（系统提示词）
  functions?: FunctionDef[];  // 函数列表
  groups?: AgentFunctionGroup[]; // 函数分组
}
```

## 事件回调

通过 `on` 配置注册事件监听器：

### 生命周期事件

```typescript
on: {
  ready?: () => void;              // 组件首次渲染完成
  beforeDestroy?: () => void;      // 组件即将销毁
}
```

### 连接和认证事件

```typescript
on: {
  connectionRetry?: () => void;           // 用户点击重试
  authLoginRequested?: () => void;        // 用户请求登录
  authError?: () => void;                 // 认证错误
  authLogout?: () => void;                // 用户登出
  authLogin?: (detail: { userId: string }) => void; // 登录成功
  connectionStateChange?: (detail: { 
    state: ConnectionState 
  }) => void;  // 连接状态变化
}
```

### 会话事件

```typescript
on: {
  sessionCreated?: (detail: { session: Session }) => void;    // 会话创建
  sessionSwitched?: (detail: { id: string }) => void;         // 会话切换
  sessionRenamed?: (detail: { id: string; title: string }) => void; // 会话重命名
  sessionDeleted?: (detail: { id: string }) => void;          // 会话删除
}
```

### 消息事件

```typescript
on: {
  messageReceived?: (detail: { message: Message }) => void;   // 收到消息
  messageSent?: (detail: { message: Message }) => void;       // 发送消息
  beforeMessageSend?: (detail: {
    message: { content: string; metadata?: Record<string, unknown> };
  }) => boolean | Promise<boolean>;  // 消息发送前拦截
}
```

### 工具调用事件

```typescript
on: {
  toolCallStart?: (detail: {
    path: string;      // 函数路径，如 "group/function"
    params: Record<string, unknown>;
  }) => void;
  
  toolCallSuccess?: (detail: {
    path: string;
    result: unknown;   // 返回值
  }) => void;
  
  toolCallError?: (detail: {
    path: string;
    error: Error;
  }) => void;
  
  toolCallProgress?: (detail: {
    path: string;
    progress: number;  // 进度值（通常 0-100）
  }) => void;
}
```

## 完整示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RTC Agent CDN 完整示例</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #status {
      padding: 10px;
      background: #f0f0f0;
      border-radius: 4px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <h1>RTC Agent CDN 示例</h1>
  <div id="status">正在初始化...</div>
  
  <script type="module">
    import { createRtcAgent } from 'https://cdn.example.com/@rtc-agent/component/dist/index.js';
    
    const statusEl = document.getElementById('status');
    
    // 创建 Agent 实例
    const agent = createRtcAgent({
      appLabel: 'Demo Assistant',
      theme: 'light',
      lang: 'zh-CN',
      
      // 服务器配置
      server: {
        url: 'https://api.example.com',
      },
      
      // 认证配置（动态 token）
      auth: {
        getToken: () => localStorage.getItem('access_token') || '',
        refreshToken: async () => {
          const response = await fetch('/api/refresh', { method: 'POST' });
          const data = await response.json();
          localStorage.setItem('access_token', data.accessToken);
          return {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            expiresIn: 3600,
          };
        },
        userId: 'user-123',
      },
      
      // 窗口配置
      window: {
        defaultMode: 'maximized',
        embedded: false,
      },
      
      // Agent 配置
      persona: '你是一个友好的 AI 助手。',
      
      // 事件回调
      on: {
        ready: () => {
          statusEl.textContent = 'Agent 已就绪';
          statusEl.style.background = '#d4edda';
        },
        
        authLogin: ({ userId }) => {
          console.log('用户已登录:', userId);
        },
        
        sessionCreated: ({ session }) => {
          console.log('新会话:', session.title);
        },
        
        messageReceived: ({ message }) => {
          console.log('收到消息:', message.content);
        },
        
        connectionStateChange: ({ state }) => {
          console.log('连接状态:', state);
          if (state === 'disconnected') {
            statusEl.textContent = '连接已断开';
            statusEl.style.background = '#f8d7da';
          } else if (state === 'connected') {
            statusEl.textContent = '已连接';
            statusEl.style.background = '#d4edda';
          }
        },
        
        toolCallStart: ({ path, params }) => {
          console.log('工具调用开始:', path, params);
        },
        
        toolCallError: ({ path, error }) => {
          console.error('工具调用失败:', path, error);
        },
      },
    });
    
    // 添加到 DOM
    document.body.appendChild(agent);
    
    // 暴露到全局以便调试
    window.agent = agent;
  </script>
</body>
</html>
```

## TypeScript 类型支持

虽然 CDN 使用不需要 TypeScript，但如果你使用 TypeScript 开发，可以通过以下方式获得类型提示：

```typescript
import type {
  RtcAgentConfig,
  RtcAgentWithLifecycle,
  AuthConfig,
  EventCallbacks,
  Session,
  Message,
  ConnectionState,
  WindowConfig,
  ActivityBarConfig,
} from 'https://cdn.example.com/@rtc-agent/component/dist/index.d.ts';
```

**注意**：当前版本（0.1.0）尚未生成 `.d.ts` 类型定义文件。类型支持将在后续版本中添加。

## 构建产物说明

构建后的 `dist/` 目录包含：

- `index.js` - ESM 格式入口（推荐）
- `index.umd.js` - UMD 格式（兼容旧版浏览器）
- `index-*.js` - 代码分割的 chunk 文件
- `assets/` - 静态资源（图标、字体等）
- `scenarios/` - 场景定义文件
- `sounds/` - 音效文件

**重要**：由于使用了代码分割，仅引入 `index.js` 即可，浏览器会自动加载所需的 chunk 文件。

## 注意事项

1. **ES Module 支持**：CDN 方式需要浏览器支持 ES Module（现代浏览器均支持）
2. **CORS 配置**：如果从不同域名加载，服务器需要配置 CORS
3. **路径解析**：组件内部使用相对路径加载资源，确保部署结构完整
4. **类型定义**：当前版本未生成 `.d.ts` 文件，TypeScript 类型支持需要等待后续版本

## 相关文档

- [组件开发文档](./README.md)
- [API 文档](./docs/)
- [示例代码](./examples/)
