# SharedWorker 配置指南

## 问题背景

SharedWorker 文件必须在浏览器中可访问，但当通过 NPM 导入 `@rtc-agent/component` 时，worker 文件位于 `node_modules` 内部，无法直接被浏览器加载。

## 解决方案

`@rtc-agent/component` 提供了 CLI 工具自动复制 worker 文件到宿主应用的 public 目录。

## 快速开始

### 1. 安装

```bash
pnpm add @rtc-agent/component
```

### 2. 运行 Setup 工具

```bash
npx rtc-agent-setup
```

工具会自动：
- 检测项目类型（Vite/Webpack/SvelteKit）
- 复制 SharedWorker 文件到正确位置
- 创建稳定的文件名 `shared-worker.js`
- 生成 `manifest.json` 记录版本信息

### 3. 配置 createRtcAgent

```typescript
import { createRtcAgent } from '@rtc-agent/component';

const agent = createRtcAgent({
  workerUrl: '/rtc-agent/shared-worker.js',
  // ... 其他配置
});
```

## 自动运行（推荐）

在 `package.json` 中添加 postinstall 钩子：

```json
{
  "scripts": {
    "postinstall": "rtc-agent-setup"
  }
}
```

这样每次安装依赖后会自动复制 worker 文件。

## 升级流程

当 `@rtc-agent/component` 发布新版本时：

```bash
# 1. 更新依赖
pnpm update @rtc-agent/component

# 2. 重新运行 setup（如果使用 postinstall 则自动执行）
npx rtc-agent-setup
```

CLI 工具会：
- 复制新的 worker 文件
- 更新 `manifest.json` 中的版本号
- 覆盖旧的 `shared-worker.js`

## 缓存管理

### 开发环境

Vite 开发服务器会自动处理文件变化，无需特殊配置。

### 生产环境

由于使用稳定文件名 `shared-worker.js`，建议：

1. **使用 manifest.json 中的版本号**：
   ```typescript
   // 读取 manifest.json
   const manifest = await fetch('/rtc-agent/manifest.json').then(r => r.json());
   const workerUrl = `/rtc-agent/shared-worker.js?v=${manifest.version}`;
   ```

2. **或使用构建工具注入版本号**：
   ```typescript
   const workerUrl = `/rtc-agent/shared-worker.js?v=${__APP_VERSION__}`;
   ```

3. **配置 Cache-Control 头部**（Nginx 示例）：
   ```nginx
   location /rtc-agent/shared-worker.js {
     add_header Cache-Control "no-cache, must-revalidate";
   }
   ```

## 手动配置

如果 CLI 工具不适用，可以手动复制：

### Vite / SvelteKit

```bash
# 创建目标目录
mkdir -p public/rtc-agent

# 查找带 hash 的 worker 文件并重命名复制
cp node_modules/@rtc-agent/component/dist/assets/shared-worker-*.js public/rtc-agent/shared-worker.js
```

### Webpack

```bash
mkdir -p static/rtc-agent
cp node_modules/@rtc-agent/component/dist/assets/shared-worker-*.js static/rtc-agent/shared-worker.js
```

### Windows 用户

使用 `copyfiles` 包：

```bash
pnpm add -D copyfiles
```

```json
{
  "scripts": {
    "postinstall": "copyfiles -f \"node_modules/@rtc-agent/component/dist/assets/shared-worker-*.js\" public/rtc-agent/"
  }
}
```

## 验证配置

打开浏览器控制台，应该看到：

```
[WorkerBridge] Using custom workerUrl: /rtc-agent/shared-worker.js
[WorkerBridge] worker init: { workerUrl: '...', ... }
```

如果看到 404 错误，请检查：
1. worker 文件是否正确复制到 public 目录
2. workerUrl 路径是否正确
3. 开发服务器是否已重启

## 文件结构

运行 CLI 工具后，public 目录结构：

```
public/
└── rtc-agent/
    ├── shared-worker.js           # 稳定文件名（从带 hash 的源文件重命名复制）
    └── manifest.json              # 版本信息
```

> 💡 CLI 工具会自动清理旧版本的 `shared-worker-*.js` 文件，防止文件堆积。

