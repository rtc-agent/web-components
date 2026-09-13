# RTC Message Container Layer 架构

> 从 `<rtc-agent>` 到 `<rtc-message>` 的完整容器关系图，包含 Shadow DOM 边界、可折叠状态、内容类型分支。
> 用于 BUG 排查时理解组件嵌套和数据流向。

## 1. 整体容器层次图

```mermaid
graph TD
    subgraph LIGHT_DOM["Light DOM (宿主页面)"]
        AGENT["&lt;rtc-agent&gt;<br/>Root Component<br/>──────────────<br/>• 持有所有 Controller<br/>• 创建所有 ContextProvider<br/>• data-mode: normal|maximized|minimized"]
    end

    AGENT -->|"ShadowRoot"| WINDOW_CONTAINER

    subgraph AGENT_SHADOW["&lt;rtc-agent&gt; Shadow DOM"]
        WINDOW_CONTAINER[".window-container<br/>(flex column)"]
        BUBBLE[".bubble<br/>(minimized 状态显示)"]

        TITLE_BAR["&lt;rtc-title-bar&gt;<br/>──────────────<br/>• 窗口控制按钮<br/>• 连接状态指示"]

        subgraph MAIN_LAYOUT[".main-layout<br/>(flex row)"]
            ACTIVITY_BAR["&lt;rtc-activity-bar&gt;<br/>──────────────<br/>• chat / files / settings 切换"]

            CHAT_LAYOUT["&lt;rtc-chat-layout&gt;<br/>──────────────<br/>• 两栏布局<br/>• sessionTreeVisible 控制左栏"]

            SETTINGS_LAYOUT["&lt;rtc-settings-layout&gt;<br/>(active='settings' 时)"]

            FILES_AREA[".editor-area-wrapper<br/>──────────────<br/>• &lt;rtc-editor-area&gt;<br/>• &lt;rtc-status-bar&gt;<br/>(active='files' 时)"]
        end

        TOAST["&lt;rtc-toast&gt;"]
        LOGIN_DIALOG["&lt;rtc-login-dialog&gt;<br/>(条件渲染)"]
    end

    WINDOW_CONTAINER --> TITLE_BAR
    WINDOW_CONTAINER -->|"isLoggedIn ?"| MAIN_LAYOUT
    WINDOW_CONTAINER -->|"!isLoggedIn"| LOGIN_PAGE["&lt;rtc-login-page&gt;"]
    WINDOW_CONTAINER --> TOAST
    MAIN_LAYOUT --> ACTIVITY_BAR
    MAIN_LAYOUT -->|"active='chat'"| CHAT_LAYOUT
    MAIN_LAYOUT -->|"active='settings'"| SETTINGS_LAYOUT
    MAIN_LAYOUT -->|"active='files'"| FILES_AREA

    style AGENT fill:#e1f5fe
    style CHAT_LAYOUT fill:#fff3e0
    style MAIN_LAYOUT fill:#f3e5f5
```

## 2. Chat Layout 内部结构

```mermaid
graph TD
    subgraph CHAT_LAYOUT_SHADOW["&lt;rtc-chat-layout&gt; Shadow DOM"]
        direction TB

        subgraph SIDEBAR[".sidebar<br/>(sessionTreeVisible=true 时)"]
            SESSION_TREE["&lt;rtc-session-tree&gt;<br/>──────────────<br/>• 会话列表树<br/>• 支持展开/折叠"]
        end

        subgraph MAIN[".main<br/>(flex column)"]
            TAB_BAR[".tab-bar"]
            SESSION_TAB_BAR["&lt;rtc-session-tab-bar&gt;<br/>──────────────<br/>• 多 Tab 标签栏<br/>• 支持关闭/切换"]

            subgraph CONTENT_AREA_CONTAINER[".content-area<br/>(flex column, flex: 1)"]
                CONTENT_AREA["&lt;rtc-content-area&gt;"]
                NOTICE_BAR["&lt;rtc-notice-bar&gt;"]
                INPUT_AREA["&lt;rtc-input-area&gt;<br/>──────────────<br/>• 输入框<br/>• 发送/停止按钮"]
                OVERLAY_MANAGER["&lt;rtc-overlay-manager&gt;<br/>──────────────<br/>• 管理浮层<br/>• command-panel / session-panel / mode-panel / todo-panel"]
            end
        end
    end

    CHAT_LAYOUT -->|"ShadowRoot"| SIDEBAR
    CHAT_LAYOUT -->|"ShadowRoot"| MAIN
    MAIN --> TAB_BAR
    TAB_BAR --> SESSION_TAB_BAR
    MAIN --> CONTENT_AREA_CONTAINER
    CONTENT_AREA_CONTAINER --> CONTENT_AREA
    CONTENT_AREA_CONTAINER --> NOTICE_BAR
    CONTENT_AREA_CONTAINER --> INPUT_AREA
    CONTENT_AREA_CONTAINER --> OVERLAY_MANAGER

    style CHAT_LAYOUT_SHADOW fill:#fff3e0
    style CONTENT_AREA fill:#e8f5e9
```

