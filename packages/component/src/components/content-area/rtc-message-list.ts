/**
 * RTC Message List Component
 *
 * Renders messages in a scrollable container with timeline layout.
 * Uses @lit-labs/virtualizer for virtual scrolling with automatic
 * dynamic-height handling via ResizeObserver.
 *
 * ## Auto-scroll mechanism
 *
 * 1. **`updated()` reacts to context changes** — two triggers:
 *    - `_sessionCtx` changed (session switch) → reset follow intent to true
 *    - `_ctx` changed (messages changed) → scroll to bottom if following
 *
 * 2. **`_handleScroll` (template-bound) tracks scroll position** — via RAF throttling:
 *    - Updates "New messages" button visibility based on distance from bottom
 *    - Auto-triggers `loadMore()` when scrollTop < threshold
 *
 * 3. **ResizeObserver (built into @lit-labs/virtualizer)** handles async content:
 *    - Markdown rendering, thinking expansion, tool-call card resizing
 *    - Scrolls to bottom only if `_shouldAutoScroll` is true.
 *
 * @element rtc-message-list
 */
import {LitElement, html, type TemplateResult} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {localized, msg} from '@lit/localize';
import {query} from 'lit/decorators/query.js';
import {localeContext, type LocaleContextValue, sourceLocale, targetLocales} from '../../core/i18n.js';
import '@lit-labs/virtualizer';
import type {LitVirtualizer} from '@lit-labs/virtualizer';
import {styles} from './rtc-message-list.styles.js';
import {MessageContext, type MessageContextValue} from '../../contexts/message.js';
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import {SettingsContext, type SettingsContextValue} from '../../contexts/settings.js';
import type {Message} from '../../types/index.js';
import './rtc-message.js';
import './rtc-user-message.js';
import './rtc-toolcall-card.js';
import './rtc-error-message.js';
import type {RenderItem} from './types.js';

/**
 * 虚拟滚动配置常量
 *
 * 集中管理虚拟滚动相关的阈值与缓冲参数，
 * 避免在组件内散落 magic number，便于统一调优。
 */
const VIRTUAL_SCROLL_CONFIG = {
  /** "在底部"判定阈值（px） */
  SCROLL_END_THRESHOLD: 80,
  /** 自动加载历史触发阈值（px），scrollTop 小于此值时触发 loadMore */
  AUTO_LOAD_MORE_THRESHOLD: 120,
  /** "靠近顶部"判定阈值（px），用于控制 "Load more" 按钮显示 */
  NEAR_TOP_THRESHOLD: 60,
  /** Safari 橡皮筋回弹等待延迟（ms） */
  SAFARI_BOUNCE_DELAY: 200,
} as const;


@localized()
@customElement('rtc-message-list')
export class RtcMessageList extends LitElement {
    static styles = styles;

    @query('lit-virtualizer')
    private _virtualizerEl!: LitVirtualizer;

    @consume({context: localeContext, subscribe: true})
    @state()
    private _localeCtx: LocaleContextValue = {
        locale: sourceLocale,
        setLocale: async () => {
            console.warn('[RtcMessageList] Locale context not initialized');
        },
        locales: [sourceLocale, ...targetLocales],
    };

    @consume({context: MessageContext, subscribe: true})
    @state()
    private _ctx: MessageContextValue = {
        state: {messages: [], hasMore: false, isLoadingMore: false},
        actions: {sendMessage: async () => {}, resendMessage: async () => {}, forkSession: async () => {}, appendToLastMessage: () => {}, finalizeLastMessage: () => {}, clearMessages: () => {}, loadMore: async () => {}}
    };

    @consume({context: SessionContext, subscribe: true})
    @state()
    private _sessionCtx: SessionContextValue = {
        state: {sessions: [], currentSessionId: null},
        actions: {
            createSession: () => '',
            switchSession: () => {},
            renameSession: async () => ({ok: true, error: ''}),
            deleteSession: async () => ({ok: true, error: ''}),
            closeSession: async () => ({ok: true}),
            reopenSession: async () => ({ok: true}),
            reset: () => {},
            clearCurrentSession: () => {},
            setCurrentSession: () => {},
            setSessions: () => {},
        },
    };

    /** Previous session ID, used to detect session switches (tab activation). */
    private _prevSessionId: string | null = null;

