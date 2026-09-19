# rtc-message-list.ts 虚拟滚动改造方案

## 目标

将现有的 `rtc-message-list.ts` 改造成支持虚拟滚动（virtual scroll），参考 debug html 的实现和 Telegram Web 的架构。

## 当前架构

```
rtc-message-list.ts (LitElement)
├── MessageRepository 订阅 → _messages 状态
├── render() → repeat() 渲染所有消息
├── 自动滚动机制：_shouldAutoScroll, ResizeObserver, _programmaticScrollCount
├── Load-more 机制：_handleLoadMoreClick, _preserveScrollPosition (anchor-based)
└── 样式：overflow-anchor: none, flex layout
```

**问题**：
1. 渲染所有消息 → DOM 节点过多，性能差
2. Load-more 是手动的（按钮点击），没有自动的 viewport slicing

## 改造方案

### 1. 集成 MessageVirtualScroll

**核心变化**：`MessageVirtualScroll` 接管 DOM 操作，`render()` 只提供容器结构。

```typescript
// 新增属性
private _virtualScroll?: MessageVirtualScroll<Message>;

// firstUpdated 中初始化
firstUpdated() {
    this._scrollEl = this.shadowRoot!.querySelector('.message-list-scroll') as HTMLElement;
    const innerEl = this.shadowRoot!.querySelector('.message-list-inner') as HTMLElement;
    
    this._virtualScroll = new MessageVirtualScroll<Message>({
        scrollContainer: this._scrollEl,
        innerContainer: innerEl,
        renderItem: (msg, index) => this._renderMessageElement(msg, index),
        getItemId: (msg) => msg.clientId,
        onLoadMore: (direction, boundary) => this._handleVirtualScrollLoadMore(direction, boundary),
        query: '[data-client-id]',
        preloadThreshold: 300,
        bufferMessages: 20,
        sliceInterval: 3000,
    });
    
    // ... 其他初始化
}
```

### 2. 数据流整合

**MessageRepository 订阅 → MessageVirtualScroll 操作**

```typescript
private _subscribeToSession() {
    if (!this.sessionId || !this.messageController) return;
    
    this._subscription?.();
    this._subscription = this.messageController.repository.subscribe(
        this.sessionId,
        (data: MessageState) => {
            this._handleMessagesUpdate(data);
        },
    );
    
    this.messageController.fetchInitialMessages(this.sessionId);
}

private _handleMessagesUpdate(data: MessageState) {
    const oldMessages = this._messages;
    const newMessages = data.messages;
    
    // 检测变化类型
    if (oldMessages.length === 0 && newMessages.length > 0) {
        // 初始加载
        this._virtualScroll?.setItems(newMessages);
        if (this._shouldAutoScroll) {
            this._virtualScroll?.scrollToBottom();
        }
    } else if (newMessages.length > oldMessages.length) {
        // 检测是 prepend 还是 append
        const isPrepend = newMessages[0].clientId !== oldMessages[0].clientId;
        const isAppend = newMessages[newMessages.length - 1].clientId !== oldMessages[oldMessages.length - 1].clientId;
        
        if (isPrepend) {
            // 找到新增的消息
            const prependCount = newMessages.findIndex(m => m.clientId === oldMessages[0].clientId);
            const prepended = newMessages.slice(0, prependCount);
            this._virtualScroll?.prependItems(prepended);
        } else if (isAppend) {
            // 找到新增的消息
            const appendStart = oldMessages.length;
            const appended = newMessages.slice(appendStart);
            this._virtualScroll?.appendItems(appended);
        }
    }
    
    this._messages = newMessages;
    this._hasMore = data.hasMore;
    this._isLoadingMore = data.isLoadingMore;
}
```

### 3. 虚拟滚动的 onLoadMore 回调

**替代手动的 _handleLoadMoreClick**

```typescript
private async _handleVirtualScrollLoadMore(
    direction: 'top' | 'bottom',
    boundary: WindowBoundary
): Promise<Message[]> {
    if (!this.sessionId || !this.messageController) return [];
    
    try {
        if (direction === 'top') {
            if (!boundary.firstId) return [];
            // 调用现有的 loadMoreForSession，它会使用 boundary.firstId 作为锚点
            await this.messageController.loadMoreForSession(this.sessionId);
            // 返回新加载的消息（通过比较 _messages 的变化）
            // 这里需要一个机制来捕获新加载的消息
            return this._captureLoadedMessages(direction, boundary);
        } else {
            if (!boundary.lastId) return [];
            // 向下加载更多（如果有这个功能）
            return [];
        }
    } catch (err) {
        console.error('[rtc-message-list] loadMore failed:', err);
        return [];
    }
}
```

