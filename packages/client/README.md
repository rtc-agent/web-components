# @rtc-agent/client

RTC Agent 通信层：Centrifuge WebSocket 连接、RPC 调用、实时订阅、流式消息。

## 功能

- `RTCAgentClient` — Centrifuge 客户端封装
  - 连接生命周期（connect / disconnect / reconnect）
  - RPC 调用（typed）
  - 频道订阅（session / message / turn / rtc）
  - 流式响应聚合
  - 连接状态事件
- `TokenExpiredAction` 回调：access token 过期时由组件层决定 refresh / relogin

## 导出

```ts
import { RTCAgentClient } from '@rtc-agent/client';
import type {
  ConnectionState,
  TokenExpiredAction,
  // ...
} from '@rtc-agent/client';
```

### `RTCAgentClient` 构造

```ts
const client = new RTCAgentClient({
  endpoint: 'ws://localhost:8888/connection/websocket',
  getToken: async () => localStorage.getItem('access_token')!,
  onTokenExpired: async () => 'refresh', // or 'relogin'
});

await client.connect();
const sessions = await client.rpc.sessionList({});
```

## License

[MIT](../../LICENSE)
