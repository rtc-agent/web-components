/**
 * Custom Element Type Registrations
 *
 * Provides type inference for DOM APIs such as document.querySelector / createElement:
 *
 * @example
 * ```ts
 * import '@rtc-agent/component/elements';  // Triggers type extensions
 *
 * const agent = document.querySelector('rtc-agent');
 * //    ^? RtcAgent | null (automatically inferred)
 *
 * agent?.addEventListener('rtc-agent-ready', () => { ... });  // ✓ Type-safe
 * ```
 *
 * Note: If you import via `import '@rtc-agent/component'` (the main entry),
 * the type extensions in this file take effect automatically (the main entry re-exports this file).
 */

import type { RtcAgent } from './components/rtc-agent/rtc-agent.js';

// Side-effect: events.ts extends HTMLElementEventMap via declare global
import './types/events.js';

declare global {
  interface HTMLElementTagNameMap {
    'rtc-agent': RtcAgent;
  }
}
