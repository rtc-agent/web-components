/**
 * Module Ready Signal
 *
 * Provides two mechanisms for the host application to wait for <rtc-agent> component initialization:
 * 1. `whenReady()` Promise — ES module style
 * 2. `rtc-agent-ready` custom event — Web Component style (dispatched by RtcAgent component)
 *
 * Internal use: component calls _markReady() on firstUpdated.
 */

let _resolve: () => void;
let _ready = false;

/**
 * Wait for the <rtc-agent> component module to load and initialize
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
 * Mark the module as ready (internal use)
 *
 * Called by RtcAgent component on firstUpdated.
 * Safe to call multiple times (subsequent calls return immediately).
 */
export function _markReady(): void {
  if (_ready) return;
  _ready = true;
  _resolve();
}

/**
 * Check whether the module is ready (internal use, mainly for testing)
 */
export function _isReady(): boolean {
  return _ready;
}
