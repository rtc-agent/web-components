# Web Components 生命周期与资源管理修复总结

**修复时间**: 2026-10-15 18:07:56  
**修复人**: rtc-agent-reviewer  
**审查报告**: ~/Workspaces/rtc-agent/.claude/reviews/review-2026-10-15-18-07-56.md

## 修复概览

本次修复针对 web-components 工程的组件生命周期与资源管理问题进行了深度优化，共修复 3 个问题（1 个 P0，2 个 P2）。

## 修复内容

### 1. [P0] PersistenceController.destroy() WorkerBridge 销毁改进

**文件**: `packages/component/src/controllers/persistence.controller.ts`, `packages/component/src/factory.ts`

**问题**: 
- `destroy()` 方法使用 fire-and-forget 模式销毁 WorkerBridge
- SharedWorker 端口和 Comlink proxy 可能无法正确释放

**修复**:
1. 将 `PersistenceController.destroy()` 从同步改为异步（`async destroy(): Promise<void>`）
2. 使用 `await workerBridge.destroy()` 替代 fire-and-forget 模式
3. 修改 `hostDisconnected()` 不再调用 `destroy()`，改由工厂显式调用
4. 更新工厂的 `destroy()` 方法，在 `element.remove()` 之前显式调用并 await `persistenceController.destroy()`

**影响**: 确保 WorkerBridge 资源完全释放，避免内存泄漏和端口占用。

### 2. [P2] _sanitizeLogo() fallback 逻辑优化

**文件**: `packages/component/src/components/rtc-agent/rtc-agent.ts`

**问题**:
- DOMPurify 失败时返回转义文本，导致 logo 显示为乱码
- 无法优雅降级到默认 logo

**修复**:
1. DOMPurify 返回空字符串时（完全恶意输入），显式返回空字符串触发默认 logo fallback
2. DOMPurify 不可用或失败时，返回空字符串而非转义文本

**影响**: Logo sanitization 失败时优雅降级到默认 logo，提升用户体验。

### 3. [P2] _tokenRequestPromise dedup 机制增强

**文件**: `packages/component/src/worker-bridge.ts`

**问题**:
- 缺乏错误后的日志记录
- Promise 重置机制的文档不够清晰

**修复**:
1. 在 catch 块中添加 `log.warn()` 记录 token 请求失败
2. 添加详细注释说明 Promise 重置机制的工作原理
3. 强调 finally 块中重置的关键作用：在 promise settle 之前执行

**影响**: 提高可观测性，确保极端情况下 token 请求能够正确重试。

## 修改文件清单

```
packages/component/src/controllers/persistence.controller.ts
packages/component/src/factory.ts
packages/component/src/worker-bridge.ts
packages/component/src/components/rtc-agent/rtc-agent.ts
```

## 提交状态

由于项目中存在预构建问题（@rtc-agent/worker 包引用了 @rtc-agent/persistence 中不存在的导出），pre-commit hook 的 typecheck 无法通过。这是与本次修复无关的预存在问题。

**建议**: 先修复 @rtc-agent/persistence 包的导出问题，或更新 @rtc-agent/worker 包的导入，然后再提交本次修复。

## 验证建议

1. 手动验证 WorkerBridge 销毁流程：
   - 调用 factory 的 `destroy()` 方法
   - 检查 SharedWorker 是否正确终止
   - 检查 Comlink proxy 是否释放

2. 验证 Logo fallback：
   - 设置无效 logo HTML
   - 检查是否显示默认 logo 而非乱码

3. 验证 token 请求重试：
   - 模拟 token 请求超时
   - 检查日志中是否有警告记录
   - 检查后续请求是否能够正常获取 token

## 技术细节

### WorkerBridge 销毁流程改进

**改进前**:
```typescript
destroy(): void {
  // ...
  void workerBridge.destroy().catch((err) => {
    log.debug('destroy: WorkerBridge.destroy() failed (non-fatal):', err);
  });
}
```

**改进后**:
```typescript
async destroy(): Promise<void> {
  // ...
  if (workerBridge) {
    try {
      await workerBridge.destroy();
    } catch (err) {
      log.debug('destroy: WorkerBridge.destroy() failed (non-fatal):', err);
    }
  }
}
```

**工厂调用改进**:
```typescript
element.destroy = async () => {
  // 1. 先显式调用并 await persistenceController.destroy()
  await element.persistenceController?.destroy?.().catch(() => {});
  
  // 2. 再从 DOM 移除（触发 disconnectedCallback）
  element.remove();
  
  // 3. 其他清理...
};
```

### Logo Sanitization Fallback 改进

**改进前**:
```typescript
catch {
  const el = document.createElement('div');
  el.textContent = html;
  return el.innerHTML; // 返回转义文本，显示为乱码
}
```

**改进后**:
```typescript
catch {
  return ''; // 返回空字符串，触发默认 logo fallback
}
```

### Token 请求日志增强

**改进**:
```typescript
catch (err) {
  log.warn(
    '[WorkerBridge] token request failed (will retry on next request):',
    err instanceof Error ? err.message : String(err),
  );
  throw err;
}
```

## 总结

本次修复提升了 web-components 的资源管理健壮性和可观测性。所有修复都遵循最小改动原则，保持与现有架构的一致性。建议尽快解决预构建问题，以便提交这些改进。
