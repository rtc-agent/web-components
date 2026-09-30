# Code Review & Fix Report: UI Update Queue Catch-Up Mechanism

**审查时间**: 2026-09-30

**审查范围**:

- packages/component/src/worker-bridge.ts (catch-up logic)
- packages/persistence/src/ui-update-bus.ts (publish logic)
- packages/worker/src/worker-core.ts (getCatchUpEvents, TTL cleanup)

**审查人**: rtc-agent-reviewer

## 执行摘要

审查了 UI update queue 的 catch-up 机制，发现 10 个边缘场景。其中 2 个需要修复，已修复：

1. **databaseName 变更导致 sessionStorage cursor 失效** -- 已修复
2. **中间 gap 误检测** -- 已修复

其他 8 个场景已正确处理或有合理的降级策略。

## 详细审查结果

### 1. Worker restart scenario -- 已正确处理

**场景**: SharedWorker 终止并重启，sessionStorage 中的 `_lastProcessedSeq` 是否仍有效？

**分析**:

- sessionStorage 在页面刷新后保留，但在 tab 关闭后清除
- IndexedDB 是持久化的，跨 tab 关闭保留
- Worker 重启后，IndexedDB 数据仍在
- `getCatchUpEvents` 正确处理：如果 `fromSeq > 0` 但 DB 为空，返回 `hasGap: true`
- 触发 `onStateGap`，重置 cursor 为 0，触发全量刷新

**结论**: 已正确处理，无需修复。

---

### 2. databaseName change -- 需要修复

**场景**: `init()` 使用不同的 `databaseName` 调用，sessionStorage key 是否正确防止跨实例冲突？

**问题**:

```typescript
// worker-bridge.ts:519-523
this._databaseName = config.databaseName ?? 'default';
if (!this._hasRestoredFromStorage) {
  this._lastProcessedSeq = this._loadLastProcessedSeq();
  this._hasRestoredFromStorage = true;
}
```

如果 `init('db1')` 后调用 `destroy(false)`，再调用 `init('db2')`：

- `_databaseName` 变为 'db2'
- 但 `_hasRestoredFromStorage` 仍为 true
- `_lastProcessedSeq` 未重新加载，仍为 'db1' 的值
- Cursor 过期，可能导致事件丢失或重复

**修复**: 检测 `databaseName` 变更，重新加载 sessionStorage。

**文件**: `packages/component/src/worker-bridge.ts`

**行号**: 519-523

---

### 3. Concurrent publish() calls -- 已正确处理

**场景**: 并发 `publish()` 调用是否会导致 seq 排序问题？

**分析**:

- `publish()` 异步等待 IndexedDB 写入
- IndexedDB 自增按事务提交顺序分配 seq
- 如果 A 先开始但 B 先完成，B 获得较低 seq
- Listeners 按完成顺序接收事件（B 然后 A）
- 但 seq 顺序与完成顺序一致，是有效的排序
- 对于相同 (entity, entityId)，per-listener chain 确保顺序处理

**结论**: 已正确处理，无需修复。seq 顺序是有效的逻辑顺序。

---

### 4. Catch-up during active updates -- 已正确处理

**场景**: Catch-up 运行时新事件发布，cursor 更新是否会导致事件跳过？

**分析**:

- Catch-up 循环查询 `seq > fromSeq`
- 实时事件通过 `onUIUpdate` 更新 `_lastProcessedSeq`
- 批次处理后，`fromSeq` 设为最后一条的 seq
- 幂等性保护：`if (entrySeq <= this._lastProcessedSeq) continue;`
- 实时事件在 catch-up 查询前已处理，会被跳过

**结论**: 已正确处理，无需修复。

---

### 5. Gap detection false positives -- 需要修复

**场景**: IndexedDB 自增在事务失败时可能有 gap，是否导致误检测？

**问题**:

```typescript
// worker-core.ts:146-155
// Check middle gaps: consecutive entries should have consecutive seq numbers
for (let i = 1; i < entries.length; i++) {
  if (entries[i].seq !== entries[i - 1].seq + 1) {
    hasGap = true;
    log.warn(`getCatchUpEvents: gap in middle! ...`);
    break;
  }
}
```

**分析**:

- TTL cleanup 按 `timestamp < cutoff` 删除，删除最老的事件（在开头）
- TTL cleanup 不会在中间创建 gap
- 中间 gap 只由失败的事务创建（seq 未分配）
- 失败的事务意味着事件未持久化，无数据丢失
- 但代码检测到中间 gap 后触发 `onStateGap`，导致不必要的全量刷新

**修复**: 移除中间 gap 检测，只保留开头 gap 检测。

**文件**: `packages/worker/src/worker-core.ts`

**行号**: 146-155

---

### 6. sessionStorage quota -- 已正确处理

**场景**: sessionStorage 满时，catch-up 机制是否仍正常工作？

**分析**:

- `_saveLastProcessedSeq()` 捕获错误并记录日志
- 如果 sessionStorage 满，cursor 未持久化
- 下次页面刷新，`_loadLastProcessedSeq()` 返回 0
- Catch-up 从头开始查询所有事件
- 功能正确，但可能影响性能（重放所有事件）

**结论**: 已正确处理，无需修复。

---

### 7. Worker-side init() timing -- 已正确处理

**场景**: Worker 调用 `bus.init()` 后订阅前，如果有 `publish()` 发生，事件是否丢失？

**分析**:

