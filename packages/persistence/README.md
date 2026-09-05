# @rtc-agent/persistence

RTC Agent 本地持久化层，基于 IndexedDB + Dexie.js。

## 功能

- **PersistenceLayer** — 对外暴露的高层 API
  - `Session` / `Message` / `Turn` / `Rtc` 实体的 CRUD
  - `VirtualFS` 虚拟文件系统（AGENT.md、Scenarios、Functions）
  - `ScriptEngine` 脚本执行（Babel 转译）
  - `OffsetManager` 游标管理（流式消息）
  - `Permission` 权限模型
- **UIUpdateBus** — 持久化层变更通知总线，驱动 UI 刷新
- **RtcProcessor** — RTC 循环处理器（处理待执行的 tool call、script 等）

## 导出

```ts
import {
  createPersistenceLayer,
  PersistenceLayer,
  virtualFS,
  getUIUpdateBus,
  RtcProcessor,
  initializeVirtualFS,
} from '@rtc-agent/persistence';
```

### `createPersistenceLayer`

```ts
const layer = createPersistenceLayer({ client, deviceId, userId });
await layer.connect();
await layer.createSession({ title: 'New chat' });
```

### VirtualFS

```ts
import { virtualFS } from '@rtc-agent/persistence';

await virtualFS.write('/AGENT.md', '# Agent', 'overwrite', { name: 'AGENT' });
const content = await virtualFS.read('/AGENT.md');
const scenarios = await virtualFS.queryByType('scenario');
```

## License

[MIT](../../LICENSE)
