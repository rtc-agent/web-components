# 🤖 RTC Agent

[English](./README.md) | [中文](./README-ZH.md)

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Go Version](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go)
![WebSocket](https://img.shields.io/badge/WebSocket-Centrifuge-663399)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

## **Remote Tool Calling — 让你的网站，3 行代码拥有 AI 助手**

不是截图识别，不是 DOM 爬取。AI 通过前端工具直接操作网站，每一步都透明可观测。

---

> **一句话定义**：开源的网站 AI 助手后端，通过标准化的 Remote Tool Calling 协议，让你的网站几行代码接入透明、高效、低成本的 AI 助手。

RTC Agent 让 AI 在服务端推理，**工具在前端执行**——读取页面内容、操作虚拟文件系统、调用业务接口——所有过程通过 WebSocket 实时同步，对你的用户完全可见。

![RTC Agent 界面总览](https://rtc-agent.github.io/docs/demo-screenshot/chat-demo.png)

## 🎯 谁应该使用 RTC Agent？

- **SaaS 产品团队**：想为自己的产品添加 AI 助手，但不想重构后端
- **前端开发者**：希望快速集成 AI 能力，专注于业务逻辑而非 AI 基础设施
- **对隐私敏感的应用**：医疗、金融、企业内部工具，数据不能离开用户设备

---

## ✨ 核心能力

### 📂 前端虚拟文件系统

基于 **IndexedDB** 构建，AI 工具（`read` / `write` / `ls` / `grep`）直接操作前端文件，数据不离开用户浏览器。

### 🔑 Script 工具 + Function 组合

开发者**只需维护自己的 Function 库**，Agent 通过 `script` 工具在前端执行，并能**自由组合多个 Function** 完成复杂任务——无需预定义 workflow。

> 💡 **开发者视角**：你只需定义业务原子能力（Function），Agent 自己学会如何组合它们。就像给 AI 一套乐高积木，它自己会拼出你想要的形状。

### 💬 实时通信

基于 **Centrifuge WebSocket**，消息双向推送，支持流式输出、工具调用进度、状态同步。

### 🧠 记忆系统

双层记忆：**Session Memory**（会话上下文压缩）+ **User Memory**（跨会话长期记忆，支持向量检索）。AI 真正"记住"你的用户。

### 🗜️ 上下文管理

自动压缩长对话，Token 消耗可控。告别"上下文超限"报错。

### 🤖 子代理 + 🎯 目标驱动

复杂任务自动拆解，多个专业子代理并行工作；AI 设定、追踪、完成多步骤目标，turn-boundary checkpoint 保证任务不丢失。

---

## 🏗️ 架构

```mermaid
flowchart LR
    subgraph BROWSER["🖥️ 浏览器 / 前端"]
        direction TB
        UI["👤 Web Component"]
        WS["🔌 WebSocket Client"]
        SCRIPT["🔑 script 工具"]
        TOOLS["⚙️ 基础工具"]
        VFS[("💾 虚拟文件系统<br/>IndexedDB")]
        FX["📦 Function 库"]
    end

    subgraph SERVER["⚙️ RTC Agent Server"]
        direction TB
        GW["🌐 WebSocket Gateway"]
        AUTH["🔐 认证"]
        CTX["🗜️ 上下文管理"]
        MEM["🧠 记忆系统"]
        AGENT["🤖 Agent 引擎"]
    end

    LLM["🧠 LLM Provider"]

    UI -->|用户消息| GW
    GW --> AUTH --> CTX
    CTX -.->|注入记忆| MEM
    CTX --> AGENT
    AGENT -->|推理请求| LLM
    LLM -->|tool_calls| AGENT
    AGENT -->|script 调用| GW
    GW <-->|WebSocket| WS
    WS --> SCRIPT
    WS --> TOOLS
    SCRIPT -->|组合调用| FX
    SCRIPT -->|读写| VFS
    TOOLS -->|读写| VFS
    SCRIPT -->|结果| WS
    AGENT -->|响应| GW
    GW -->|流式输出| UI

    style BROWSER fill:#e1f5fe,stroke:#0288d1,stroke-width:3px
    style SERVER fill:#f3e5f5,stroke:#7b1fa2,stroke-width:3px
    style LLM fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style VFS fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
    style SCRIPT fill:#ffeb3b,stroke:#f9a825,stroke-width:2px,color:#000
```

核心数据流：

1. 所有 **Function 和文件数据**都在浏览器的 IndexedDB 中，服务端不接触业务数据
2. Agent 引擎通过 RTC 协议向浏览器发起工具调用，浏览器执行后回传结果
3. 记忆系统和上下文管理在服务端运行，负责对话质量优化

---

## 🔄 工作原理

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as 前端
    participant S as Server
    participant LLM as LLM Provider

    U->>FE: 发送消息
    FE->>S: WebSocket 推送
    S->>S: 注入记忆、压缩上下文、加载 Function 清单
    S->>LLM: 推理请求
    LLM-->>S: tool_calls（请求调用 Function）
    S->>FE: RTC 事件（工具调用请求）
    FE->>FE: script 工具执行 Function
    FE->>S: 提交执行结果
    S->>LLM: 携带结果继续推理
    LLM-->>S: 最终响应
    S->>FE: 流式输出
    FE->>U: 显示结果
```

### 🔑 关键差异

| | 传统方案 | RTC | RTC + Function |
| --- | --------- | ----- | ---------------- |
| **工具执行位置** | 服务端 ❌ | 前端 ✅ | 前端 ✅ |
| **数据流向** | 上云 🔒 | 留在用户设备 🔐 | 留在用户设备 🔐 |
| **扩展方式** | 改服务端代码 | 定义前端工具 | **只需定义 Function，Agent 自己学会组合** |

---

## 📊 对比其他 AI 助手方案

| 方案 | 接入成本 | 可观测性 | Token 成本 | 错误率 | 隐私安全 |
| :----: | :-------: | :-------: | :---------: | :-----: | :-------: |
| **RTC Agent** | 低 — 几行代码 | 完全透明 | 低 | 低 | 数据不出前端 |
| 视觉解析 (截图+OCR) | 中等 | 黑箱 | 极高 | 较高 | 需上传截图 |
| DOM 爬取 (服务端解析) | 复杂 | 部分可见 | 中等 | 中等 | 数据上云 |
| 浏览器插件 | 需安装 | 较好 | 中等 | 中等 | 本地运行 |

> 每种方案都有适用场景：视觉解析适合遗留系统零改造接入，浏览器插件适合离线场景。RTC Agent 的优势在于——**不需要安装、不需要截图、不需要改服务端**，几行代码就能让 AI 以结构化方式理解并操作你的网站。

---

## 📦 Workspace 结构

本项目采用 **pnpm monorepo** 架构，包含以下包：

| 包名 | 描述 | 技术栈 |
| --- | --- | --- |
| [`@rtc-agent/component`](./packages/component) | 核心 Web Components | Lit, Vite |
| [`@rtc-agent/client`](./packages/client) | 通信层 | Centrifuge WebSocket |
| [`@rtc-agent/protocol`](./packages/protocol) | 协议类型定义 | TypeScript |
| [`@rtc-agent/worker`](./packages/worker) | SharedWorker 层 | Comlink |
| [`@rtc-agent/persistence`](./packages/persistence) | 本地持久化层 | IndexedDB, Dexie.js |
| [`@rtc-agent/admin-ui`](./packages/admin-ui) | 管理后台 | React, Ant Design Pro, Umi Max |

### 包依赖关系

```text
component (主包)
├── client (通信)
├── protocol (类型)
├── worker (后台线程)
│   ├── client
│   ├── protocol
│   └── persistence
└── persistence (IndexedDB)
    ├── client
    └── protocol

admin-ui (独立 React 应用)
├── component
├── client
└── protocol
```

---

## 🛠️ 开发环境设置

### 环境要求

- **Node.js**: >= 22.0.0（推荐：24.21.0）
- **pnpm**: >= 8.0.0

### 安装 Node.js

推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理 Node.js 版本：

```bash
# 安装正确的 Node.js 版本
nvm install

# 使用正确的 Node.js 版本
nvm use
```

推荐版本存储在 `.nvmrc` 文件中。

### 安装依赖

```bash
# 如果还没有安装 pnpm，先安装
npm install -g pnpm

# 安装项目依赖
pnpm install
```

---

## 🚀 开发命令

### 根级命令

```bash
# 构建所有包（使用 turbo 缓存）
pnpm build

# 开发模式（仅 component）
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

### admin-ui 特殊命令

`admin-ui` 包使用 Umi Max 而非 turbo：

```bash
cd packages/admin-ui

# 开发服务器
pnpm run dev

# 构建（Umi Max）
pnpm run build

# Lint（Biome + tsc）
pnpm run lint
```

---

## 🧪 测试策略

- **单元测试**: 所有包使用 Vitest
- **集成测试**: 部分包有 `*.integration.test.ts` 文件
- **E2E 测试**: `component` 和 `admin-ui` 使用 Playwright

运行所有测试：

```bash
pnpm test
```

运行 E2E 测试：

```bash
pnpm test:e2e
```

---

## 🏗️ 构建流程

构建过程由 **Turborepo** 编排，具有以下特性：

1. **依赖感知**: 按拓扑顺序构建包
2. **缓存**: Turborepo 缓存构建输出（`.turbo` 目录）
3. **并行**: 独立包并行构建

构建输出：

- 大多数包：`dist/` 目录，包含 TypeScript 声明
- `component`：Vite 打包 + TypeScript 声明
- `admin-ui`：Umi Max 生产构建

---

## 📝 贡献指南

### 代码风格

- 使用 **Biome** 进行格式化和 lint（`pnpm format`, `pnpm lint`）
- 启用 TypeScript 严格模式
- 不允许使用 `any` 类型

### 提交规范

使用 **Conventional Commits**：

```text
<type>(<scope>): <subject>

<body>

<footer>
```

示例：

```text
feat(component): add dark mode support

Implement theme switching with CSS variables.

Co-Authored-By: Claude Code <noreply@anthropic.com>
```

```text
fix(client): reconnect on WebSocket timeout
```

### PR 流程

1. 从 `dev` 分支创建特性分支
2. 进行修改
3. 运行 `pnpm lint` 和 `pnpm test` 确保质量
4. 使用 conventional commit 信息提交
5. 推送并创建 PR 到 `dev` 分支
6. 等待 review

---

## 🔧 故障排查

### 构建失败

```bash
# 清理缓存并重新安装
rm -rf node_modules .turbo
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

---

## 📚 文档

- [快速开始](https://rtc-agent.github.io/docs/getting-started/) — 5 分钟接入 RTC Agent
- [核心概念](https://rtc-agent.github.io/docs/concepts/) — 深入理解 RTC 协议和虚拟文件系统
- [集成指南](https://rtc-agent.github.io/docs/integration/) — 学习如何注册 Function 和编写 Scenario
- [Workspace 指南](./WORKSPACE.md) — 详细的 monorepo 结构和工具链
- [包文档](./packages/) — 各包的独立 README

---

## 🚀 下一步

- [快速开始](https://rtc-agent.github.io/docs/getting-started/) — 5 分钟接入 RTC Agent
- [核心概念](https://rtc-agent.github.io/docs/concepts/) — 深入理解 RTC 协议和虚拟文件系统
- [集成指南](https://rtc-agent.github.io/docs/integration/) — 学习如何注册 Function 和编写 Scenario

---

### 📄 许可证

[MIT License](./LICENSE)

Made with ❤️ by RTC Agent Team
