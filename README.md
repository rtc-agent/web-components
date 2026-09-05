# RTC Agent Web Components

基于 Lit 的 Web Component 组件库，以浮窗形式为宿主页面提供 RTC Agent 交互界面。

## 功能特性

- 浮窗式 UI：支持 normal / maximized / minimized 三种窗口形态，可拖动、缩放
- 多会话管理：会话列表、切换、创建、Fork
- 实时消息：流式响应、Tool Call 卡片、确认弹窗
- 本地持久化：IndexedDB 存储消息、会话、虚拟文件系统（AGENT.md）
- 主题系统：light / dark / system 三套主题，通过 CSS 变量扩展
- 技能系统：Scenario 文档加载、FunctionRegistry 声明式注册
- 可访问性：ARIA、焦点管理、`prefers-reduced-motion` 支持

## 快速开始

### 前置条件

- Node.js >= 18
- pnpm >= 8.15

### 安装

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev            # 启动 Vite 开发服务器（默认 http://localhost:5173）
pnpm build          # 构建所有包
pnpm typecheck      # 全仓库类型检查
pnpm test           # 运行全部单元测试
```

## 项目结构

本仓库是 pnpm monorepo，包含以下包：

| 包 | 路径 | 说明 |
| --- | --- | --- |
| `@rtc-agent/component` | `packages/component` | Web Component 组件库（Lit） |
| `@rtc-agent/client` | `packages/client` | Centrifuge 通信层（连接、RPC、订阅、流式） |
| `@rtc-agent/persistence` | `packages/persistence` | 本地持久化层（IndexedDB + Dexie） |
| `@rtc-agent/protocol` | `packages/protocol` | 协议类型定义（OpenAPI 生成的 TS 类型） |

### 包依赖关系

```
component
├── client
│    └── protocol
├── persistence
│    ├── client
│    └── protocol
└── protocol
```

## 宿主集成

最简用法：

```html
<script type="module">
  import '@rtc-agent/component';
</script>
<rtc-agent></rtc-agent>
```

声明式注册函数：

```ts
const agent = document.querySelector<RtcAgent>('rtc-agent')!;
agent.agentConfig = {
  name: 'MermaidEditor',
  persona: 'You are a helpful Mermaid diagram assistant.',
  groups: [{
    name: 'editor',
    description: 'Editor operations',
    functions: [
      { name: 'getCode', description: 'Get current code', handler: () => editorAPI.getCode() },
    ],
  }],
};
```

## 测试

```bash
pnpm test               # 全部单元测试（vitest）
pnpm test:e2e           # E2E 测试（playwright）
```

## 贡献指南

欢迎提交 Issue 与 PR。代码风格遵循仓库根目录 `.claude/skills/rtc-agent-development-standards/` 下的规范。

## License

[MIT](./LICENSE)