**问题**：现有的 `messageController.loadMoreForSession()` 是通过 repository 订阅来更新 `_messages` 的，不是直接返回消息。需要一个机制来捕获新加载的消息。

**解决方案**：在调用 loadMore 前记录当前的 firstId/lastId，加载后比较差集。

```typescript
private async _handleVirtualScrollLoadMore(
    direction: 'top' | 'bottom',
    boundary: WindowBoundary
): Promise<Message[]> {
    if (!this.sessionId || !this.messageController) return [];
    
    const beforeMessages = [...this._messages];
    
    if (direction === 'top') {
        if (!boundary.firstId) return [];
        await this.messageController.loadMoreForSession(this.sessionId);
        
        // 等待 repository 订阅更新 _messages
        await this.updateComplete;
        
        // 找到新增的消息（在 beforeMessages 之前的）
        const newMessages = this._messages.filter(m => 
            !beforeMessages.some(bm => bm.clientId === m.clientId)
        );
        
        return newMessages;
    }
    
    return [];
}
```

### 4. 保留自动滚动机制

**ResizeObserver 需要适配**

```typescript
// 现有逻辑：观察 inner container 的大小变化
// 改造后：仍然观察 .message-list-inner，但 virtual scroll 会频繁修改它
// 需要确保 virtual scroll 的操作不会触发不必要的自动滚动

private _setupResizeObserver() {
    const inner = this.shadowRoot!.querySelector('.message-list-inner') as HTMLElement;
    if (inner) {
        this._resizeObserver = new ResizeObserver(() => {
            // 只有在用户意图是自动滚动时才滚动
            if (!this._shouldAutoScroll) return;
            
            // 去抖：避免 virtual scroll 的频繁操作触发过多滚动
            clearTimeout(this._resizeDebounceTimer);
            this._resizeDebounceTimer = window.setTimeout(() => {
                if (this._shouldAutoScroll) {
                    this._virtualScroll?.scrollToBottom();
                }
            }, 100);
        });
        this._resizeObserver.observe(inner);
    }
}
```

### 5. 移除冗余的 load-more 按钮

**现有的 `_handleLoadMoreClick` 和 `_preserveScrollPosition` 可以移除**，因为 `MessageVirtualScroll` 已经内置了自动 load-more 和 ScrollSaver 机制。

但是，可以保留按钮作为 UI 提示，点击时触发 virtual scroll 的 load-more：

```typescript
private _handleLoadMoreClick = async () => {
    if (this._isLoadingMore || !this._virtualScroll) return;
    
    // 触发 virtual scroll 的 load-more（通过模拟滚动到顶部）
    // 或者直接调用 virtual scroll 的内部方法
    const boundary = this._virtualScroll.getStats();
    if (boundary.firstId) {
        await this._handleVirtualScrollLoadMore('top', {
            firstId: boundary.firstId,
            lastId: boundary.lastId,
        });
    }
};
```

### 6. render() 简化

**不再用 repeat() 渲染消息，只提供容器**

```typescript
render() {
    void this._localeCtx.locale;
    void this._userAtBottom;
    
    return html`
        <div class="message-list-scroll" part="scroll">
            <div class="message-list-inner" part="inner">
                <!-- MessageVirtualScroll 会在这里动态插入消息元素 -->
            </div>
        </div>
        <button
            class="load-more-btn"
            ?hidden=${!this._showLoadMoreBtn}
            ?disabled=${this._isLoadingMore}
            @click=${this._handleLoadMoreClick}
            aria-label="Load earlier messages"
        >${this._isLoadingMore ? msg('Loading...') : msg('↑ Load earlier messages')}</button>
        <button
            class="new-message-btn"
            ?hidden=${!this._showNewBtn}
            @click=${this._handleNewBtnClick}
        >${msg('↓ New messages')}</button>
    `;
}
```

### 7. 消息元素渲染

**提供渲染函数给 MessageVirtualScroll**

**需求变更**：Toolcall input 和 output 分开展示，不做 pairing。

