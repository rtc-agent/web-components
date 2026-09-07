/**
 * RTC Chat Layout Component
 *
 * 两栏布局的对话页面：
 * - 左栏：rtc-session-tree（会话树）
 * - 右栏：rtc-session-tab-bar（Tab 标签栏）+ 聊天内容区
 *
 * 点击会话树节点 → 打开/切换 Tab → 聊天内容区显示该 session 的消息。
 *
 * 聊天内容区复用现有组件（rtc-content-area / rtc-notice-bar /
 * rtc-input-area / rtc-overlay-manager），通过 SessionContext 的
 * currentSessionId 切换不同 session。
 *
 * @element rtc-chat-layout
 * @fires rtc-chat-layout-session-select - 用户点击会话树节点 (detail: { sessionId })
 * @fires rtc-chat-layout-tab-activate - 用户切换 Tab (detail: { sessionId })
 * @fires rtc-chat-layout-tab-close - 用户关闭 Tab (detail: { sessionId })
 * @fires rtc-fork-initiated - 分叉请求编排完成 (detail: { oldSessionClientId, oldMessageClientId, newSessionClientId, content })
 * @fires rtc-new-session - 新建会话（含全部关闭后自动创建）
 */
import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {styles} from './rtc-chat-layout.styles.js';
import {tokens} from '../../styles/tokens.js';
import {lightTheme} from '../../styles/themes/light.js';
import {darkTheme} from '../../styles/themes/dark.js';
import {baseStyles} from '../../styles/base.js';

// Contexts
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import {SessionTabContext, type SessionTabContextValue} from '../../contexts/session-tab.js';

// Child components
import '../session-tree/rtc-session-tree.js';
import '../session-tree/rtc-session-tab-bar.js';
import '../content-area/rtc-content-area.js';
import '../notice-bar/rtc-notice-bar.js';
import '../input-area/rtc-input-area.js';
import '../overlay/rtc-overlay-manager.js';

@customElement('rtc-chat-layout')
export class RtcChatLayout extends LitElement {
    static styles = [tokens, lightTheme, darkTheme, baseStyles, styles];

    /* ── Properties ── */

    /** 主题：light / dark / system */
    @property({type: String, reflect: true})
    theme: 'light' | 'dark' | 'system' = 'system';

    /* ── Context ── */

    @consume({context: SessionContext, subscribe: true})
    @property({attribute: false})
    private _sessionCtx: SessionContextValue = {
        state: {sessions: [], currentSessionId: null},
        actions: {
            createSession: () => '',
            switchSession: () => {},
            renameSession: () => {},
            deleteSession: () => {},
            reset: () => {},
            clearCurrentSession: () => {},
            setCurrentSession: () => {},
            setSessions: () => {},
        },
    };

    @consume({context: SessionTabContext, subscribe: true})
    @property({attribute: false})
    private _tabCtx: SessionTabContextValue = {
        state: {tabs: [], activeSessionId: null},
        actions: {
            openOrActivate: () => {},
            closeTab: () => {},
            setActiveTab: () => {},
            clearAll: () => {},
            updateTabTitles: () => {},
            markSaved: () => {},
            findUnsavedTab: () => undefined,
        },
    };

    /* ── Lifecycle ── */

    connectedCallback() {
        super.connectedCallback();
        // 监听 rtc-message-sent：事件从 rtc-agent（父组件）派发，
        // 向上冒泡到 document。chat-layout 必须在 document 上监听，
        // 因为事件不会向下传播到 shadow DOM 中的子组件。
        document.addEventListener('rtc-message-sent', this._boundOnMessageSent);
        // 监听 fork 请求：事件从聊天内容区的消息组件冒泡上来，
        // 在 chat-layout 自身上拦截以编排 unsaved tab + 派发 rtc-fork-initiated
        this.addEventListener('rtc-fork-requested', this._boundOnForkRequested);
        // 监听 rtc-session-tree-new：捕获 session-header "+" 按钮冒泡上来的事件
        // （Phase 6 改 session-header 后生效；Phase 3 先接好监听）
        this.addEventListener('rtc-session-tree-new', this._handleSessionTreeNew);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('rtc-message-sent', this._boundOnMessageSent);
        this.removeEventListener('rtc-fork-requested', this._boundOnForkRequested);
        this.removeEventListener('rtc-session-tree-new', this._handleSessionTreeNew);
    }