## 3. Content Area 消息渲染分支

```mermaid
graph TD
    subgraph CONTENT_AREA_SHADOW["&lt;rtc-content-area&gt; Shadow DOM"]
        direction TB
        CONTAINER[".content-container"]

        CONTENT_AREA -->|"ShadowRoot"| CONTAINER

        CONTAINER -->|"messages.length > 0"| MESSAGE_LIST
        CONTAINER -->|"messages.length === 0"| EMPTY_STATE

        MESSAGE_LIST["&lt;rtc-message-list&gt;<br/>──────────────<br/>• 可滚动容器<br/>• 自动滚动跟踪<br/>• ResizeObserver 监听内容变化"]

        EMPTY_STATE["&lt;rtc-empty-state&gt;"]
    end

    style CONTENT_AREA_SHADOW fill:#e8f5e9
    style MESSAGE_LIST fill:#c8e6c9
```

## 4. Message List 内部渲染逻辑（关键）

```mermaid
graph TD
    subgraph MESSAGE_LIST_SHADOW["&lt;rtc-message-list&gt; Shadow DOM"]
        direction TB

        SCROLL[".message-list-scroll<br/>(overflow-y: auto)"]
        INNER[".message-list-inner<br/>(timeline layout)"]

        MESSAGE_LIST -->|"ShadowRoot"| SCROLL
        SCROLL --> INNER

        subgraph RENDER_ITEMS["repeat(items) 渲染列表"]
            direction TB

            USER_MSG["role='user'<br/>↓"]
            ASSISTANT_MSG["role='assistant'<br/>↓"]
            TOOLCALL["content.type='toolcall_input'<br/>↓"]

            USER_MSG_E["&lt;rtc-user-message&gt;"]
            ASSISTANT_MSG_E["&lt;rtc-message&gt;"]
            TOOLCALL_E["&lt;rtc-toolcall-card&gt;"]

            USER_MSG --> USER_MSG_E
            ASSISTANT_MSG --> ASSISTANT_MSG_E
            TOOLCALL --> TOOLCALL_E
        end

        INNER --> USER_MSG
        INNER --> ASSISTANT_MSG
        INNER --> TOOLCALL

        LOAD_MORE_BTN["button.load-more-btn<br/>(hasMore && nearTop)"]
        NEW_MSG_BTN["button.new-message-btn<br/>(!userAtBottom)"]
    end

    subgraph BUILD_RENDER_ITEMS["_buildRenderItems() 逻辑"]
        direction TB
        FLAT_MSGS["flat Message[]"]
        PAIR_LOGIC["toolcall_input + toolcall_output<br/>→ ToolCallPair"]
        FILTER["toolcall_output 被配对后<br/>从渲染列表中排除"]

        FLAT_MSGS --> PAIR_LOGIC
        PAIR_LOGIC --> FILTER
    end

    style MESSAGE_LIST_SHADOW fill:#c8e6c9
    style RENDER_ITEMS fill:#fff9c4
```

## 5. rtc-message 内部结构（内容类型分支）

