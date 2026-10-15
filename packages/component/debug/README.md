# Debug Tools

RTC Agent Web Components 调试工具和测试页面。

## 目录结构

```
debug/
├── index.html                    # 技能系统演示页面（主调试页面）
├── debug-controller.ts           # 可复用的调试面板控制器
├── message-list.debug.ts         # 消息列表调试辅助
│
├── components/                   # 组件调试页面
│   ├── chat-layout.html          # 聊天布局
│   ├── message-list.html         # 消息列表
│   ├── message-list-virtual.html # 虚拟滚动消息列表
│   ├── editor-toolbar.html       # 编辑器工具栏
│   ├── markdown-editor.html      # Markdown 编辑器
│   ├── file-explorer.html        # 文件浏览器
│   ├── session-tree.html         # 会话树
│   ├── settings-layout.html      # 设置布局
│   └── activity-bar.html         # 活动栏
│
└── scenarios/                    # 场景演示页面
    ├── task01.html ~ task17.html # 各种任务场景
    └── ...
```

## 使用方式

### 1. 启动开发服务器

```bash
# 在 web-components 根目录执行
pnpm dev

# 或在 component 包目录执行
cd packages/component
pnpm dev
```

### 2. 访问调试页面

开发服务器启动后，访问：

```
http://localhost:5173/debug/
```

### 3. 使用 DebugController

`DebugController` 是一个可复用的调试面板控制器，提供以下功能：

- **主题管理** - 亮/暗主题切换
- **状态显示** - JSON 格式显示组件状态
- **事件日志** - 记录所有组件事件
- **DOM 工具** - `$` 和 `$$` 快捷方式

#### 示例

```typescript
import { DebugController } from './debug/debug-controller';

const dc = new DebugController({
  previewSelector: '#previewContainer',
  stateDisplaySelector: '#stateDisplay',
  eventLogSelector: '#eventLog',
  maxLogEntries: 20,
  defaultTheme: 'dark',
});

// 切换主题
dc.setTheme('light');

// 设置状态
dc.setState({ count: 10, name: 'test' });

// 记录事件
dc.logEvent('button-click', { buttonId: 'submit' });

// 绑定主题按钮
dc.bindThemeButtons();

// 绑定事件日志
dc.bindEventLog(myComponent, ['editor-tab-select', 'editor-tab-close']);
```

## 调试页面说明

### index.html - 技能系统演示

主调试页面，演示 RTC Agent 的技能系统功能：

- **Functions Tab** - 注册和执行函数（auto/notify/confirm）
- **Scenarios Tab** - 加载和预览场景
- **Scripts Tab** - 编写和执行 TypeScript 脚本
- **FS Tab** - 浏览虚拟文件系统
- **Events Tab** - 查看组件事件日志

### 组件调试页面

各个组件的独立调试页面，用于快速测试和调试单个组件：

- `chat-layout.html` - 聊天布局组件
- `message-list.html` - 消息列表组件
- `editor-toolbar.html` - 编辑器工具栏组件
- 等等...

### 场景演示页面

各种任务场景的演示页面（task01.html ~ task17.html），用于测试特定的用户交互场景。

## 添加新的调试页面

1. 在 `debug/` 目录下创建新的 HTML 文件
2. 参考现有页面的结构
3. 使用 `DebugController` 提供统一的调试体验
4. 如果是组件调试页面，放在 `components/` 子目录
5. 如果是场景演示页面，放在 `scenarios/` 子目录

## Sourcemap 策略

调试页面使用开发环境的 sourcemap 配置：

- **component 包** - vite 的 `'hidden'` 模式（生成 .map 文件但不在 JS 中引用）
- **persistence 包** - tsup + `remove-sourcemap-refs.js` 脚本（生成 .map 文件，然后通过脚本移除引用）

两种方式都能实现 "hidden sourcemap" 效果：
- 生产环境：.map 文件存在但浏览器无法发现（保护源码）
- 开发环境：可以通过错误追踪工具（如 Sentry）上传 .map 文件用于错误定位

## 注意事项

- 调试页面仅用于开发和测试，不应部署到生产环境
- 调试页面的样式和交互可能与实际组件不一致
- 某些调试页面可能需要特定的环境变量或配置