    /**
     * 核心编排：确保存在一个 unsaved tab
     *
     * - 已有 unsaved tab → 激活它，返回其 sessionId
     * - 没有 → 创建新 session + 开 unsaved tab，返回 newId
     *
     * 同步方法（无 await），保证双击 "+" 幂等：
     * 第二次调用时 findUnsavedTab 立即返回已有 tab。
     */
    private _ensureUnsavedSession(): string {
        const existing = this._tabCtx.actions.findUnsavedTab();
        if (existing) {
            this._sessionCtx.actions.switchSession(existing.sessionId);
            this._tabCtx.actions.setActiveTab(existing.sessionId);
            console.log('[chat-layout._ensureUnsavedSession] Reusing unsaved tab:', existing.sessionId);
            return existing.sessionId;
        }
        // createSession 同步返回新 ID（规避 context 异步传播读不到新 currentSessionId 的问题）
        const newId = this._sessionCtx.actions.createSession();
        // 关键：触发 onSessionSwitch 以加载新 session 的消息（空）并清理旧消息
        // createSession 本身不调用 onSessionSwitch，需要手动 switchSession 触发
        this._sessionCtx.actions.switchSession(newId);
        this._tabCtx.actions.openOrActivate(newId, 'Untitled', {isUnsaved: true});
        console.log('[chat-layout._ensureUnsavedSession] Created new unsaved tab:', newId);
        return newId;
    }

    private _boundOnForkRequested = (e: Event) => {
        // Fork 流程：用户提交了分叉对话的消息
        // 1. 通过 _ensureUnsavedSession 复用/新建 unsaved tab
        // 2. 派发 rtc-fork-initiated 携带完整分叉元数据，由 rtc-agent 接线到 ForkController
        const {oldMessageClientId, content} = (e as CustomEvent).detail ?? {};
        const oldSessionClientId = this._sessionCtx.state.currentSessionId;
        if (!oldSessionClientId) {
            console.warn('[chat-layout._boundOnForkRequested] No current session, ignoring fork');
            return;
        }
        const newSessionClientId = this._ensureUnsavedSession();
        this.dispatchEvent(
            new CustomEvent('rtc-fork-initiated', {
                bubbles: true,
                composed: true,
                detail: {
                    oldSessionClientId,
                    oldMessageClientId,
                    newSessionClientId,
                    content,
                },
            })
        );
        console.log('[chat-layout._boundOnForkRequested] Dispatched rtc-fork-initiated, newSession=', newSessionClientId);
    };

    private _boundOnMessageSent = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        const sessionClientId = detail?.message?.session_client_id;
        if (!sessionClientId) return;

        // 标记 tab 为已保存（unsaved → saved 的单向跃迁）
        this._tabCtx.actions.markSaved(sessionClientId);