```mermaid
graph TD
    subgraph MESSAGE_SHADOW["&lt;rtc-message&gt; Shadow DOM"]
        direction TB

        TIMELINE_ITEM[".timeline-item<br/>──────────────<br/>CSS Classes:<br/>• streaming (流式中)<br/>• thinking-content (思考类型)<br/>• summary-content (压缩摘要)<br/>• success (完成状态)"]

        MESSAGE -->|"ShadowRoot"| TIMELINE_ITEM

        DOT[".timeline-dot<br/>──────────────<br/>• 时间线圆点<br/>• data-timestamp 属性<br/>• 点击复制内容"]

        CONTENT[".timeline-content"]

        TIMELINE_ITEM --> DOT
        TIMELINE_ITEM --> CONTENT

        CONTENT -->|"content.type === 'thinking'"| THINKING_BLOCK
        CONTENT -->|"content.type === 'summary'"| SUMMARY_BLOCK
        CONTENT -->|"其他类型 (text, markdown 等)"| MARKDOWN_WRAPPER

        subgraph THINKING_BLOCK[".thinking-block<br/>──────────────<br/>⚡ 可折叠!<br/>data-expanded 属性控制"]
            direction TB
            THINKING_HEADER[".thinking-header<br/>──────────────<br/>• 点击切换折叠<br/>• ▸ / ▾ 箭头<br/>• '思考过程' 标签"]
            THINKING_BODY[".thinking-body<br/>(expanded 时渲染)"]
            THINKING_MARKDOWN["div.innerHTML<br/>(Markdown 渲染)"]

            THINKING_BLOCK --> THINKING_HEADER
            THINKING_BLOCK -->|"expanded=true"| THINKING_BODY
            THINKING_BODY --> THINKING_MARKDOWN
        end

        subgraph SUMMARY_BLOCK[".summary-block<br/>──────────────<br/>❌ 不可折叠"]
            direction TB
            SUMMARY_HEADER[".summary-header"]
            SUMMARY_LABEL["span.summary-label<br/>──────────────<br/>• streaming: '正在压缩上下文...'<br/>• 完成: '已压缩上下文'"]
            SUMMARY_STATS["span.summary-stats<br/>──────────────<br/>• 释放/增加 X token<br/>• 耗时 X ms"]

            SUMMARY_BLOCK --> SUMMARY_HEADER
            SUMMARY_HEADER --> SUMMARY_LABEL
            SUMMARY_HEADER --> SUMMARY_STATS
        end

        subgraph MARKDOWN_WRAPPER["div (Markdown 包裹层)<br/>──────────────<br/>❌ 不可折叠"]
            direction TB
            INNER_HTML["div.innerHTML<br/>──────────────<br/>• marked.parse() 解析<br/>• DOMPurify.sanitize() 净化<br/>• hljs 代码高亮"]
            RENDERED_P["&lt;p&gt;/&lt;h1&gt;/&lt;pre&gt;..."]

            MARKDOWN_WRAPPER --> INNER_HTML
            INNER_HTML --> RENDERED_P
        end
    end

    style MESSAGE_SHADOW fill:#e3f2fd
    style THINKING_BLOCK fill:#fff9c4
    style SUMMARY_BLOCK fill:#f3e5f5
    style MARKDOWN_WRAPPER fill:#e8f5e9
```

## 6. rtc-user-message 内部结构

```mermaid
graph TD
    subgraph USER_MESSAGE_SHADOW["&lt;rtc-user-message&gt; Shadow DOM"]
        direction TB

        WRAPPER[".user-message-wrapper<br/>(sticky container)"]

        USER_MESSAGE -->|"ShadowRoot"| WRAPPER

        BUBBLE[".user-message<br/>──────────────<br/>• max-height 限制<br/>• overflow: hidden<br/>• data-sync-status 属性<br/>• data-overflow 属性<br/>• data-expanded 属性"]

        TEXT[".user-message-text<br/>──────────────<br/>纯文本内容<br/>(extractTextContent)"]

        SHOW_MORE_BTN["button.show-more-btn<br/>──────────────<br/>• overflow 时显示<br/>• hover 时可见<br/>• 切换 expanded"]

        MORE_BTN["button.more-btn<br/>──────────────<br/>• ⋯ 图标<br/>• hover 时可见<br/>• 触发 more-menu"]

        WRAPPER --> BUBBLE
        BUBBLE --> TEXT
        BUBBLE -->|"isOverflowing"| SHOW_MORE_BTN
        BUBBLE --> MORE_BTN

        MORE_MENU["&lt;rtc-message-more-menu&gt;<br/>──────────────<br/>• teleport 到 shadowRoot<br/>• floating-ui 定位<br/>• 菜单项:<br/>  - 复制<br/>  - 分叉<br/>  - 重试 (failed 时)"]

        MORE_BTN -->|"点击"| MORE_MENU
    end

    subgraph SYNC_STATUS["data-sync-status 视觉状态"]
        direction TB
        PENDING["pending<br/>• glow 呼吸动画<br/>• more-menu: 复制, 分叉 + timestamp"]
        SYNCED["synced<br/>• 静态默认边框<br/>• more-menu: 复制, 分叉 + timestamp"]
        FAILED["failed<br/>• 错误边框<br/>• more-menu: 复制, 分叉, 重试 + timestamp"]
    end

    style USER_MESSAGE_SHADOW fill:#fce4ec
    style MORE_MENU fill:#fff9c4
```

## 7. rtc-toolcall-card 内部结构

