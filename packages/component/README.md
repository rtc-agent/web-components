# @rtc-agent/component

基于 Lit 的 Web Component 组件库，提供浮窗式 RTC Agent 交互界面。

## 导出

### 组件

- `<rtc-agent>` — 根组件（唯一公开注册的 custom element）
  - 所有子组件均通过 side-effect 导入，在根组件 shadow DOM 内使用

### 类

- `RtcAgent` — 根组件 class，可直接 import 用于类型标注

```ts
import { RtcAgent } from '@rtc-agent/component';
const agent = document.querySelector<RtcAgent>('rtc-agent')!;
```

## 用法

```html
<script type="module">
  import '@rtc-agent/component';
</script>

<rtc-agent
  theme="system"
  app-label="RTC Agent"
  scenarios-url="./scenarios/"
></rtc-agent>
```

### 公开属性

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'system'` | `'system'` | 主题 |
| `app-label` | `string` | `'RTC Agent'` | 标题栏 / 气泡 tooltip 文本 |
| `bubble-icon` | `string` | `''` | 最小化气泡内的 SVG / HTML |
| `scenarios-url` | `string` | `''` | Scenario 文档 URL |
| `agentConfig` | `AgentConfig \| null` | `null` | 声明式函数注册 |
| `registry` | `FunctionRegistry \| null` | `null` | 命令式函数注册（高级） |

### 公开事件

所有公开事件遵循 `rtc-<domain>-<action>-<past-tense>` 命名模式：

- `rtc-agent-ready` — 组件就绪
- `rtc-session-created` / `rtc-session-switched`
- `rtc-message-sent`
- `rtc-auth-login-requested`
- `rtc-window-minimize` / `rtc-window-maximize` / `rtc-window-restore`

### 控制器访问

```ts
agent.authController.login();
agent.authController.logout();
agent.sessionController.actions.switchSession(id);
agent.messageController.actions.sendMessage(content);
agent.skillController.actions.setRegistry(registry);
```

## License

[MIT](../../LICENSE)