    @consume({context: SettingsContext, subscribe: true})
    @state()
    private _settingsCtx: SettingsContextValue = {
        state: {
            appearance: {theme: 'system', fontSize: 14},
            chat: {sendShortcut: 'Enter', density: 'comfortable'},
            files: {autoSave: true, defaultViewMode: 'split'},
            notifications: {soundEnabled: true, toastEnabled: true},
        },
        actions: {
            updateAppearance: () => {},
            updateChat: () => {},
            updateFiles: () => {},
            updateNotifications: () => {},
            resetAll: () => {},
        },
    };

    @state()
    private _showNewBtn = false;

    @state()
    private _showLoadMoreBtn = false;

    /**
     * Whether the user intends to follow new content ("follow mode").
     *
     * This is a **mutable flag** representing user intent, NOT scroll position.
     * It is set by:
     * - `_handleNewBtnClick` — user explicitly clicks "New messages" → true
     * - Session switch — user expects to see latest messages → true
     *
     * It is NOT set by `scrollToBottom()` — system actions
     * don't change intent. This separation prevents async code from overwriting
     * user intent.
     *
     * Consumed by: `updated()`, `_onVisibilityChange`.
     */
    private _shouldAutoScroll = true;

    /**
     * 用户当前可见的最后一条消息 ID。
     *
     * 用于判断用户是否在看最新消息：
     * - 如果等于最后一条消息的 ID，说明用户在看最新消息，应该自动跟随
     * - 如果不等于，说明用户在查看历史，不应该自动滚动
     *
     * 在 `_handleScroll` 中更新。
     */
    private _lastVisibleMessageId: string | null = null;

    /** 上一次更新时的最后一条消息 ID，用于检测新消息是否追加。 */
    private _prevLastMessageId: string | null = null;

    /** RAF 节流标志，避免 _handleScroll 每帧重复调度按钮可见性更新 */
    private _scrollRafPending = false;

    /** Bound visibilitychange handler for cleanup. */
    private _boundOnVisibilityChange = this._onVisibilityChange.bind(this);

    /** 缓存的渲染项数组。在 willUpdate() 中通过 _buildRenderItems() 预计算。 */
    private _renderItems: RenderItem[] = [];

    /** Previous messages count, used to detect message truncation/clearing. */
    private _prevMessagesCount = 0;

    /** Stable renderItem function reference. */
    private _renderItemFn = (item: RenderItem): TemplateResult => {
        const lastKey = this._renderItems[this._renderItems.length - 1]?.key;
        return this._renderMessageItem(item, lastKey);
    };

    /** Stable keyFunction reference. */
    private _keyFn = (item: RenderItem) => item.key;

    get messages(): Message[] {
        return this._ctx.state.messages;
    }

    /**
     * 滚动到底部
     *
     * 公共方法，供父组件或外部调用。
     * 通过设置 lit-virtualizer 的 scrollTop = scrollHeight 实现。
     */
    scrollToBottom() {
        const el = this._virtualizerEl;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }

    /**
     * 跳转到特定消息
     *
     * @param clientId - 消息的 clientId
     *
     * 必须在 _renderItems 中查找索引，而非 messages。
     * 因为虚拟器的索引对应 _renderItems 数组。
     */
    scrollToMessage(clientId: string) {
        const index = this._renderItems.findIndex(item => item.key === clientId);
        if (index >= 0) {
            this._virtualizerEl?.scrollToIndex(index, 'center');
        }
    }

    protected willUpdate(changed: Map<string, unknown>): void {
        // 构建 _renderItems
        if (changed.has('_ctx') || changed.has('messages')) {
            this._renderItems = this._buildRenderItems(this.messages);
        }
    }

    async firstUpdated() {
        // 等待 DOM 更新完成，确保 lit-virtualizer 已连接
        await this.updateComplete;

        // 等待 virtualizer 完成首次布局
        // 捕获拒绝（例如 jsdom 测试中元素在布局完成前被卸载会触发 "disconnected"），
        // 避免产生 Unhandled Promise Rejection。
        if (this._virtualizerEl?.layoutComplete) {
            try {
                await this._virtualizerEl.layoutComplete;
            } catch {
                // 布局未完成不影响后续流程；滚动操作已对 null/空布局做容错处理
            }
        }

        // 滚动到底部（使用重试版本，确保真正到达底部）
        this._scrollToBottomWithRetry();

        // 快照初始 session ID
        this._prevSessionId = this._sessionCtx.state.currentSessionId;

        // Visibility change: when the page becomes visible again (e.g., user switches
        // back to this browser tab), scroll to bottom if following. This handles the
        // case where the user was away and content may have changed.
        document.addEventListener('visibilitychange', this._boundOnVisibilityChange);
    }

