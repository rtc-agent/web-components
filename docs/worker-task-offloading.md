# Worker Task Offloading Architecture

## 概述

RTC Agent 使用 SharedWorker 架构来管理数据持久化和网络请求。Worker 运行在独立的线程中，通过 Comlink 与主线程通信，提供类型安全的 RPC 调用。

## 当前架构

### Worker 负责的任务

1. **数据持久化** (IndexedDB)
   - Session/Message/RTC 实体的 CRUD 操作
   - 文件缓存管理 (fileCache 表)
   - UI 更新队列 (ui_updates 表)
   - VirtualFS 文件系统元数据

2. **网络请求** (Centrifuge WebSocket)
   - 实时消息订阅和发布
   - 文件上传/下载到 S3
   - 增量同步 (gap fill)

3. **后台任务**
   - 文件同步队列管理
   - 过期缓存清理
   - 中断的 multipart 上传恢复

### 主线程负责的任务

1. **DOM 操作**
   - UI 渲染和更新
   - 用户交互处理
   - Web Component 生命周期管理

2. **数据处理**
   - JSON 序列化/反序列化
   - 数据格式转换 (UI 模型 <-> 存储模型)
   - 增量差异计算 (diff)

## 性能瓶颈分析

### 1. JSON 序列化仍在主线程

**问题**: 大型消息体的 JSON 序列化/反序列化在主线程执行，阻塞渲染。

**影响范围**:
- `sendMessage()` 中的 `JSON.stringify(content)`
- `handlePublication()` 中的 `JSON.parse()`
- VirtualFS 文件内容转换

**为什么难以迁移**:
- Comlink 本身依赖结构化克隆算法传递数据，跨 Worker 传递函数/复杂对象有限制
- 序列化后的数据仍需通过 Comlink 传递，收益有限
- 需要重构大量现有 API 签名

**建议优化方案**:
```typescript
// 方案 A: 使用 Transferable Objects 减少拷贝
const buffer = new TextEncoder().encode(jsonString).buffer;
worker.postMessage(buffer, [buffer]);

// 方案 B: 在 Worker 中创建序列化辅助函数
// worker-core.ts
async serializeInWorker(data: unknown): Promise<ArrayBuffer> {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(json).buffer;
}
```

### 2. DOM 操作无法迁移

**问题**: Lit 组件的渲染必须在主线程执行，无法迁移到 Worker。

**影响范围**:
- `rtc-session-tree` 虚拟滚动渲染
- `rtc-message-list` 消息列表渲染
- 用户交互事件处理

**为什么无法迁移**:
- DOM API 仅在Window上下文可用
- Web Components 生命周期回调在主线程
- Shadow DOM 操作无法跨线程

**建议优化方案** (已在实施):
```typescript
// 1. 虚拟滚动 (已实现)
// 只渲染可见区域的 DOM 节点，减少主线程渲染压力

// 2. LRU 缓存 (已实现)  
// 缓存计算结果，避免重复计算

// 3. 批量更新 (已实现)
// UIUpdateBus 批量合并多个更新事件，减少渲染次数
```

### 3. 大数据量传输

**问题**: 大量文件数据在主线程和 Worker 之间传递时产生拷贝开销。

**影响范围**:
- 文件上传/下载时的 Blob 传递
- 批量文件操作时的数据序列化

**建议优化方案**:
```typescript
// 使用 Transferable Objects 传递 ArrayBuffer
const buffer = await blob.arrayBuffer();
await worker.uploadFile(md5, ext, buffer, [buffer]); // Transfer ownership
```

## 已实施的性能优化

### 1. IndexedDB 批量操作 (P2-1 新增)

在 `worker-core.ts` 的 `batchWriteFiles()` 和 `persistence/src/index.ts` 的关键路径添加了 `performance.mark()`:

```typescript
performance.mark('indexeddb-batch-start');
await db.transaction('rw', db.fileSystemEntries, async () => {
  // 批量写入逻辑
});
performance.mark('indexeddb-batch-end');
performance.measure('indexeddb-batch', 'indexeddb-batch-start', 'indexeddb-batch-end');
```

**监控指标**:
- IndexedDB 事务执行时间
- 批量操作的文件数量
- 慢操作阈值 (>100ms 记录警告)

### 2. WebSocket 消息处理延迟监控 (P2-1 新增)

在 `worker-core.ts` 的 `broadcastUIUpdate()` 添加性能监控:

```typescript
performance.mark('broadcast-start');
// 广播逻辑
performance.mark('broadcast-end');
performance.measure('broadcast-ui-update', 'broadcast-start', 'broadcast-end');

// 记录超过帧预算 (>16ms) 的慢广播
if (broadcastMeasure.duration > 16) {
  log.debug(`Slow broadcast: ${duration}ms for ${count} callbacks`);
}
```

**监控指标**:
- 消息广播延迟
- 回调处理时间分布
- 慢回调 (>16ms 帧预算) 检测

### 3. 虚拟滚动 FPS 监控 (建议)

虽然尚未实现，但建议在 `rtc-session-tree` 组件中添加 FPS 监控:

