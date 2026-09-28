# @rtc-agent/persistence

RTC Agent 本地持久化层，基于 IndexedDB + Dexie.js。

## 功能

- **PersistenceLayer** — 对外暴露的高层 API
  - `Session` / `Message` / `Turn` / `Rtc` 实体的 CRUD
  - `VirtualFS` 虚拟文件系统（AGENT.md、Scenarios、Functions）
  - `ScriptEngine` 脚本执行（Babel 转译 + 沙箱安全）
  - `OffsetManager` 游标管理（两层缓存：内存 + IndexedDB，防止竞态）
  - `Permission` 权限模型
  - `DebugHistoryRepository` 函数调试历史（IndexedDB 持久化 + 游标分页）
- **EntityRepository** — 实体 CRUD 与同步状态管理
  - 所有 upsert 方法均使用 Dexie 事务保护，确保读-改-写原子性
  - 批量处理（`applyUpdates`）：在单个事务中 bulkGet → merge → bulkPut，50-400x 性能提升
  - `streaming_status` 单调守卫：已完成的消息不会回退到流式状态
  - Turn 计数写回：写 Turn 后自动更新 Session 的 `pending_turn_count` / `running_turn_count`，并通过 UIUpdateBus 发出事件
- **UIUpdateBus** — 持久化层变更通知总线，驱动 UI 刷新
  - 字段级 diff（基于 microdiff），精确通知 UI 更新
  - 支持 suspend/resume 批量操作，防止 UI 抖动
  - 异步 listener 顺序队列，防止并发竞态
  - 安全超时（30s 强制 resume）
- **RtcProcessor** — RTC 循环处理器（处理待执行的 tool call、script 等）
  - 串行处理，防止重入
  - 支持 Master Tab 切换检测（多 Tab 场景）
  - 优雅关闭（`cancel()`）

## 数据库 Schema

当前版本 v10，包含以下表：

|表|主键|用途|
|---|---|---|
|`sessions`|`client_id`|会话（含 `pending_turn_count` / `running_turn_count`）|
|`turns`|`client_id`|对话轮次|
|`messages`|`client_id`|消息（含 `streaming_status` 单调守卫）|
|`rtcs`|`client_id`|Remote Tool Calling（含 `session_device_id` 冗余字段）|
|`offsets`|`channel`|流式消息游标（OffsetManager 两层缓存）|
|`fileSystemEntries`|`path`|虚拟文件系统文件|
|`debugHistory`|`id`|函数调试历史（含 `[function_name+timestamp]` 复合索引）|

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
const layer = createPersistenceLayer({
  client: {
    endpoint: 'wss://example.com/connection',
    getToken: () => 'token',
    userId: 'user-id',
  },
  databaseName: 'rtc-agent',  // 可选，默认 'rtc-agent-{prefix}'
  deviceId: 'device-id',      // 用于 RTC 执行时设备过滤
});
await layer.connect();
```

### `PersistenceLayer.close()`

优雅关闭：等待所有活跃同步任务完成（最多 5 秒超时），然后断开连接并关闭数据库。

```ts
await layer.close();
```

### Debug History

```ts
// 添加调试历史
await layer.addDebugHistoryItem({
  id: crypto.randomUUID(),
  functionName: 'user.register',
  params: '{"name":"test"}',
  success: true,
  durationMs: 150,
  timestamp: Date.now(),
  logs: [],
});

// 游标分页查询
const result = await layer.queryDebugHistory('user.register', cursor, 20);
// result: { items: DebugHistoryItem[], nextCursor?: string, total: number }

// 统计 / 清除
const count = await layer.countDebugHistory();
await layer.clearDebugHistory();
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
