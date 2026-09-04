/**
 * Custom Element Type Registrations
 *
 * 为 document.querySelector / createElement 等 DOM API 提供类型推导：
 *
 * @example
 * ```ts
 * import '@rtc-agent/component/elements';  // 触发类型扩展
 *
 * const agent = document.querySelector('rtc-agent');
 * //    ^? RtcAgent | null（自动推导）
 *
 * agent?.addEventListener('rtc-agent-ready', () => { ... });  // ✓ 类型安全
 * ```
 *
 * 注：如果已通过 `import '@rtc-agent/component'` 引入主入口，
 * 本文件的类型扩展会自动生效（主入口重导出了本文件）。
 */

import type { RtcAgent } from './components/rtc-agent/rtc-agent.js';

// Side-effect: events.ts 通过 declare global 扩展 HTMLElementEventMap
import './types/events.js';

declare global {
  interface HTMLElementTagNameMap {
    'rtc-agent': RtcAgent;
  }
}
