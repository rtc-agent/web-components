import { LitElement, render, type TemplateResult } from 'lit';
import { vi } from 'vitest';

/**
 * Wait for one animation frame — ensures Lit has completed its update cycle.
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export interface FixtureOptions {
  setup?: (host: HTMLElement) => void;
}

/**
 * Test fixture rendering.
 *
 * Timing contract (important):
 * 1. If options.setup is provided, it runs synchronously before the first nextFrame().
 * 2. It is safe to call provideContext() in setup; the context will be in place before the host's first update.
 * 3. Do not await anything inside setup -- the element is not yet connected at that point.
 *
 * @example
 * const el = await fixture(html`<my-consumer></my-consumer>`, {
 *   setup: (host) => provideContext(host, sessionContext, initialValue)
 * });
 */
export async function fixture<T extends HTMLElement>(
  template: TemplateResult,
  options?: FixtureOptions,
): Promise<T> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(template, container);
  const el = container.firstElementChild as T;
  if (options?.setup) {
    options.setup(el);
  }
  await nextFrame();
  // Wait for Lit update cycle if element is a LitElement
  if (el instanceof LitElement) {
    await el.updateComplete;
  }
  return el;
}

/**
 * Cleanup helper — call in afterEach to remove all fixture containers.
 *
 * Also clears localStorage to prevent state leakage between tests
 * (e.g., AuthController persists tokens which would affect subsequent tests).
 */
export function cleanupFixtures(): void {
  document.body.innerHTML = '';
  try {
    localStorage.clear();
  } catch {
    // Some environments may block storage access; ignore.
  }
}

// ── Shared Mock Factories ─────────────────────────────────────────────────────
//
// These factories create consistent mock objects for heavy dependencies.
// Use them with vi.mock() in test files to reduce duplication:
//
//   import { mockProtocolLogger, mockPersistenceVFS } from './test-helpers.js';
//   vi.mock('@rtc-agent/protocol', () => mockProtocolLogger());
//   vi.mock('@rtc-agent/persistence', () => mockPersistenceVFS());
//
// Note: vi.mock() is hoisted, but factory function calls inside it are evaluated
// lazily when the mocked module is first imported, so imported helpers work correctly.

/**
 * Create a mock for `@rtc-agent/protocol` that returns a silent logger.
 *
 * Many tests mock the protocol module solely to suppress log output during testing.
 * This factory ensures all test files use the same mock shape, preventing drift.
 */
export function createMockProtocolModule() {
  return {
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
}

/**
 * Create a mock for `@rtc-agent/client` that returns a silent logger.
 *
 * Same pattern as createMockProtocolModule — the client module also exports
 * createLogger and is frequently mocked for the same reason.
 */
export function createMockClientModule() {
  return {
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
}

/**
 * Create a mock for `@rtc-agent/persistence` virtualFS module.
 *
 * Provides vi.fn() stubs for all common VFS operations. Individual tests
 * should configure specific return values via vi.mocked(virtualFS.read).mockResolvedValue(...)
 * after importing the mocked module.
 */
export function createMockPersistenceModule() {
  return {
    getUIUpdateBus: () => ({
      publish: vi.fn(),
      emitGapFillStart: vi.fn(),
      emitGapFillEnd: vi.fn(),
    }),
    virtualFS: {
      read: vi.fn().mockResolvedValue(''),
      write: vi.fn().mockResolvedValue(undefined),
      ls: vi.fn().mockResolvedValue([]),
      find: vi.fn().mockResolvedValue([]),
      grep: vi.fn().mockResolvedValue([]),
      queryByType: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(false),
      remove: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
}

/**
 * Create a mock for `@rtc-agent/persistence` with minimal VFS stubs.
 *
 * Some tests only need a subset of VFS operations (read/write/exists/ls).
 * Use this lighter mock when the full set is not needed.
 */
export function createMinimalMockPersistenceModule() {
  return {
    virtualFS: {
      write: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(''),
      queryByType: vi.fn().mockResolvedValue([]),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
}