## manifest.json 格式

```json
{
  "version": "0.2.7-rc.3",
  "workerFile": "shared-worker.js",
  "stableWorkerUrl": "/rtc-agent/shared-worker.js",
  "timestamp": "2026-09-26T07:51:39.539Z"
}
```

## 故障排除

### 问题：Worker 验证超时（Stale Worker）

**症状**：控制台显示错误信息：

```text
Worker verification timed out after 5000ms. This may indicate a stale SharedWorker
from a previous browser session (e.g., after force-killing a tab during debugging).
To resolve: visit chrome://inspect/#workers, find and terminate the stale
'rtc-agent-worker' instance, then reload the page.
```

**原因**：

SharedWorker 在浏览器中持久存在，即使关闭 Tab 也不会立即销毁。如果在调试过程中强制终止 Tab（例如遇到无限递归），Worker 可能处于不一致状态。后续页面加载会连接到这个残留的 Worker，导致验证超时。

**解决**：

1. 访问 `chrome://inspect/#workers`
2. 找到名为 `rtc-agent-worker` 的 SharedWorker 实例
3. 点击 "terminate" 终止该 Worker
4. 刷新页面

**开发模式自动处理**：

在开发模式下（Vite `import.meta.env.DEV`），组件会自动为 Worker 名称添加时间戳后缀（如 `rtc-agent-worker-dev-1727520000000`），避免连接到之前会话的残留 Worker。生产模式保持固定名称以确保多 Tab 共享。

### 问题：动态模块加载失败（Stale Chunk Hash）

**症状**：控制台显示错误：

```text
Failed to fetch dynamically imported module: .../highlight-languages-XXXX.js
```

**原因**：

组件库重新构建后，chunk 文件的 hash 发生变化，但宿主应用缓存了旧的 JS bundle，仍引用旧的 chunk hash。

**解决**：

1. 清除浏览器缓存（硬刷新）
2. 重启开发服务器

**自动重试机制**：

组件内置了自动重试逻辑（2 次尝试），在检测到 chunk 加载失败时会自动清除缓存并重新加载。大多数情况下无需手动干预。

### 问题：SharedWorker 加载失败

**症状**：控制台显示 404 或 CORS 错误

**解决**：

1. 确认 worker 文件存在：`ls public/rtc-agent/`
2. 检查 workerUrl 路径是否正确
3. 重启开发服务器

### 问题：升级后仍使用旧版本

**症状**：更新依赖后，worker 行为未变化

**解决**：

1. 重新运行 `npx rtc-agent-setup`
2. 清除浏览器缓存（硬刷新）
3. 确认 manifest.json 版本号已更新

## 技术细节

### 为什么使用稳定文件名？

- 原始 worker 文件名包含 hash（如 `shared-worker-DNuUtKfr.js`）
- 每次构建 hash 都会变化
- CLI 工具将带 hash 的文件复制为 `shared-worker.js`，简化配置
- 升级时 CLI 工具会自动清理旧版本文件

### 开发模式 vs 生产模式的 Worker 命名

**开发模式**：

- Worker 名称包含时间戳：`rtc-agent-worker-dev-{timestamp}`
- 每次页面加载都会创建新的 Worker 实例
- 避免连接到之前调试会话残留的 stale Worker
- 适用于开发调试场景（频繁热重载、强制终止 Tab）

**生产模式**：

- Worker 名称固定：`rtc-agent-worker`
- 多个 Tab 共享同一个 Worker 实例
- 确保多 Tab 场景下的连接共享和状态一致性

### 为什么不使用 Blob URL？

SharedWorker 必须是外部文件，不能使用 Blob URL（浏览器安全限制）。
这是 SharedWorker 与 Dedicated Worker 的关键区别。

### 多 Tab 共享

SharedWorker 的核心优势是多 Tab 共享一个连接。
所有打开同一网站的 Tab 都会连接到同一个 SharedWorker 实例，
共享 WebSocket 连接和 IndexedDB 数据。

## 相关资源

- [API 文档](./API.md)
- [示例代码](./EXAMPLES.md)
- [CDN 使用指南](./CDN-USAGE.md)