```mermaid
graph TD
    subgraph TOOLCALL_SHADOW["&lt;rtc-toolcall-card&gt; Shadow DOM"]
        direction TB

        TIMELINE_ITEM[".timeline-item.toolcall-card-item<br/>──────────────<br/>• data-toolcall-status 属性<br/>  - running: 橙色脉冲<br/>  - done: 绿色静态"]

        TOOLCALL -->|"ShadowRoot"| TIMELINE_ITEM

        DOT[".timeline-dot"]
        CONTENT[".timeline-content"]

        TIMELINE_ITEM --> DOT
        TIMELINE_ITEM --> CONTENT

        subgraph CARD[".toolcall-card"]
            direction TB

            HEADER[".toolcall-header<br/>──────────────<br/>span.toolcall-name<br/>(tool_name)"]

            subgraph SECTION_IN[".toolcall-section.in<br/>──────────────<br/>输入参数区域"]
                LABEL_IN["span.toolcall-label<br/>'In'"]
                VALUE_IN["span.toolcall-value<br/>(JSON 格式化)"]
                COPY_IN["button.copy-btn<br/>(复制 input)"]
            end

            subgraph SECTION_OUT[".toolcall-section.out<br/>(hasOutput 时渲染)"]
                LABEL_OUT["span.toolcall-label<br/>'Out'"]
                VALUE_OUT[".toolcall-output-content<br/>(JSON 格式化)"]
                COPY_OUT["button.copy-btn<br/>(复制 output)"]
            end

            CARD --> HEADER
            CARD --> SECTION_IN
            CARD -->|"pair.output 存在"| SECTION_OUT
        end

        CONTENT --> CARD
    end

    subgraph PAIR["ToolCallPair 数据模型"]
        direction TB
        INPUT["input: Message<br/>(content.type = 'toolcall_input')"]
        OUTPUT["output?: Message<br/>(content.type = 'toolcall_output')"]
    end

    style TOOLCALL_SHADOW fill:#e0f2f1
    style SECTION_IN fill:#e3f2fd
    style SECTION_OUT fill:#e8f5e9
```

## 8. 完整数据流图：Message 从 Agent 到渲染

```mermaid
sequenceDiagram
    participant Server as 服务端
    participant Persistence as PersistenceController<br/>(IndexedDB)
    participant MessageCtrl as MessageController
    participant MessageCtx as MessageContext
    participant MessageList as rtc-message-list
    participant Message as rtc-message
    participant UserMessage as rtc-user-message
    participant ToolCall as rtc-toolcall-card

    Server->>Persistence: Live 推送消息更新
    Persistence->>MessageCtrl: UIUpdateBus 触发 reload()
    MessageCtrl->>MessageCtrl: 从 DB 加载 messages[]
    MessageCtrl->>MessageCtx: 更新 context value
    MessageCtx->>MessageList: @consume 触发重渲染
    MessageList->>MessageList: _buildRenderItems(msgs)
    Note over MessageList: 1. 构建 input→output 映射<br/>2. 过滤 toolcall_output<br/>3. 配对 toolcall_input + output<br/>4. 生成渲染项数组

    MessageList->>UserMessage: render(role='user')
    MessageList->>Message: render(role='assistant')
    MessageList->>ToolCall: render(content.type='toolcall_input')

    Note over Message: 根据 content.type 分支:
    alt content.type === 'thinking'
        Message->>Message: _renderThinkingBlock()<br/>可折叠!
    else content.type === 'summary'
        Message->>Message: _renderSummaryBlock()<br/>不可折叠
    else content.type === 'text' / 其他
        Message->>Message: _parseMarkdown()<br/>异步: marked + DOMPurify + hljs
    end
```

## 9. 关键状态属性速查表

| 组件 | 属性/状态 | 说明 | 影响 |
|------|-----------|------|------|
| `rtc-agent` | `data-mode` | `normal` / `maximized` / `minimized` | 窗口视觉状态 |
| `rtc-message` | `.streaming` | 流式传输中 | 圆点动画 |
| `rtc-message` | `.thinking-content` | 思考类型消息 | 渲染折叠块 |
| `rtc-message` | `.summary-content` | 压缩摘要消息 | 渲染摘要块 |
| `rtc-message` | `.success` | 完成状态（最后一条 + 非流式 + 非思考/摘要） | 绿色圆点 |
| `rtc-message` | `_thinkingExpanded` | 思考块展开状态 | 显示/隐藏内容 |
| `rtc-user-message` | `data-sync-status` | `pending` / `synced` / `failed` | 边框动画、菜单项 |
| `rtc-user-message` | `data-overflow` | 文本溢出 | 显示 "Show more" |
| `rtc-user-message` | `data-expanded` | 展开状态 | 取消 max-height 限制 |
| `rtc-toolcall-card` | `data-toolcall-status` | `running` / `done` | 圆点颜色（橙/绿） |