        // 兜底：确保 tab 存在（覆盖从 session tree 点击打开但尚未建 tab 的场景）
        this._ensureTabForSession(sessionClientId);
    };

    /** session-header / session-tree "+" 按钮事件透传到 _handleNewSession */
    private _handleSessionTreeNew = () => {
        console.log('[chat-layout._handleSessionTreeNew] Event received, calling _handleNewSession');
        this._handleNewSession();
    };

    /**
     * 为指定 session 打开或激活 Tab
     *
     * 从 SessionContext 的 sessions 列表中查找 session 以获取标题。
     * 如果 session 不存在（如新建会话还未持久化），使用 'Untitled' 作为占位标题。
     * 后续 `_loadSessions` 会通过 `updateTabTitles` 同步真实标题。
     */
    private _ensureTabForSession(sessionId: string) {
        const session = this._sessionCtx.state.sessions.find(
            s => s.clientId === sessionId
        );
        const title = session?.title || 'Untitled';
        this._tabCtx.actions.openOrActivate(sessionId, title);
        console.log('[chat-layout._ensureTabForSession] Opened tab:', sessionId, 'title:', `"${title}"`);
    }

    /* ── Event Handlers ── */

    /**
     * 点击会话树节点
     *
     * 1. 打开/切换到对应 Tab
     * 2. 切换 SessionContext 的 currentSessionId（触发聊天内容刷新）
     */
    private _handleTreeSelect(e: CustomEvent) {
        const {sessionId} = e.detail;

        // 打开或切换到 Tab（自动处理标题保护逻辑）
        this._ensureTabForSession(sessionId);

        // 切换 SessionContext（触发聊天内容刷新）
        this._sessionCtx.actions.switchSession(sessionId);

        this.dispatchEvent(
            new CustomEvent('rtc-chat-layout-session-select', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    /**
     * 点击展开/折叠（由 SessionTreeController 内部处理，此处无需额外逻辑）
     */
    private _handleTreeToggle() {
        // no-op
    }

    /**
     * 点击新建会话按钮
     *
     * 通过 _ensureUnsavedSession 保证 unsaved tab 唯一：
     * - 已有 unsaved tab → 聚焦它
     * - 没有 → 创建新 session + 开 unsaved tab
     *
     * 派发 rtc-new-session，由 rtc-agent 清 fork 状态。
     */
    private _handleNewSession() {
        this._ensureUnsavedSession();
        this.dispatchEvent(
            new CustomEvent('rtc-new-session', {bubbles: true, composed: true})
        );
    }

    /**
     * 切换 Tab
     *
     * 切换 SessionContext 的 currentSessionId。
     */
    private _handleTabActivate(e: CustomEvent) {
        const {sessionId} = e.detail;
        this._sessionCtx.actions.switchSession(sessionId);

        this.dispatchEvent(
            new CustomEvent('rtc-chat-layout-tab-activate', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );
    }

    /**
     * 关闭 Tab
     *
     * SessionTabController 会自动处理相邻 Tab 激活。
     * 如果关闭的是当前活动的 session，需要切换到新激活的 Tab；
     * 如果没有剩余 Tab（需求 4），立即调用 _handleNewSession 创建新 unsaved tab。
     *
     * 注意：不能通过 this._tabCtx.state 读取关闭后的状态，
     * 因为 @consume 的 context 更新是异步的（等 Lit 下一轮渲染）。
     * 此处同步计算剩余 Tab 来判断下一步。
     */
    private _handleTabClose(e: CustomEvent) {
        const {sessionId} = e.detail;
        const wasActive = this._sessionCtx.state.currentSessionId === sessionId;

        this.dispatchEvent(
            new CustomEvent('rtc-chat-layout-tab-close', {
                bubbles: true,
                composed: true,
                detail: {sessionId},
            })
        );

        if (wasActive) {
            // 同步计算：关闭这个 Tab 后还剩几个
            const remainingTabs = this._tabCtx.state.tabs.filter(
                t => t.sessionId !== sessionId
            );

            if (remainingTabs.length > 0) {
                // 还有 Tab：激活相邻的
                const closedIndex = this._tabCtx.state.tabs.findIndex(
                    t => t.sessionId === sessionId
                );
                const nextIndex = Math.min(closedIndex, remainingTabs.length - 1);
                const nextSessionId = remainingTabs[nextIndex].sessionId;
                this._sessionCtx.actions.switchSession(nextSessionId);
            } else {
                // 需求 4：全部关闭 → 立即创建新 unsaved session
                // 先清空旧 session 的消息/选中态（clearCurrentSession 会触发 onSessionSwitch 清理消息）
                this._sessionCtx.actions.clearCurrentSession();
                this._handleNewSession();
            }
        }
    }

    /* ── Render ── */

    private _renderChatContent() {
        return html`
            <div class="content-area">
                <rtc-content-area></rtc-content-area>
                <rtc-notice-bar></rtc-notice-bar>
                <rtc-input-area></rtc-input-area>
                <rtc-overlay-manager></rtc-overlay-manager>
            </div>
        `;
    }

    render() {
        return html`
            <!-- 左栏：会话树 -->
            <div class="sidebar">
                <rtc-session-tree
                    theme=${this.theme}
                    selected-session-id=${this._sessionCtx.state.currentSessionId ?? ''}
                    @rtc-session-tree-select=${this._handleTreeSelect}
                    @rtc-session-tree-toggle=${this._handleTreeToggle}
                ></rtc-session-tree>
            </div>

            <!-- 右栏：Tab + 聊天内容 -->
            <div class="main">
                <div class="tab-bar">
                    <rtc-session-tab-bar
                        theme=${this.theme}
                        @rtc-session-tab-bar-activate=${this._handleTabActivate}
                        @rtc-session-tab-bar-close=${this._handleTabClose}
                    ></rtc-session-tab-bar>
                </div>
                ${this._renderChatContent()}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'rtc-chat-layout': RtcChatLayout;
    }

    interface HTMLElementEventMap {
        'rtc-chat-layout-session-select': CustomEvent<{sessionId: string}>;
        'rtc-chat-layout-tab-activate': CustomEvent<{sessionId: string}>;
        'rtc-chat-layout-tab-close': CustomEvent<{sessionId: string}>;
    }
}