    /**
     * Auto-scroll decision point.
     *
     * The component is responsible for its own scrolling. It does not analyze
     * what kind of change happened (growth, shrink, reorder, toolcall merge, etc.).
     * It only asks two questions:
     *
     * 1. **Did messages change?** (`_ctx` changed) → if following, scroll to bottom.
     * 2. **Did session change?** (`_sessionCtx` changed) → reset follow intent to true,
     *    then scroll to bottom (user expects to see latest messages in a new session).
     *
     * Load-more (prepend) is a special case: preserve scroll position via anchor.
     */
    updated(changed: Map<string, unknown>) {
        super.updated(changed);

        // Set density attribute for CSS styling
        const density = this._settingsCtx.state.chat.density;
        this.setAttribute('data-density', density);

        // --- Session switch: enable follow mode and scroll to bottom ---
        const currSessionId = this._sessionCtx.state.currentSessionId;
        if (changed.has('_sessionCtx') && currSessionId !== this._prevSessionId) {
            this._prevSessionId = currSessionId;
            this._shouldAutoScroll = true;
            this._scrollToBottomWithRetry();
            this._showNewBtn = false;
            this._showLoadMoreBtn = false;
        }

        // --- Messages changed: scroll if following ---
        if (changed.has('_ctx')) {
            if (this._anchorInfo) {
                // Load-more (prepend): preserve scroll position using anchor
                this._preserveScrollPosition();
                this._anchorInfo = null;
            } else if (this._shouldAutoScroll && this._lastVisibleMessageId === this._prevLastMessageId) {
                // 用户之前在看最后一条消息，新消息到来时自动滚动
                this._scrollToBottomWithRetry();
            }
        }

        // --- Update load-more button visibility ---
        this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();

        // 更新最后一条消息 ID，用于下次判断
        const msgs = this._ctx.state.messages;
        this._prevLastMessageId = msgs.length > 0 ? msgs[msgs.length - 1].clientId : null;

        // 检测消息清空（如 session reset / clearMessages）
        if (changed.has('_ctx') && msgs.length === 0 && this._prevMessagesCount > 0) {
            this._shouldAutoScroll = true;
        }
        this._prevMessagesCount = msgs.length;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('visibilitychange', this._boundOnVisibilityChange);
    }

    /**
     * Visibility change handler.
     *
     * When the page becomes visible again, scroll to bottom if the user
     * intends to follow.
     */
    private _onVisibilityChange() {
        if (document.visibilityState === 'visible' && this._shouldAutoScroll) {
            requestAnimationFrame(() => {
                if (this._shouldAutoScroll) {
                    this._scrollToBottomWithRetry();
                }
            });
        }
    }

    private _isNearTop(): boolean {
        const el = this._virtualizerEl;
        if (!el) return false;
        return el.scrollTop < VIRTUAL_SCROLL_CONFIG.NEAR_TOP_THRESHOLD;
    }

    private _isNearBottom(): boolean {
        const el = this._virtualizerEl;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < VIRTUAL_SCROLL_CONFIG.SCROLL_END_THRESHOLD;
    }

    private async _handleLoadMoreClick() {
        if (this._ctx.state.isLoadingMore) return;

        // Safari 橡皮筋防护：scrollTop < 0 表示处于回弹状态，延迟 prepend
        const el = this._virtualizerEl;
        if (el && el.scrollTop < 0) {
            await new Promise(resolve => setTimeout(resolve, VIRTUAL_SCROLL_CONFIG.SAFARI_BOUNCE_DELAY));
            if (!el || el.scrollTop < 0) return;
        }

        this._showLoadMoreBtn = false;

        // Record the anchor element and its visual position before loading
        this._anchorInfo = this._captureAnchorInfo();

        await this._ctx.actions.loadMore();
    }

    /** Anchor info captured before loadMore for scroll position preservation. */
    private _anchorInfo: {clientId: string; visualTop: number} | null = null;

    /**
     * Capture the first visible message's clientId and its position
     * relative to the scroll container viewport.
     */
    private _captureAnchorInfo(): {clientId: string; visualTop: number} | null {
        const el = this._virtualizerEl;
        if (!el) return null;
        const scrollRect = el.getBoundingClientRect();
        const children = el.querySelectorAll('[data-client-id]');
        for (const child of children) {
            const rect = child.getBoundingClientRect();
            // First child whose top is at or below the scroll container's top
            if (rect.top >= scrollRect.top - 10) {
                return {
                    clientId: child.getAttribute('data-client-id') ?? '',
                    visualTop: rect.top - scrollRect.top,
                };
            }
        }
        return null;
    }