## 10. Shadow DOM 边界汇总

```
<rtc-agent>                          ← 宿主页面 Light DOM
  #shadow-root
    ├── <rtc-title-bar>              ← Shadow DOM
    ├── <rtc-chat-layout>            ← Shadow DOM
    │     #shadow-root
    │       ├── <rtc-session-tree>   ← Shadow DOM (嵌套)
    │       ├── <rtc-session-tab-bar>
    │       └── <rtc-content-area>   ← Shadow DOM (嵌套)
    │             #shadow-root
    │               └── <rtc-message-list>
    │                     #shadow-root
    │                       ├── <rtc-user-message>
    │                       ├── <rtc-message>
    │                       └── <rtc-toolcall-card>
    ├── <rtc-editor-area>
    ├── <rtc-status-bar>
    ├── <rtc-toast>
    └── <rtc-login-dialog>
```

## 11. 事件流向图

```mermaid
graph BT
    subgraph EVENTS["关键事件流"]
        direction TB

        subgraph USER_EVENTS["用户交互事件 (向上冒泡)"]
            FORK_REQUESTED["rtc-fork-requested<br/>(user-message → chat-layout)"]
            RESEND["rtc-user-message-resend<br/>(user-message → agent)"]
            TOAST_REQUESTED["rtc-toast-requested<br/>(各组件 → agent)"]
            INPUT_SUBMIT["rtc-input-submit<br/>(input-area → agent)"]
        end

        subgraph SYSTEM_EVENTS["系统事件"]
            UI_UPDATE["UIUpdateBus.message<br/>(persistence → message-list)"]
            CONTEXT_UPDATE["MessageContext 变更<br/>(controller → consumers)"]
        end
    end

    USER_MESSAGE["rtc-user-message"] --> FORK_REQUESTED
    USER_MESSAGE --> RESEND
    USER_MESSAGE --> TOAST_REQUESTED
    MESSAGE["rtc-message"] --> TOAST_REQUESTED
    TOOLCALL["rtc-toolcall-card"] --> TOAST_REQUESTED

    FORK_REQUESTED --> CHAT_LAYOUT["rtc-chat-layout"]
    CHAT_LAYOUT -->|"派发 rtc-fork-initiated"| AGENT["rtc-agent"]

    RESEND --> AGENT
    TOAST_REQUESTED --> AGENT

    UI_UPDATE --> MESSAGE_LIST["rtc-message-list"]
    CONTEXT_UPDATE --> MESSAGE_LIST
```

## 12. 可折叠组件清单

| 组件 | 折叠目标 | 触发方式 | 默认状态 | 状态属性 |
|------|----------|----------|----------|----------|
| `rtc-message` (thinking) | `.thinking-body` | 点击 `.thinking-header` | 折叠 (`false`) | `_thinkingExpanded` |
| `rtc-user-message` | 文本高度 | 点击 `.show-more-btn` | 折叠 (max-height) | `_expanded` / `data-expanded` |
| `rtc-session-tree-item` | 子节点列表 | 点击展开图标 | 折叠 | controller state |

## 13. 内容类型映射表

| `message.content.type` | 渲染组件 | 渲染方式 | 可折叠 |
|------------------------|----------|----------|--------|
| `text` | `rtc-message` | Markdown → HTML | ❌ |
| `thinking` | `rtc-message` | Markdown → HTML (折叠块) | ✅ |
| `summary` | `rtc-message` | 统计信息块 | ❌ |
| `toolcall_input` | `rtc-toolcall-card` | 配对渲染 In/Out | ❌ (卡片整体) |
| `toolcall_output` | (不直接渲染) | 被配对到 input | N/A |

---

## BUG 排查提示

1. **消息不显示**：检查 `MessageContext` 是否正确传递，`rtc-message-list` 是否收到 `_ctx` 更新
2. **Markdown 渲染异常**：检查 `_parseGeneration` 守卫是否丢弃了过期结果，DOMPurify 是否净化了预期内容
3. **思考块不折叠/展开**：检查 `_thinkingExpanded` 状态，`data-expanded` 属性是否正确反映
4. **ToolCall 不配对**：检查 `parentClientId` 是否正确设置，`inputToOutput` Map 是否匹配成功
5. **滚动不跟随**：检查 `_shouldAutoScroll` 状态，`ResizeObserver` 是否正常触发
6. **用户消息溢出按钮不显示**：检查 `_resizeObserver` 是否监听 `_textEl`，`data-overflow` 属性是否设置
