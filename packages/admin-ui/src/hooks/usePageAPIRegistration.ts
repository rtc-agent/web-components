import { useEffect } from 'react';

/**
 * Page API Registration Hook
 *
 * Encapsulates the boilerplate of registering a page-scoped API on
 * `window.__pages__`, dispatching the `page-api-ready` CustomEvent,
 * and cleaning up on unmount.
 *
 * Every page that exposes commands to the RTC Agent subsystem should
 * use this hook instead of manually touching `window.__pages__`.
 *
 * @param pageName - Key used in `window.__pages__` (e.g. 'rtcUser', 'admin')
 * @param factory  - Returns the page API object to register
 * @param cleanup  - Optional extra cleanup invoked after unregistration
 */
export function usePageAPIRegistration<K extends keyof PagesRegistry>(
  pageName: K,
  factory: () => PagesRegistry[K],
  cleanup?: () => void,
): void {
  useEffect(() => {
    const pageAPI = factory();

    window.__pages__ = window.__pages__ || {};
    window.__pages__[pageName] = pageAPI;

    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: pageName } }),
    );

    console.log(`[Page:${pageName}] Page API registered`);

    return () => {
      // Create a new registry object to ensure any code that destructured
      // window.__pages__ doesn't observe a stale snapshot after deletion.
      const registry = { ...window.__pages__ };
      delete registry[pageName];
      window.__pages__ = registry;
      cleanup?.();
      console.log(`[Page:${pageName}] Page API unregistered`);
    };
    // factory and cleanup are expected to be stable references (useCallback).
    // pageName is a string constant defined by the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageName]);
}