    /**
     * After prepending older messages, scroll so the anchor message stays
     * at the same visual position within the viewport.
     */
    private _preserveScrollPosition() {
        const el = this._virtualizerEl;
        if (!el || !this._anchorInfo) return;

        const anchorId = this._anchorInfo.clientId;
        const desiredVisualTop = this._anchorInfo.visualTop;

        this.updateComplete.then(async () => {
            // Wait for virtualizer layout to complete
            if (el.layoutComplete) {
                try {
                    await el.layoutComplete;
                } catch {
                    // 布局未完成时保持原 anchor 位置即可，无需回退
                }
            }

            // Find the anchor element after prepend
            const anchorEl = el.querySelector(`[data-client-id="${anchorId}"]`) as HTMLElement | null;
            if (anchorEl) {
                const scrollRect = el.getBoundingClientRect();
                const anchorRect = anchorEl.getBoundingClientRect();
                const currentVisualTop = anchorRect.top - scrollRect.top;

                // Adjust scrollTop so anchor returns to its pre-load visual position
                el.scrollTop += (currentVisualTop - desiredVisualTop);
            }

            // Re-evaluate load-more button after scroll adjustment
            this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();
        });
    }

    private _handleNewBtnClick() {
        this._shouldAutoScroll = true;
        this._scrollToBottomWithRetry();
    }

    /**
     * 平滑滚动到底部，并循环验证是否真正到达底部。
     *
     * lit-virtualizer 可能需要异步渲染，导致一次滚动无法真正到达底部。
     * 此方法会循环检查，直到真正到达底部或达到最大尝试次数。
     */
    private _scrollToBottomWithRetry() {
        const el = this._virtualizerEl;
        if (!el) return;

        let attempts = 0;
        const maxAttempts = 5;

        const tryScroll = () => {
            if (attempts >= maxAttempts) return;

            // 平滑滚动到底部
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });

