# @rtc-agent/worker

SharedWorker 包：让多个 RTC Agent Tab 共享同一条 Centrifuge WebSocket 和同一个 IndexedDB。

## 架构

```
Tab A  ──┐
Tab B  ──┼──►  SharedWorker (@rtc-agent/worker)
Tab C  ──┘        │
                  ├─ RTCAgentClient (Centrifuge WebSocket)
                  ├─ PersistenceLayer (Dexie / IndexedDB)
                  ├─ UIUpdateBus（广播给所有连入的 Tab）
                  └─ ToolRegistry / VirtualFS / ScriptEngine
```

## 暴露方式

SharedWorker 入口：`@rtc-agent/worker/shared-worker`

```ts
import { wrap } from 'comlink';
import type { WorkerPersistenceCore } from '@rtc-agent/worker';

const worker = new SharedWorker(new URL('@rtc-agent/worker/shared-worker', import.meta.url));
const core = wrap<WorkerPersistenceCore>(worker.port);
worker.port.start();

await core.init(config, { onUIUpdate, requestToken });
```

## 设计原则

- **Worker 是被动服务方**：不知道也不关心谁是 Master Tab
- **多 port 广播**：每个连入的 Tab 注册自己的 `onUIUpdate` 回调，Worker 收到更新时遍历广播
- **Comlink 透明化**：主线程看到的 `core` 与 Worker 内的 `core` 接口一致

## 阶段

| 阶段 | 内容 |
| --- | --- |
| Phase 1 | 包骨架 + Core + 多 port 广播（本包） |
| Phase 2 | 主线程 Comlink 桥接 + Token 桥接 + Feature flag |
| Phase 3 | Master 选举（Web Locks） |