```typescript
private _renderMessageElement(msg: Message, index: number): HTMLElement {
    const isLast = index === this._messages.length - 1;
    
    // 根据消息类型创建对应的组件
    if (msg.content?.type === 'error') {
        const el = document.createElement('rtc-error-message');
        el.setAttribute('data-client-id', msg.clientId);
        (el as any).message = msg;
        return el;
    }
    
    // Toolcall input 和 output 分开展示
    if (msg.content?.type === 'toolcall_input' || msg.content?.type === 'toolcall_output') {
        const el = document.createElement('rtc-message');
        el.setAttribute('data-client-id', msg.clientId);
        (el as any).message = msg;
        if (isLast) {
            el.setAttribute('is-last', '');
        }
        return el;
    }
    
    if (msg.role === 'user') {
        const el = document.createElement('rtc-user-message');
        el.setAttribute('data-client-id', msg.clientId);
        (el as any).message = msg;
        return el;
    }
    
    // assistant message
    const el = document.createElement('rtc-message');
    el.setAttribute('data-client-id', msg.clientId);
    (el as any).message = msg;
    if (isLast) {
        el.setAttribute('is-last', '');
    }
    return el;
}
```

**注意**：使用 `document.createElement()` 绕过了 Lit 的响应式系统。如果消息内容会动态更新（如 streaming），需要在消息更新时手动触发重新渲染，或者改用 Lit 的 `render()` 函数。

### 8. 多实例支持（参考 debug html）

**外层容器负责多实例布局，rtc-message-list 本身不需要改动**

```css
/* 在父组件（如 rtc-content-area）中 */
.tab-content-wrapper {
    flex: 1;
    position: relative;
    overflow: hidden;
}

rtc-message-list {
    display: flex;
    flex-direction: column;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
}

rtc-message-list:not(.active) {
    content-visibility: hidden;
    contain-intrinsic-size: 0 500px;
    pointer-events: none;
}
```

## 改造步骤

1. **添加 MessageVirtualScroll 依赖**
   - 导入 MessageVirtualScroll 和相关类型

2. **修改 firstUpdated**
   - 初始化 MessageVirtualScroll 实例
   - 设置 ResizeObserver 观察 inner container

3. **修改 _subscribeToSession 和 _handleMessagesUpdate**
   - 将 repository 订阅的变化转换为 virtual scroll 的操作
   - setItems / prependItems / appendItems

4. **实现 _handleVirtualScrollLoadMore**
   - 处理 virtual scroll 的 onLoadMore 回调
   - 调用 messageController.loadMoreForSession
   - 返回新加载的消息

5. **实现 _renderMessageElement**
   - 根据消息类型创建对应的 DOM 元素
   - 设置 data-client-id 属性

6. **简化 render()**
   - 移除 repeat() 渲染
   - 只提供容器结构

7. **移除冗余代码**
   - _preserveScrollPosition（virtual scroll 用 ScrollSaver）
   - _captureAnchorInfo（virtual scroll 内部处理）
   - 相关的 anchor 逻辑

8. **测试**
   - 初始加载
   - 向上滚动加载更多
   - 向下滚动（如果有）
   - 新消息自动滚动
   - 多实例切换

## 关键注意事项

1. **ScrollSaver vs 现有的 anchor 机制**
   - Virtual scroll 使用 Telegram 的 ScrollSaver
   - 现有的 _preserveScrollPosition 是基于 visualTop 的
   - 两者应该兼容，但需要测试

2. **ResizeObserver 的触发频率**
   - Virtual scroll 会频繁修改 DOM，可能触发大量 ResizeObserver 回调
   - 需要合理的去抖（100ms）

3. **消息更新的检测**
   - 现有逻辑通过比较 _messages 数组来检测 prepend/append
   - 需要确保 virtual scroll 的操作与 repository 订阅同步

4. **性能优化**
   - Virtual scroll 的 viewport slicing 应该能显著提升性能
   - 多实例的 content-visibility: hidden 可以进一步优化

## 参考

- Debug HTML: `packages/component/debug/message-list-virtual.html`
- MessageVirtualScroll: `packages/component/src/utils/message-virtual-scroll.ts`
- ScrollSaver: `packages/component/src/utils/scroll-saver.ts`
- Telegram Web: `/tmp/telegram-web/telegram-webk/src/components/chat/bubbles.ts`
