// Test setup — jsdom environment provides custom elements support natively.
// jsdom doesn't implement several browser APIs that our components use;
// polyfill them here so tests can exercise the real code paths.

// --- IndexedDB ---
// jsdom doesn't implement IndexedDB. fake-indexeddb provides a pure-JS
// implementation that Dexie (our IndexedDB wrapper) can use.
import 'fake-indexeddb/auto';

// --- window.matchMedia ---
// Used by WindowInteractionController to detect user preferred color scheme
// and reduced motion settings. jsdom has no media query support.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// --- ResizeObserver ---
// Used by rtc-message-list and other layout-aware components. jsdom doesn't
// implement it; provide a no-op stub that components can instantiate safely.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});

// --- Element.prototype.scrollTo ---
// Used by message-list / scroll containers. jsdom implements scrollIntoView
// but not scrollTo with options. Provide a no-op stub.
if (typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function () {} as typeof Element.prototype.scrollTo;
}