```typescript
// 在滚动处理中添加性能监控
let lastFrameTime = performance.now();
let frameCount = 0;

function onScroll() {
  const now = performance.now();
  const delta = now - lastFrameTime;
  
  if (delta > 0) {
    const fps = 1000 / delta;
    frameCount++;
    
    // 每秒报告一次平均 FPS
    if (frameCount % 60 === 0) {
      performance.mark('virtual-scroll-fps');
      console.debug(`Virtual Scroll FPS: ${fps.toFixed(1)}`);
    }
  }
  
  lastFrameTime = now;
}
```

### 4. 内存使用量趋势监控 (建议)

建议定期采样 `performance.memory` (仅 Chrome 支持):

```typescript
// 每分钟采样一次内存使用情况
setInterval(() => {
  if ('memory' in performance) {
    const mem = (performance as any).memory;
    performance.mark('memory-snapshot');
    console.debug('Memory usage:', {
      used: `${(mem.usedJSHeapSize / 1048576).toFixed(2)}MB`,
      total: `${(mem.totalJSHeapSize / 1048576).toFixed(2)}MB`,
      limit: `${(mem.jsHeapSizeLimit / 1048576).toFixed(2)}MB`
    });
  }
}, 60000);
```

## 架构限制与权衡

### 为什么不完全迁移到 Worker?

1. **复杂性增加**
   - 需要重构所有 DOM 操作为消息传递模式
   - 增加代码复杂度和维护成本
   - 调试困难 (跨线程调用栈断裂)

2. **性能收益递减**
   - Comlink 序列化/反序列化本身有开销
   - 频繁的小消息传递可能比主线程执行更慢
   - Structured Clone 算法对复杂对象效率低

3. **兼容性限制**
   - 某些 Web API 仅在 Window 上下文可用 (如 localStorage)
   - 部分第三方库不兼容 Worker 环境
   - 需要 polyfill 或替代方案

### 何时考虑进一步迁移?

**适合迁移到 Worker 的场景**:
- CPU 密集型计算 (如大文件 MD5 计算)
- 大规模数据处理 (如批量 JSON 转换)
- 独立的业务逻辑 (不依赖 DOM)

**不适合迁移的场景**:
- DOM 操作和渲染
- 用户交互处理
- 需要立即访问共享状态的操作

## 未来优化方向

### 短期 (1-3 个月)

1. **添加更多性能监控点**
   - 文件上传/下载耗时
   - JSON 序列化时间
   - 虚拟滚动渲染帧率

2. **优化数据传输**
   - 使用 Transferable Objects 减少拷贝
   - 实现增量同步 (只传递变更部分)

3. **内存管理优化**
   - 实现 LRU 缓存淘汰策略
   - 定期清理过期数据

### 中期 (3-6 个月)

1. **探索 Worker 内计算**
   - 将 JSON 序列化迁移到 Worker
   - 实现 Worker 内的数据转换层

2. **优化虚拟滚动**
   - 实现更激进的虚拟化 (只渲染完全可见项)
   - 使用 Intersection Observer 减少重绘

3. **引入 Web Workers 池**
   - 多个 Worker 并行处理任务
   - 任务队列和负载均衡

### 长期 (6-12 个月)

1. **评估 WASM 可行性**
   - 对于计算密集型任务 (如加密、压缩)
   - 与 Rust/C++ 互操作

2. **SharedArrayBuffer 优化**
   - 零拷贝数据共享
   - 需要处理跨源隔离策略 (COOP/COEP)

3. **OffscreenCanvas 渲染**
   - 将部分渲染任务迁移到 Worker
   - 适用于复杂图表/可视化

## 监控最佳实践

### 1. 设置性能预算

```typescript
const PERFORMANCE_BUDGETS = {
  indexedDBTransaction: 100, // ms
  broadcastMessage: 16,      // ms (帧预算)
  jsonSerialize: 50,         // ms
  virtualScrollFrame: 16,    // ms (60 FPS)
};
```

### 2. 生产环境监控

```typescript
// 上报性能指标到分析服务
function reportPerformanceMetric(name: string, value: number) {
  if (value > PERFORMANCE_BUDGETS[name]) {
    analytics.track('performance_violation', {
      metric: name,
      value,
      budget: PERFORMANCE_BUDGETS[name],
      timestamp: Date.now()
    });
  }
}
```

### 3. 性能回归测试

```typescript
// 在 CI/CD 中添加性能基准测试
test('batchWriteFiles should complete within 100ms for 10 files', async () => {
  performance.mark('test-start');
  await batchWriteFiles(generateTestFiles(10));
  performance.mark('test-end');
  
  const measure = performance.measure('test', 'test-start', 'test-end');
  expect(measure.duration).toBeLessThan(100);
});
```

## 总结

当前 Worker 架构已经很好地平衡了性能和复杂性。主要的性能瓶颈在于主线程的 DOM 操作和 JSON 序列化，但这些要么无法迁移 (DOM)，要么迁移收益有限 (序列化)。

通过添加性能监控 (P2-1)，我们可以:
1. 量化现有优化措施的效果
2. 发现潜在的性能问题
3. 为未来的优化提供数据支持

下一步应该关注:
- 监控数据的收集和分析
- 识别性能热点并针对性优化
- 评估新优化方案的 ROI