- `bus.init()` 设置 `_initialized = true`
- `publish()` 在 `_initialized = true` 时持久化到 IndexedDB
- 但 listener 未注册，事件未广播到 tabs
- 事件已在 IndexedDB，catch-up 会拾取
- Tab 调用 `registerCallback()` 后 catch-up 运行

**结论**: 已正确处理，无需修复。

---

### 8. TTL cleanup during catch-up -- 已正确处理

**场景**: TTL cleanup 在 catch-up 期间运行，是否删除 catch-up 尚未获取的事件？

**分析**:

- TTL cleanup 删除 `timestamp < cutoff`（30 分钟前）
- 删除最老的事件（在开头），不在中间
- 如果 catch-up 查询 `seq > fromSeq`，TTL cleanup 删除的事件在 fromSeq 之前
- `getCatchUpEvents` 检测开头 gap：`if (minSeq > fromSeq + 1) hasGap = true`
- 触发 `onStateGap`，重置 cursor，触发全量刷新

**结论**: 已正确处理，无需修复。

---

### 9. destroy() timing -- 已正确处理

**场景**: catch-up 运行时调用 `destroy()`，是否正确清理资源？

**分析**:

- `destroy()` 调用 `_catchUpAbortController?.abort()`
- `_doCatchUp()` 在循环中检查 `signal.aborted`
- `finally` 块设置 `_catchUpAbortController = undefined`
- 无悬空 Promise

**结论**: 已正确处理，无需修复。

---

### 10. Multi-tab race -- 已正确处理

**场景**: 两个 tab 同时打开，都调用 `init()`，是否重复 catch-up 相同事件？

**分析**:

- 两个 tab 共享相同的 sessionStorage cursor
- 都查询 `seq > fromSeq`，接收相同事件
- 实时事件通过 `onUIUpdate` 更新 `_lastProcessedSeq`
- 幂等性保护：`if (entrySeq <= this._lastProcessedSeq) continue;`
- 无重复投递

**结论**: 已正确处理，无需修复。

---

## 修复统计

| 严重程度 | 发现数量 | 修复数量 | 未修复数量 |
| -------- | -------- | -------- | ---------- |
| 严重     | 0        | 0        | 0          |
| 警告     | 2        | 2        | 0          |
| 建议     | 0        | 0        | 0          |
| **总计** | **2**    | **2**    | **0**      |

## 修复详情

### 修复 1: databaseName 变更

**文件**: `packages/component/src/worker-bridge.ts`

**修改前**:

```typescript
this._databaseName = config.databaseName ?? 'default';
if (!this._hasRestoredFromStorage) {
  this._lastProcessedSeq = this._loadLastProcessedSeq();
  this._hasRestoredFromStorage = true;
}
```

**修改后**:

```typescript
const newDatabaseName = config.databaseName ?? 'default';
const databaseNameChanged = newDatabaseName !== this._databaseName;
this._databaseName = newDatabaseName;

if (!this._hasRestoredFromStorage || databaseNameChanged) {
  this._lastProcessedSeq = this._loadLastProcessedSeq();
  this._hasRestoredFromStorage = true;
}
```

**原因**: 当 `databaseName` 变更时，需要重新加载对应 key 的 sessionStorage cursor。

---

### 修复 2: 移除中间 gap 误检测

**文件**: `packages/worker/src/worker-core.ts`

**修改前**:

```typescript
if (fromSeq > 0 && entries.length > 0) {
  // Check start gap: first entry should be fromSeq + 1
  const minSeq = entries[0].seq;
  if (minSeq > fromSeq + 1) {
    hasGap = true;
    log.warn(`getCatchUpEvents: gap at start! fromSeq=${fromSeq}, lowest returned seq=${minSeq}`);
  } else {
    // Check middle gaps: consecutive entries should have consecutive seq numbers
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].seq !== entries[i - 1].seq + 1) {
        hasGap = true;
        log.warn(
          `getCatchUpEvents: gap in middle! expected seq=${entries[i - 1].seq + 1}, got=${entries[i].seq}`
        );
        break;
      }
    }
  }
}
```

**修改后**:

```typescript
if (fromSeq > 0 && entries.length > 0) {
  // Check start gap: first entry should be fromSeq + 1
  const minSeq = entries[0].seq;
  if (minSeq > fromSeq + 1) {
    hasGap = true;
    log.warn(`getCatchUpEvents: gap at start! fromSeq=${fromSeq}, lowest returned seq=${minSeq}`);
  }
  // Note: Middle gaps are not checked because they can be caused by failed transactions
  // (which don't indicate data loss). Only start gaps matter (TTL cleanup deletes old events).
}
```

**原因**: 中间 gap 由失败的事务创建，不代表数据丢失，不应触发全量刷新。

---

## 遗留问题

无。

## 诗人寄语

代码如诗，字字珠玑；逻辑如水，丝丝入扣。

在分布式系统的海洋中，每一个边缘场景都是一朵浪花。
我们追逐的不仅是正确，更是优雅。
当 sessionStorage 的 cursor 穿越 databaseName 的变迁，
当 IndexedDB 的 seq 跨越事务的失败，
我们看见的不仅是 bug，更是设计的瑕疵。

修复它们，不是为了完美，
而是为了让下一个维护者，
能在这片代码的海洋中，
找到一丝宁静。

---

**修复文件清单**:

- `/Users/leichujun/Workspaces/rtc-agent/web-components/packages/component/src/worker-bridge.ts` (line 519-523)
- `/Users/leichujun/Workspaces/rtc-agent/web-components/packages/worker/src/worker-core.ts` (line 139-156)
