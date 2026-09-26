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

# 复制 worker 文件
cp node_modules/@rtc-agent/component/dist/assets/shared-worker*.js public/rtc-agent/

# 创建稳定链接
cd public/rtc-agent
ln -sf shared-worker-*.js shared-worker.js
```

### Webpack

```bash
mkdir -p static/rtc-agent
cp node_modules/@rtc-agent/component/dist/assets/shared-worker*.js static/rtc-agent/
cd static/rtc-agent
ln -sf shared-worker-*.js shared-worker.js
```

### Windows 用户

使用 `copyfiles` 包：

```bash
pnpm add -D copyfiles
```

```json
{
  "scripts": {
    "postinstall": "copyfiles -f \"node_modules/@rtc-agent/component/dist/assets/shared-worker*.js\" public/rtc-agent/"
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
    ├── shared-worker-<hash>.js    # 原始 worker 文件
    ├── shared-worker.js           # 稳定链接（指向带 hash 的文件）
    └── manifest.json              # 版本信息
```

## manifest.json 格式

```json
{
  "version": "0.1.0",
  "workerFile": "shared-worker-DNuUtKfr.js",
  "stableWorkerUrl": "/rtc-agent/shared-worker.js",
  "timestamp": "2026-09-26T07:51:39.539Z"
}
```

## 故障排除

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

### 问题：Windows 下符号链接失败

**症状**：`ln -sf` 命令失败

**解决**：
使用 `copyfiles` 或直接复制文件，不使用符号链接。

## 技术细节

### 为什么需要稳定文件名？

- 原始 worker 文件名包含 hash（如 `shared-worker-DNuUtKfr.js`）
- 每次构建 hash 都会变化
- 使用稳定文件名 `shared-worker.js` 简化配置
- 通过 manifest.json 追踪实际文件名

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
