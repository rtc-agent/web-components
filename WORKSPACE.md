# Web Components Workspace Guide

本文档说明 `web-components` pnpm monorepo 的结构和工具链配置。

## 包结构

| 包名 | 描述 | 构建工具 | Lint 工具 | 备注 |
|------|------|---------|----------|------|
| `@rtc-agent/component` | 核心 Web Components（Lit） | Vite + tsc | Biome | 主包，跨 5 个 packages |
| `@rtc-agent/client` | 通信层（Centrifuge） | tsc | Biome | 纯 TypeScript |
| `@rtc-agent/protocol` | 协议定义 | tsc | Biome | 类型定义 |
| `@rtc-agent/worker` | SharedWorker 层 | Vite + tsc | Biome | Web Worker |
| `@rtc-agent/persistence` | 持久化层（IndexedDB） | tsc | Biome | 虚拟文件系统 |
| `@rtc-agent/admin-ui` | 管理后台（Ant Design Pro） | Umi Max | Biome | **独立项目嵌入** |

## 工具链统一性

### 统一的工具

- **包管理器**：`pnpm`（所有包统一）
- **Lint 工具**：`Biome`（根级配置，所有包共享）
- **测试框架**：`Vitest`（大部分包使用）
- **TypeScript**：严格模式（所有包）

### admin-ui 的特殊性

`@rtc-agent/admin-ui` 本质上是 Ant Design Pro 模板项目嵌入到 monorepo，保留了一些独立性：

**差异点**：

1. **构建工具**：使用 Umi Max 的 `max build`，而非 turbo 缓存
   - 原因：Umi Max 有自己的构建优化和缓存机制
   
2. **项目结构**：有自己的 `.husky`、`.commitlintrc` 等配置
   - 原因：继承自 Ant Design Pro 模板
   
3. **开发命令**：
   ```bash
   # 其他包使用 turbo
   pnpm build        # 根级 turbo run build
   pnpm dev          # 根级 turbo run dev
   
   # admin-ui 直接调用
   cd packages/admin-ui
   pnpm run build    # max build
   pnpm run dev      # max dev
   ```

4. **配置文件**：
   - `config/config.ts` — Umi 配置
   - `config/routes.ts` — 路由配置
   - 没有 `vite.config.ts` 或 `tsup.config.ts`

**为什么这样设计**：

- admin-ui 是一个完整的 React 应用，不是库
- Umi Max 提供了开箱即用的企业级功能（路由、权限、国际化等）
- 强行统一到 turbo 可能破坏 Umi 的内部优化

**开发者须知**：

- 在 admin-ui 目录工作时，使用 `pnpm run <script>` 而非 `turbo run`
- Biome 配置继承自根级，但有一些 React 特定的 override
- `prepare` 脚本会调用 `max setup`，这是 Umi 特有的

## 常用命令

### 根级命令

```bash
# 构建所有包（使用 turbo 缓存）
pnpm build

# 开发模式（只启动 component）
pnpm dev

# 类型检查所有包
pnpm typecheck

# Lint 所有包
pnpm lint

# 运行测试
pnpm test

# 格式化代码
pnpm format
```

### 单包命令

```bash
cd packages/<package-name>

# 构建
pnpm run build

# 开发
pnpm run dev

# 类型检查
pnpm run typecheck

# Lint
pnpm run lint

# 测试
pnpm run test
```

## 贡献指南

### 代码风格

- 使用 Biome 自动格式化（`pnpm format`）
- 提交前运行 `pnpm lint` 确保通过
- TypeScript 严格模式，不允许 `any`

### 提交规范

使用 Conventional Commits：

```
<type>(<scope>): <subject>

<body>

<footer>
```

示例：

```
feat(component): add dark mode support

Implement theme switching with CSS variables.

Co-Authored-By: Claude Code <noreply@anthropic.com>
```

### PR 流程

1. 从 `dev` 分支创建特性分支
2. 提交代码（遵循 Conventional Commits）
3. 确保所有 CI 检查通过
4. 创建 PR 到 `dev` 分支
5. 等待 Review

## 故障排查

### 构建失败

```bash
# 清理缓存
pnpm clean  # 如果有的话
rm -rf node_modules
pnpm install

# 重新构建
pnpm build
```

### admin-ui 开发服务器问题

```bash
cd packages/admin-ui

# 删除 Umi 缓存
rm -rf src/.umi src/.umi-production

# 重启
pnpm run dev
```

### 类型检查失败

```bash
# 查看具体错误
pnpm typecheck

# 或者直接运行 tsc
pnpm tsc --noEmit
```

## 相关文档

- [RTC Agent 主文档](../README.md)
- [admin-ui 文档](./packages/admin-ui/CLAUDE.md)
- [component 文档](./packages/component/README.md)