            // 延迟检查是否到达底部（等待动画完成）
            setTimeout(() => {
                if (!this._isNearBottom()) {
                    attempts++;
                    tryScroll();
                }
            }, 400); // 等待 400ms 让动画完成
        };

        tryScroll();
    }

    render() {
        void this._localeCtx.locale;

        return html`
      <lit-virtualizer
        class="message-list-scroll"
        scroller
        .items=${this._renderItems}
        .renderItem=${this._renderItemFn}
        .keyFunction=${this._keyFn}
        @scroll=${this._handleScroll}
      ></lit-virtualizer>

      <!-- Load more 按钮 -->
      <button
        class="load-more-btn"
        ?hidden=${!this._showLoadMoreBtn}
        ?disabled=${this._ctx.state.isLoadingMore}
        @click=${this._handleLoadMoreClick}
      >${this._ctx.state.isLoadingMore ? msg('Loading...') : msg('↑ Load earlier messages')}</button>

      <!-- New messages 按钮 -->
      <button
        class="new-message-btn"
        ?hidden=${!this._showNewBtn}
        @click=${this._handleNewBtnClick}
      >${msg('↓ New messages')}</button>
    `;
    }

    /**
     * Build render items from the flat message list.
     *
     * Pairs toolcall_input + toolcall_output into a single ToolCallPair.
     * Output messages that are paired are excluded from the render list.
     * Error messages are routed to their own render type.
     *
     * Returns ordered render items: user | assistant | toolcall | error.
     */
    private _buildRenderItems(msgs: Message[]): RenderItem[] {
        // 1. Build a map: input clientId -> output Message (for quick lookup)
        const inputToOutput = new Map<string, Message>();
        for (const m of msgs) {
            if (m.content?.type === 'toolcall_output' && m.parentClientId) {
                inputToOutput.set(m.parentClientId, m);
            }
        }

        const items: RenderItem[] = [];

        for (const m of msgs) {
            if (m.content?.type === 'toolcall_output') {
                // Output is rendered as part of its input pair, skip standalone
                continue;
            }

            if (m.content?.type === 'error') {
                items.push({type: 'error', key: m.clientId, message: m});
            } else if (m.content?.type === 'toolcall_input') {
                items.push({
                    type: 'toolcall',
                    key: m.clientId,
                    pair: {input: m, output: inputToOutput.get(m.clientId)},
                });
            } else if (m.role === 'user') {
                items.push({type: 'user', key: m.clientId, message: m});
            } else {
                items.push({type: 'assistant', key: m.clientId, message: m});
            }
        }

        return items;
    }

    /**
     * 处理滚动容器的 scroll 事件。
     *
     * 职责：
     * 1. 通过 RAF 节流更新按钮可见性（"New messages" / "Load more"）
     * 2. 当滚动到顶部附近且存在更多历史时，自动触发加载
     * 3. 更新用户可见的最后一条消息 ID，用于自动滚动判断
     */
    private _handleScroll = () => {
        if (!this._virtualizerEl) return;

        // 更新用户可见的最后一条消息 ID
        this._updateLastVisibleMessageId();

        // 使用 RAF 节流更新按钮可见性
        if (!this._scrollRafPending) {
            this._scrollRafPending = true;
            requestAnimationFrame(() => {
                this._scrollRafPending = false;
                this._updateButtonVisibility();
            });
        }

        // 自动加载历史
        if (this._virtualizerEl.scrollTop < VIRTUAL_SCROLL_CONFIG.AUTO_LOAD_MORE_THRESHOLD
            && this._ctx.state.hasMore) {
            this._handleLoadMoreClick();
        }
    };

    /**
     * 更新自动滚动状态。
     *
     * 判断条件：
     * 1. 最后一条消息被虚拟列表渲染（在 DOM 中存在）
     * 2. 最后一条消息的底部在视口内（用户能看到消息结尾）
     *
     * 只有同时满足这两个条件，才启用自动滚动。
     */
    private _updateLastVisibleMessageId() {
        const el = this._virtualizerEl;
        if (!el) {
            this._shouldAutoScroll = false;
            return;
        }

        // 获取数据中的最后一条消息 ID
        const msgs = this._ctx.state.messages;
        const lastMsgId = msgs.length > 0 ? msgs[msgs.length - 1].clientId : null;
        if (!lastMsgId) {
            this._shouldAutoScroll = false;
            return;
        }

        // 检查最后一条消息是否被渲染
        const lastEl = el.querySelector(`[data-client-id="${lastMsgId}"]`);
        if (!lastEl) {
            // 最后一条消息没有被渲染，不在视口内
            this._shouldAutoScroll = false;
            return;
        }

        // 检查最后一条消息的底部是否在视口内
        const rect = lastEl.getBoundingClientRect();
        const scrollRect = el.getBoundingClientRect();

        if (rect.bottom <= scrollRect.bottom) {
            // 最后一条消息的底部在视口内，用户能看到消息结尾
            this._lastVisibleMessageId = lastMsgId;
            this._shouldAutoScroll = true;
        } else {
            // 最后一条消息的底部不在视口内
            this._shouldAutoScroll = false;
        }
    }

    /**
     * 根据当前滚动位置更新按钮可见性。
     * 由 _handleScroll 通过 RAF 节流调用。
     */
    private _updateButtonVisibility() {
        this._showNewBtn = !this._isNearBottom();
        this._showLoadMoreBtn = this._ctx.state.hasMore && this._isNearTop();
    }

    /**
     * 根据渲染项类型路由到不同的消息组件。
     *
     * 使用 switch + never 穷尽检查，确保添加新 RenderItem 类型时
     * 编译器会报错提醒更新此方法。
     *
     * 每个消息组件用 div.message-item 包装，确保宽度 100% 并统一 padding。
     *
     * @param item - 渲染项（经过 _buildRenderItems 处理后的消息表示）
     * @param lastKey - 最后一个渲染项的 key，用于标记 is-last 属性
     *                  （仅 assistant 消息需要，以隐藏尾部间距）
     */
    private _renderMessageItem(item: RenderItem, lastKey: string | undefined) {
        switch (item.type) {
            case 'user':
                return html`
                    <div class="message-item">
                        <rtc-user-message
                            data-client-id=${item.message.clientId}
                            .message=${item.message}
                        ></rtc-user-message>
                    </div>
                `;
            case 'toolcall':
                return html`
                    <div class="message-item">
                        <rtc-toolcall-card
                            data-client-id=${item.pair.input.clientId}
                            .pair=${item.pair}
                        ></rtc-toolcall-card>
                    </div>
                `;
            case 'error':
                return html`
                    <div class="message-item">
                        <rtc-error-message
                            data-client-id=${item.message.clientId}
                            .message=${item.message}
                        ></rtc-error-message>
                    </div>
                `;
            case 'assistant':
                return html`
                    <div class="message-item">
                        <rtc-message
                            data-client-id=${item.message.clientId}
                            .message=${item.message}
                            ?is-last=${item.key === lastKey}
                        ></rtc-message>
                    </div>
                `;
            default: {
                const _exhaustive: never = item;
                console.warn('[RtcMessageList] Unknown render item type:', _exhaustive);
                return html``;
            }
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-message-list': RtcMessageList;
    }
}
