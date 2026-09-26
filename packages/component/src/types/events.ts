/**
 * RtcAgent Event Type Map
 *
 * 通过全局扩展 HTMLElementEventMap 让 addEventListener 对 <rtc-agent>
 * 派发的自定义事件提供类型安全。
 *
 * 设计要点：
 * - 扩展而非重载：保留 HTMLElement 原生事件 + 内部事件（rtc-window-minimize 等）
 *   的类型推导，同时加入 rtc-agent-ready 等公开事件
 * - 新增公开事件只需在 RtcAgentEventMap 里添加一项即可
 *
 * @example
 * ```ts
 * const agent = document.querySelector<RtcAgent>('#agent')!;
 * agent.addEventListener('rtc-agent-ready', (e) => {
 *   e.detail;  // void — 类型安全
 * });
 * agent.addEventListener('click', (e) => {
 *   e.clientX;  // number — 原生事件仍然类型安全
 * });
 * agent.addEventListener('typo-event', ...);  // ✗ TS 报错
 * ```
 */

/**
 * 公开的自定义事件（供外部宿主应用监听）
 *
 * detail 类型说明：
 * - `void`：事件无 payload
 * - `T`：事件 payload 类型为 T
 */
export interface RtcAgentEventDetailMap {
  /** 组件首次渲染完成，可以安全地设置 agentConfig / registry */
  'rtc-agent-ready': void;
  /** 主题变化（属性变更或 system 跟随系统偏好变化时触发） */
  'rtc-theme-change': { theme: 'light' | 'dark' | 'system' };
  /** 组件即将从 DOM 移除（在 disconnectedCallback 清理逻辑之前触发） */
  'rtc-before-destroy': void;
  /** 消息发送前拦截（可通过 preventDefault() 取消发送，或修改 detail.message.content） */
  'rtc-before-message-send': { message: { content: string; metadata?: Record<string, unknown> } };
}

// 全局扩展 HTMLElementEventMap，使 addEventListener 自动支持这些事件
declare global {
  interface HTMLElementEventMap {
    'rtc-agent-ready': CustomEvent<RtcAgentEventDetailMap['rtc-agent-ready']>;
    'rtc-theme-change': CustomEvent<RtcAgentEventDetailMap['rtc-theme-change']>;
    'rtc-before-destroy': CustomEvent<RtcAgentEventDetailMap['rtc-before-destroy']>;
    'rtc-before-message-send': CustomEvent<RtcAgentEventDetailMap['rtc-before-message-send']>;
  }
}
