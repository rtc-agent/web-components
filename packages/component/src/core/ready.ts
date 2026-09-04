/**
 * Module Ready Signal
 *
 * 提供两种机制让宿主应用等待 <rtc-agent> 组件初始化完成：
 * 1. `whenReady()` Promise — ES module 风格
 * 2. `rtc-agent-ready` 自定义事件 — Web Component 风格（由 RtcAgent 组件派发）
 *
 * 内部使用：组件在 firstUpdated 时调用 _markReady()。
 */

let _resolve: () => void;
let _ready = false;

/**
 * 等待 <rtc-agent> 组件模块加载并初始化完成
 *
 * @example
 * ```ts
 * import { whenReady } from '@rtc-agent/component';
 * await whenReady();
 * const agent = document.querySelector<RtcAgent>('#agent')!;
 * agent.agentConfig = { persona: '...' };
 * ```
 */
export const whenReady: Promise<void> = new Promise<void>((resolve) => {
  _resolve = resolve;
});

/**
 * 标记模块已就绪（内部使用）
 *
 * 由 RtcAgent 组件在 firstUpdated 时调用。
 * 重复调用是安全的（后续调用立即返回）。
 */
export function _markReady(): void {
  if (_ready) return;
  _ready = true;
  _resolve();
}

/**
 * 检查模块是否已就绪（内部使用，主要用于测试）
 */
export function _isReady(): boolean {
  return _ready;
}
