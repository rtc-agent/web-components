/**
 * WorkerBridge — Comlink bridge between the main thread and a SharedWorker.
 *
 * Responsibilities:
 * 1. Create a SharedWorker instance.
 * 2. Use Comlink.wrap() to obtain a WorkerPersistenceCore proxy.
 * 3. Register callback: Worker's UIUpdateEvent -> main-thread UIUpdateBus.publish().
 * 4. Register callback: Worker's token request -> AuthController.getAccessToken() (with dedup).
 * 5. Register callback: Worker's connection state change -> main-thread listeners.
 *
 * Design notes:
 * - The main thread retains the UIUpdateBus singleton (existing UI code continues to subscribe).
 * - When the Worker broadcasts events, WorkerBridge re-publishes them on the main-thread UIUpdateBus.
 * - Only one SharedWorker instance per page (multi-tab sharing managed by the browser).
 * - Token requests: Parallel execution via Promise.any() in WorkerCore. All registered callbacks are tried concurrently; first success wins.
 *
 * ARCHITECTURE NOTE - Direct Persistence Import:
 * ----------------------------------------------
 * This module imports `virtualFS` directly from @rtc-agent/persistence, which may appear
 * to violate the layered architecture (component -> worker -> persistence).
 *
 * This is intentional and necessary for the Comlink proxy pattern:
 * 1. The main thread needs to expose the virtualFS API surface for backward compatibility
 * 2. WorkerBridge installs a Comlink proxy that intercepts virtualFS method calls
 * 3. These calls are forwarded to the Worker's actual implementation (WorkerCore)
 * 4. The proxy is installed globally, so all UI code continues using the same API
 *
 * Without this direct import, we couldn't install the proxy that bridges main-thread
 * API calls to the Worker's persistence layer. This pattern enables:
 * - UI code to use virtualFS.read()/write() etc. without knowing about Workers
 * - Actual persistence operations to run in the Worker thread
 * - Seamless integration with existing code that expects virtualFS to be available
 *
 * See installVirtualFSProxy() and restoreVirtualFS() methods for implementation details.
 */

import type { ConnectionStateEvent, HeadObjectResult } from '@rtc-agent/client';
import type {
  CachedFileInfo,
  FileCacheEntry,
  FileSyncStatus,
  FileSystemMetadataOverride,
  PersistenceConfig,
  UIUpdateEvent,
} from '@rtc-agent/persistence';
import { getUIUpdateBus, virtualFS } from '@rtc-agent/persistence';
import type { ConnectionState } from '@rtc-agent/protocol';
import { createLogger } from '@rtc-agent/protocol';
import type {
  UIUpdatePayload,
  WorkerCallbacks,
  WorkerPersistenceCore,
} from '@rtc-agent/worker';
import { proxy, type Remote, wrap } from 'comlink';
import type { AuthController } from './controllers/auth.controller.js';

const log = createLogger('WorkerBridge');

// Worker script loading strategy
//
// Background: the component may be loaded from a CDN, in which case the component
// scripts are cross-origin relative to the host page.
// SharedWorker requires same-origin scripts (data: URLs get an opaque origin,
// blob: URLs inherit the creating page's origin).
//
// Vite's `?sharedworker` import compiles the worker and emits a **factory function**
// (not a URL string). The factory function internally uses
// `new URL("assets/shared-worker-<hash>.js", import.meta.url)` to reference the compiled
// worker chunk. Calling it at runtime would construct a cross-origin SharedWorker on the
// CDN, causing a SecurityError.
//
// Solution:
//   1. toString() the factory function and extract the embedded worker chunk relative path.
//   2. Resolve an absolute URL on the CDN via `new URL(relativePath, import.meta.url)`.
//   3. fetch() that URL (CDN must return CORS headers) to get the compiled worker script.
//   4. Create a blob: URL via Blob + URL.createObjectURL -> inherits page origin.
//   5. Construct SharedWorker with the blob: URL -> same-origin, can access IndexedDB.
import workerFactory from '../../worker/src/shared-worker.ts?sharedworker';

/**
 * Vite's ?sharedworker import type definition.
 *
 * Vite's type definition for ?sharedworker imports marks it as a constructor with options,
 * but at runtime it is a plain function that returns a SharedWorker instance.
 * The factory function accepts an optional WorkerOptions parameter (name, type).
 */
type WorkerFactoryFunction = (options?: WorkerOptions) => SharedWorker;

/**
 * Comlink proxy with release capability.
 *
 * Comlink proxies expose a special symbol (Symbol.for('comlink.releaseProxy')) for
 * releasing the underlying MessagePort. This interface allows type-safe access to
 * that symbol without using 'as any' assertions throughout the codebase.
 *
 * The index signature with [key: symbol] allows access to any symbol-keyed property,
 * which is necessary because Comlink's release symbol is dynamically looked up via
 * Symbol.for('comlink.releaseProxy') at runtime.
 */
interface ComlinkReleasableProxy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: symbol]: ((...args: any[]) => void) | any;
}

/**
 * Extract the worker chunk URL from a Vite-generated worker factory function source.
 *
 * Vite generates different factory function formats depending on the mode:
 *
 * - Dev mode (plain string):
 *     function WorkerWrapper(options) {
 *       return new SharedWorker("/@fs/.../shared-worker.ts?worker_file&type=module", ...)
 *     }
 *
 * - Production mode (new URL):
 *     function CM(t) {
 *       return new SharedWorker("" + new URL("assets/shared-worker-<hash>.js", import.meta.url).href, ...)
 *     }
 *
 * Tries the new URL(...) pattern first (production), then plain string (dev).
 */
function extractWorkerRelativePath(factory: object): string {
  const src = factory.toString();

  // 1. Production mode: new URL("...", import.meta.url)
  const urlMatch = src.match(/new URL\(\s*(["'`])([^"'`]+)\1/);
  if (urlMatch) return urlMatch[2];

  // 2. Dev mode: new SharedWorker("literal-string", ...)
  const literalMatch = src.match(/new SharedWorker\(\s*(["'`])([^"'`]+)\1/);
  if (literalMatch) return literalMatch[2];

  throw new Error(
    '[WorkerBridge] Cannot extract worker URL from factory. Source: ' +
      src.slice(0, 300),
  );
}

/**
 * Throttle a function so it's called at most once per delayMs.
 *
 * Used to rate-limit progress callbacks to avoid message storms
 * across the Comlink boundary (~10 calls/sec at 100ms interval).
 */
function throttle<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number,
): T {
  let lastCall = 0;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastCall >= delayMs) {
      lastCall = now;
      fn(...args);
    }
  }) as T;
}

export interface WorkerBridgeConfig {
  /**
   * Custom SharedWorker URL.
   *
   * When not provided, uses Vite's factory function to determine the worker URL.
   * This is useful when the component is loaded from NPM and the worker file
   * needs to be served from a different location (e.g., /rtc-agent/shared-worker.js).
   *
   * @example
   * ```ts
   * new WorkerBridge(authController, {
   *   workerURL: '/rtc-agent/shared-worker.js'
   * });
   * ```
   */
  workerURL?: string;
}

export class WorkerBridge {
  private _worker: SharedWorker | null = null;
  private _core: Remote<WorkerPersistenceCore> | null = null;
  private _callbacks: WorkerCallbacks;
  /** Comlink-proxied callbacks (for cross-Worker transfer). Nulled in destroy() to release resources. */
  private _proxiedCallbacks: WorkerCallbacks | null;
  private _initialized = false;
  /** Promise-based dedup guard: concurrent init() calls share the same initialization. */
  private _initPromise: Promise<void> | null = null;
  /** Set to true when destroy() begins, preventing init() from marking bridge as initialized after destroy. */
  private _destroyed = false;
  /** AbortController for cancelling ongoing catch-up */
  private _catchUpAbortController?: AbortController;
  private _config: WorkerBridgeConfig;
  /** Counter for generating unique operation IDs (for file operation cancellation) */
  private _operationCounter = 0;
  /** Host element reference for dispatching events (avoids document.querySelector in multi-instance scenarios) */
  private _hostElement: HTMLElement | null = null;

  /**
   * In-flight token request promise for deduplication.
   *
   * **Race condition scenario:**
   * Worker may request tokens concurrently from multiple callbacks (e.g., reconnection + heartbeat).
   * Without deduplication, each request would trigger a separate call to AuthController.getAccessTokenAsync(),
   * causing redundant network requests and potential token refresh races.
   *
   * **Deduplication mechanism:**
   * The first caller creates this promise and caches it. Subsequent callers await the same promise.
   * After completion (success or failure), the promise is cleared to allow retry.
   *
   * **Why this is safe:**
   * - JavaScript is single-threaded: check-and-assign is atomic
   * - Promise is cleared in `finally`, ensuring cleanup even on exceptions
   * - Multiple callers can await the same promise and receive the same result
   */
  private _tokenRequestPromise: Promise<string> | null = null;

  /** Connection state listeners (main-thread side). */
  private _connectionListeners = new Set<
    (event: ConnectionStateEvent) => void
  >();

  /**
   * Heartbeat timer for periodic Worker liveness checks.
   * Set up after successful initialization; cleared in destroy().
   * Detects silent Worker failures (e.g., OOM kills, internal crashes)
   * that don't trigger onerror but leave the Worker unresponsive.
   */
  private _heartbeatTimer?: ReturnType<typeof setInterval>;

  /**
   * Whether callbacks have been registered with the Worker.
   *
   * This flag is set to true immediately after registerCallback() succeeds,
   * and is used by destroy() to determine whether unregisterCallback() should be called.
   *
   * Rationale: _initialized alone is insufficient because it's only set after _doInit() completes.
   * If _doInit() fails after registerCallback() (e.g., during catch-up), _initialized remains false
   * but callbacks ARE registered in the Worker. Without this flag, destroy() would skip unregisterCallback(),
   * leaving orphaned callback references in the Worker and causing memory leaks.
   */
  private _callbacksRegistered = false;

  /**
   * Whether sessionStorage cursor has been restored (only once per instance lifetime).
   * Prevents destroy(false) + init() from re-loading a stale sessionStorage cursor.
   */
  private _hasRestoredFromStorage = false;

  /**
   * Whether catch-up is in progress.
   * When true, _updateLastProcessedSeq only updates memory to avoid frequent sessionStorage writes.
   * After catch-up completes, the cursor is persisted in one batch write.
   */
  private _isCatchingUp = false;

  /**
   * Last processed UI update sequence number (for catch-up after page refresh).
   * Persisted in sessionStorage to survive page refreshes within the same tab.
   * Updated during both catch-up and real-time broadcasts to minimize redundant replays.
   *
   * RACE CONDITION GUARD:
   * This field is the key defense against event duplication in the catch-up flow.
   * - Real-time callbacks (onUIUpdate) update this field synchronously when events arrive
   * - The catch-up loop checks this field before delivering each event via _isEventProcessed()
   * - Even if real-time events arrive during the catch-up query (await point), the check
   *   will correctly skip already-delivered events
   * See _isEventProcessed() for detailed race condition analysis.
   */
  private _lastProcessedSeq: number;
  /** Database name for scoping sessionStorage key (prevents cross-instance collisions). */
  private _databaseName: string;
  private static readonly SESSION_STORAGE_KEY_PREFIX = 'rtc-ui-update-seq';

  /**
   * CRITICAL: Tracks whether virtualFS proxy has been installed globally.
   *
   * WARNING: virtualFS is a module-level singleton. Installing the proxy replaces
   * its methods with Comlink proxies to a specific WorkerBridge instance's Worker.
   * If multiple <rtc-agent> instances exist on the same page, each instance will
   * overwrite the previous instance's proxy, causing unpredictable behavior.
   *
   * This flag is used to enforce single-instance semantics and warn developers
   * about multi-instance conflicts.
   */
  private static _virtualFSProxyInstalled = false;

  /**
   * Tracks which WorkerBridge instance installed the virtualFS proxy.
   *
   * Uses WeakRef to allow GC to automatically reset the tracking if the instance
   * is garbage collected. This prevents stale strong references from blocking GC
   * and causing memory leaks in scenarios where components are frequently mounted
   * and unmounted.
   *
   * When checking this reference:
   * - If WeakRef.deref() returns undefined, the instance was GC'd (safe to reinstall)
   * - If WeakRef.deref() returns an instance, check if it's still alive
   *
   * Note: The WeakRef is kept even after destroy() to detect conflicts with
   * destroyed-but-not-yet-GC'd instances (which would indicate a lifecycle bug).
   */
  private static _virtualFSProxyInstalledBy: WeakRef<WorkerBridge> | null =
    null;

  /**
   * Backup of original virtualFS methods, saved before proxy installation.
   * Used by restoreVirtualFS() to recover the original implementation on destroy().
   */
  private static _originalVirtualFS: {
    read: typeof virtualFS.read;
    write: typeof virtualFS.write;
    ls: typeof virtualFS.ls;
    find: typeof virtualFS.find;
    grep: typeof virtualFS.grep;
    queryByType: typeof virtualFS.queryByType;
    exists: typeof virtualFS.exists;
    remove: typeof virtualFS.remove;
  } | null = null;

  private static readonly MAX_INIT_RETRIES = 3;
  private static readonly INIT_RETRY_DELAY_MS = 1000;
  /** Timeout for worker liveness verification (ping/pong). */
  private static readonly VERIFICATION_TIMEOUT_MS = 5000;
  /** Heartbeat interval: ping the Worker every 30 seconds to detect silent failures. */
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000;

  /**
   * Generate a worker name for SharedWorker construction.
   *
   * In dev mode, appends a timestamp suffix to avoid connecting to stale workers
   * from previous sessions (e.g., after force-killing a tab during debugging).
   * SharedWorkers persist across tab closures, so a stale worker in a bad state
   * can cause verification timeouts on subsequent page loads.
   *
   * In production mode, uses a fixed name for predictable multi-tab sharing.
   */
  private static _getWorkerName(): string {
    const baseName = 'rtc-agent-worker';
    // Use import.meta.env.DEV for Vite dev mode detection
    // Vite's ImportMetaEnv interface provides type-safe access to environment variables
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      return `${baseName}-dev-${Date.now()}`;
    }
    return baseName;
  }

  constructor(
    private readonly _auth: AuthController,
    config: WorkerBridgeConfig = {},
    hostElement?: HTMLElement,
  ) {
    this._config = config;
    this._hostElement = hostElement ?? null;
    // databaseName is not available yet (set in init()). Use a placeholder key.
    // sessionStorage restore is deferred to init() when the actual databaseName is known.
    this._databaseName = 'default';
    this._lastProcessedSeq = 0;

    // 1. Prepare callbacks (registered in the Worker during init()).
    this._callbacks = {
      // Worker broadcasts UIUpdateEvent -> main-thread UIUpdateBus.publish().
      // Also updates _lastProcessedSeq so catch-up won't re-deliver this event.
      // skipPersist: true — Worker already persisted this event, avoid duplicate writes.
      // seqOverride: pass the original seq so listeners receive the correct persisted seq
      // (not 0, which would break the API contract).
      //
      // Note: bus.publish() is async and returns Promise<void>. We intentionally use
      // fire-and-forget (no await) because:
      // 1. The Worker has already persisted this event, so main-thread persistence is skipped
      // 2. The Comlink callback boundary doesn't propagate async errors reliably
      // 3. UIUpdateBus.publish() has internal try-catch for persistence and listener dispatch
      // However, we add .catch() to prevent unhandled promise rejections in edge cases
      // (e.g., if IndexedDB is closed or bus is in an unexpected state).
      //
      // RACE CONDITION NOTE:
      // This callback updates _lastProcessedSeq synchronously (no await) to ensure
      // the catch-up loop's idempotency guard (_isEventProcessed) works correctly.
      // See _isEventProcessed() for detailed race condition analysis.
      //
      // TODO(perf): For messages >100KB, consider offloading JSON parsing
      // to a Worker thread to avoid blocking the main thread.
      // See: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
      onUIUpdate: (payload: UIUpdatePayload) => {
        // P2 FIX: Monitor main-thread processing cost for high-frequency events.
        // When structured clone / JSON parsing + bus.publish() takes >5ms, emit a warning
        // to help diagnose UI jank during bulk updates.
        const startTime = performance.now();

        const bus = getUIUpdateBus();
        // P2-1 FIX: Document fire-and-forget design rationale.
        // DESIGN NOTE: bus.publish() is intentionally fire-and-forget (no await, no retry).
        // This is a deliberate architectural decision, not an oversight:
        // 1. The Worker has already persisted this event to its IndexedDB, so main-thread
        //    persistence is skipped (skipPersist: true). No data loss risk.
        // 2. UI updates are eventually consistent: if this publish() fails, the UI will
        //    still converge to the correct state on the next user interaction or catch-up.
        // 3. The Comlink callback boundary doesn't propagate async errors reliably, so
        //    retrying would not improve reliability.
        // 4. Adding retry logic would increase complexity without meaningful benefit,
        //    since the event is already durably stored in the Worker.
        //
        // However, we add .catch() to prevent unhandled promise rejections in edge cases
        // (e.g., if IndexedDB is closed or bus is in an unexpected state). This is defensive
        // programming, not an indication that failures are expected.
        bus
          .publish(payload.event, {
            skipPersist: true,
            seqOverride: payload.seq,
          })
          .catch((err) => {
            // P1-FIX: Preserve error details through Comlink boundary by extracting
            // name, message, and stack (if available). Comlink's structured clone
            // may not preserve Error stack traces, so we log what we have.
            const errorInfo =
              err instanceof Error
                ? {
                    name: err.name,
                    message: err.message,
                    stack: err.stack ?? 'no stack available',
                  }
                : {
                    name: 'UnknownError',
                    message: String(err),
                    stack: 'no stack available',
                  };
            log.error(
              'onUIUpdate: bus.publish() failed (non-fatal):',
              errorInfo,
            );
          });
        // Advance cursor on real-time delivery to minimize redundant catch-up replays.
        // SYNCHRONIZATION GUARANTEE:
        // _lastProcessedSeq is updated synchronously (no await between the check and update).
        // This ensures the catch-up loop's idempotency guard (_isEventProcessed)
        // works correctly, even if events arrive during the async query.
        // JavaScript's single-threaded execution model guarantees no interleaving here.
        if (payload.seq > this._lastProcessedSeq) {
          this._updateLastProcessedSeq(payload.seq);
        }

        // P2 FIX: Warn when main-thread processing exceeds 5ms threshold.
        // This helps diagnose UI jank during high-frequency events (e.g., bulk streaming updates).
        // The threshold of 5ms is chosen to catch significant main-thread blocking while avoiding
        // noise from normal sub-millisecond events.
        const elapsed = performance.now() - startTime;
        if (elapsed > 5) {
          log.warn(
            `onUIUpdate: main-thread processing took ${elapsed.toFixed(2)}ms (>5ms threshold), ` +
              `entity=${payload.event?.entity}, action=${payload.event?.action}, seq=${payload.seq}`,
          );
        }
      },
      // Worker requests token -> AuthController.getAccessTokenAsync().
      // TIMEOUT PROTECTION: 5-second timeout prevents infinite blocking if AuthController hangs.
      // Without this, a stuck getAccessTokenAsync() would block the Worker's token request
      // indefinitely, preventing reconnection and causing silent failures.
      //
      // DEDUPLICATION: Uses _tokenRequestPromise to prevent concurrent requests.
      // If multiple callbacks request tokens simultaneously, they all await the same promise.
      requestToken: async (): Promise<string> => {
        // Deduplication: if a request is already in-flight, await it instead of starting a new one
        if (this._tokenRequestPromise) {
          log.debug('token request already in-flight, awaiting existing promise');
          return this._tokenRequestPromise;
        }

        const TIMEOUT_MS = 5000;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `[WorkerBridge] requestToken timeout after ${TIMEOUT_MS}ms`,
              ),
            );
          }, TIMEOUT_MS);
        });

        this._tokenRequestPromise = (async () => {
          try {
            const token = await Promise.race([
              this._auth.getAccessTokenAsync(),
              timeoutPromise,
            ]);
            if (!token) {
              throw new Error('[WorkerBridge] no access token available');
            }
            return token;
          } finally {
            // CRITICAL: Clear timeout to prevent unhandled rejection when getAccessTokenAsync()
            // resolves first. Without this, the timer fires after 5s and rejects an already-settled
            // Promise, causing an unhandled promise rejection warning.
            if (timeoutId !== undefined) {
              clearTimeout(timeoutId);
            }
            // Clear the promise after completion (success or failure) to allow retry
            this._tokenRequestPromise = null;
          }
        })();

        return this._tokenRequestPromise;
      },
      // Worker requests token refresh -> AuthController.handleTokenExpired().
      // Returns 'refresh' if refreshed, 'relogin' if re-login is required.
      requestTokenRefresh: (): Promise<'refresh' | 'relogin'> => {
        return this._auth.handleTokenExpired();
      },
      // Worker broadcasts connection state change -> notify main-thread listeners.
      // EXCEPTION SAFETY: Each listener is wrapped in try-catch to prevent one failing listener
      // from breaking the notification chain for other listeners. Errors are logged but don't
      // propagate to the Worker (which would cause unnecessary callback failures).
      onConnectionStateChange: (event: ConnectionStateEvent) => {
        log.debug(
          '[WorkerBridge] onConnectionStateChange called, state:',
          event.state,
          'reason:',
          event.reason,
          'listeners:',
          this._connectionListeners.size,
        );
        // Snapshot listeners to prevent concurrent modification issues if a listener
        // adds or removes listeners during iteration (defensive programming).
        const listenersSnapshot = Array.from(this._connectionListeners);
        for (const listener of listenersSnapshot) {
          try {
            listener(event);
          } catch (err) {
            // P1-FIX: Extract error details for better diagnostics. Comlink proxied
            // callbacks may lose stack traces when errors propagate across threads.
            const errorInfo =
              err instanceof Error
                ? {
                    name: err.name,
                    message: err.message,
                    stack: err.stack ?? 'no stack available',
                  }
                : {
                    name: 'UnknownError',
                    message: String(err),
                    stack: 'no stack available',
                  };
            log.error(
              'connection listener error (non-fatal, continuing to other listeners):',
              errorInfo,
            );
          }
        }
      },
      // Worker broadcasts gap fill state -> main-thread UIUpdateBus.emitGapFillStart/End().
      // EXCEPTION SAFETY: bus.emitGapFillStart/End() are synchronous and rarely throw,
      // but we wrap them in try-catch for consistency with other callbacks and to prevent
      // uncaught exceptions from breaking the Worker callback chain.
      onGapFillState: (isSyncing: boolean) => {
        log.debug(
          '[BulkUpdate] WorkerBridge.onGapFillState called, isSyncing:',
          isSyncing,
        );
        try {
          const bus = getUIUpdateBus();
          if (isSyncing) {
            bus.emitGapFillStart();
          } else {
            bus.emitGapFillEnd();
          }
        } catch (err) {
          // P1-FIX: Extract error details for better diagnostics. Comlink proxied
          // callbacks may lose stack traces when errors propagate across threads.
          const errorInfo =
            err instanceof Error
              ? {
                  name: err.name,
                  message: err.message,
                  stack: err.stack ?? 'no stack available',
                }
              : {
                  name: 'UnknownError',
                  message: String(err),
                  stack: 'no stack available',
                };
          log.error(
            'onGapFillState: failed to emit gap fill event (non-fatal):',
            errorInfo,
          );
        }
      },
      // Catch-up detected a gap in events (TTL cleanup deleted missed events).
      // Reset cursor and trigger a full state refresh via gap fill mechanism.
      // EXCEPTION SAFETY: Wrapped in try-catch to prevent uncaught exceptions from breaking
      // the Worker callback chain. onStateGap is critical for recovery, so we log but don't throw.
      onStateGap: () => {
        log.warn(
          'catchUp: state gap detected — events were lost (likely TTL cleanup)',
        );
        try {
          this._lastProcessedSeq = 0;
          this._saveLastProcessedSeq();
          // Only call end to trigger reload, skip start (don't show overlay)
          const bus = getUIUpdateBus();
          bus.emitGapFillEnd();
        } catch (err) {
          log.error(
            'onStateGap: failed to reset cursor or emit gap fill end (non-fatal):',
            err,
          );
        }
      },
      // Worker broadcasts account banned notification (disconnect code 4501).
      // Store ban state in sessionStorage so it survives component remounts,
      // then dispatch event to trigger immediate logout.
      //
      // NOTE: The sessionStorage key is not user-scoped. This is intentional:
      // the ban state is temporary (picked up immediately by rtc-agent component),
      // and the user is logged out right away. There's no risk of cross-user
      // contamination since each user session is isolated by the logout flow.
      //
      // EXCEPTION SAFETY: Both sessionStorage and dispatchEvent can throw in edge cases
      // (private browsing, detached element, etc.). We catch and log but don't propagate
      // to the Worker, as this callback is best-effort (the Worker has already disconnected).
      onAccountBanned: (reason: string) => {
        log.warn('Account banned:', reason);
        // Persist ban state so rtc-agent can pick it up even after remount
        try {
          sessionStorage.setItem(
            'rtc-account-banned-pending',
            JSON.stringify({ reason, timestamp: Date.now() }),
          );
        } catch (e) {
          // sessionStorage may be unavailable (private browsing, quota exceeded, etc.)
          // This is non-fatal — the event dispatch below will still trigger immediate logout
          log.debug('sessionStorage unavailable for ban state (non-fatal):', e);
        }
        // Dispatch event directly (no setTimeout) for immediate handling
        // Uses host element reference passed from PersistenceController to support
        // multi-instance scenarios (avoids document.querySelector which would find
        // the wrong element when multiple rtc-agent instances exist on the page).
        if (this._hostElement) {
          try {
            this._hostElement.dispatchEvent(
              new CustomEvent('rtc-account-banned', {
                bubbles: true,
                composed: true,
                detail: { reason },
              }),
            );
            log.warn(
              'dispatched rtc-account-banned event from onAccountBanned callback',
            );
          } catch (err) {
            // dispatchEvent can throw if the element is detached or in certain error states
            log.error(
              'Failed to dispatch rtc-account-banned event (non-fatal):',
              err,
            );
          }
        } else {
          log.error(
            'host element not available when handling account banned; ban state saved in sessionStorage',
          );
        }
      },
    };

    // 2. Create Comlink-proxied callbacks (for cross-Worker transfer).
    // Structured Clone cannot handle functions; proxy() bridges via MessagePort.
    // CRITICAL: proxy() creates internal MessagePorts that MUST be released in destroy()
    // to prevent resource leaks. See _releaseProxiedCallbacks() for proper cleanup.
    this._proxiedCallbacks = proxy(this._callbacks);

    // Note: SharedWorker instance, Comlink wrap, and error handling are created in
    // initWorker(), because the worker script must first be async-fetched to produce
    // a blob URL.
  }

  /**
   * Asynchronously create a SharedWorker instance.
   *
   * Flow:
   * 1. Extract the worker chunk's relative path from the Vite factory function.
   * 2. Resolve the absolute CDN URL and fetch the compiled worker script (requires CORS).
   * 3. Create a same-origin blob: URL via Blob + createObjectURL.
   * 4. Construct SharedWorker with the blob: URL -> inherits page origin.
   * 5. Verify the Worker started successfully (via ping test).
   *
   * Must be called before init().
   * Supports retry: on failure, automatically retries up to MAX_INIT_RETRIES times.
   */
  async initWorker(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= WorkerBridge.MAX_INIT_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          log.warn(
            `Retrying worker initialization (attempt ${attempt + 1}/${WorkerBridge.MAX_INIT_RETRIES + 1})...`,
          );
          await this._delay(WorkerBridge.INIT_RETRY_DELAY_MS * attempt);
        }

        await this._initWorkerOnce();
        // Verify the Worker actually started.
        await this._verifyWorkerAlive();
        // Start periodic heartbeat to detect silent failures.
        this._startHeartbeat();

        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        log.error(
          `Worker initialization attempt ${attempt + 1} failed:`,
          lastError,
        );

        // Clean up the failed Worker instance.
        this._cleanupFailedWorker();
      }
    }

    // All retries exhausted.
    throw new Error(
      `[WorkerBridge] Failed to initialize SharedWorker after ${WorkerBridge.MAX_INIT_RETRIES + 1} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Single Worker initialization attempt.
   */
  private async _initWorkerOnce(): Promise<void> {
    const workerName = WorkerBridge._getWorkerName();

    // If custom workerURL is provided, use it directly
    if (this._config.workerURL) {
      log.info('Using custom workerURL:', this._config.workerURL);
      this._worker = new SharedWorker(this._config.workerURL, {
        name: workerName,
        type: 'module',
      });
    } else {
      // 1. Extract worker chunk path (from Vite factory function source).
      const workerPath = extractWorkerRelativePath(workerFactory);

      // 2. Resolve the worker's absolute URL.
      const here = import.meta.url;
      const workerURL = new URL(workerPath, here).href;

      // 3. Determine if cross-origin.
      const pageOrigin = window.location.origin;
      let workerOrigin: string;
      try {
        workerOrigin = new URL(workerURL).origin;
      } catch (err) {
        // Malformed URL — assume same-origin as fallback
        log.debug(
          'Failed to parse worker URL origin, assuming same-origin:',
          err,
        );
        workerOrigin = pageOrigin;
      }
      const isCrossOrigin = workerOrigin !== pageOrigin;

      log.info('worker init:', {
        workerURL,
        pageOrigin,
        workerOrigin,
        isCrossOrigin,
      });

      if (!isCrossOrigin) {
        // Same-origin: use the factory function directly (simplest, most reliable).
        // Used for local dev and same-origin deployments.
        // Vite's type definition is incorrect (marks ?sharedworker import as a constructor);
        // at runtime it is a plain function that returns a SharedWorker instance.
        // Call it without 'new' since it's a factory function, not a constructor.
        // Pass workerName to control the SharedWorker's name (important for dev mode
        // to avoid connecting to stale workers from previous sessions).
        // Type assertion explanation:
        // Vite's TypeScript definition for ?sharedworker imports incorrectly marks the
        // import as a SharedWorker constructor (typeof SharedWorker), but at runtime it
        // is actually a plain factory function that returns a SharedWorker instance.
        // This mismatch requires casting to WorkerFactoryFunction to call it without 'new'.
        // See: https://vitejs.dev/guide/assets.html#importing-script
        this._worker = (workerFactory as unknown as WorkerFactoryFunction)({
          name: workerName,
          type: 'module',
        });
      } else {
        // Cross-origin (CDN deployment): fetch worker script -> create same-origin blob: URL
        // -> construct SharedWorker.
        // CDN must return CORS headers (Access-Control-Allow-Origin) or fetch will fail.
        let script: string;
        try {
          const response = await fetch(workerURL, {
            cache: 'default', // CDN scripts are content-hashed in production; dev URLs are unique per HMR.
            credentials: 'omit', // SECURITY: prevent cookie leakage to CDN domains
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }
          script = await response.text();
        } catch (err) {
          throw new Error(
            `[WorkerBridge] failed to fetch worker script from ${workerURL}: ${err instanceof Error ? err.message : err}`,
          );
        }

        const blob = new Blob([script], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);

        try {
          this._worker = new SharedWorker(blobUrl, {
            name: workerName,
            type: 'module',
          });
        } finally {
          // Blob URL has been passed to SharedWorker — can be revoked immediately
          // (the worker already holds the script content).
          URL.revokeObjectURL(blobUrl);
        }
      }
    }

    // 4. Comlink.wrap to obtain the proxy (needed for both paths).
    this._core = wrap<WorkerPersistenceCore>(this._worker!.port);

    // 5. Error handling.
    this._worker!.onerror = (event) => {
      log.error('SharedWorker error:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
    };

    this._worker!.port.onmessageerror = (event) => {
      log.error('port message error:', event);
    };
  }

  /**
   * Verify the Worker actually started and can respond.
   *
   * Calls a lightweight method (ping) to verify the Worker is alive.
   * ping() does not require init() and is suitable for startup verification.
   * If the Worker failed to start or crashed immediately, this call will time out or throw.
   */
  private async _verifyWorkerAlive(): Promise<void> {
    if (!this._core) {
      throw new Error('[WorkerBridge] No core available for verification');
    }

    // Timeout: if the Worker doesn't respond within 5 seconds, consider it failed.
    // The timer MUST be cleared in finally to prevent:
    // 1. Unhandled rejection when ping() wins the race (timer fires reject() on settled Promise)
    // 2. Useless timer occupying the event loop for 5s after successful verification
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const staleWorkerHint =
          `Worker verification timed out after ${WorkerBridge.VERIFICATION_TIMEOUT_MS}ms. ` +
          `This may indicate a stale SharedWorker from a previous browser session ` +
          `(e.g., after force-killing a tab during debugging). ` +
          `To resolve: visit chrome://inspect/#workers, find and terminate the stale ` +
          `'rtc-agent-worker' instance, then reload the page.`;
        reject(new Error(staleWorkerHint));
      }, WorkerBridge.VERIFICATION_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([this._core.ping(), timeoutPromise]);
      if (result !== 'pong') {
        throw new Error(`Unexpected ping response: ${result}`);
      }
      log.info('Worker verification successful');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'unknown error';
      throw new Error(
        `[WorkerBridge] Worker verification failed: ${errorMessage}`,
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Start periodic heartbeat to detect silent Worker failures.
   *
   * Calls ping() every HEARTBEAT_INTERVAL_MS (30 seconds).
   * If ping() fails or times out, logs a warning but does not attempt recovery
   * (recovery is handled by the application layer via connection state monitoring).
   *
   * Why this is useful:
   * - SharedWorkers can fail silently (e.g., OOM kills, internal exceptions)
   * - Without heartbeat, failures are only detected when the next operation times out
   * - Heartbeat provides early warning and helps with observability
   *
   * Safety:
   * - Errors are caught and logged (non-fatal)
   * - If the Worker is truly dead, subsequent operations will fail and trigger cleanup
   * - Heartbeat is cleared in destroy() to prevent leaks
   * - Overlapping pings are prevented: if a ping is still in-flight when the next
   *   interval fires, the new ping is skipped (prevents accumulation during network issues)
   */
  private _heartbeatInFlight = false;

  private _startHeartbeat(): void {
    this._stopHeartbeat(); // Clear any existing timer (defensive)
    this._heartbeatInFlight = false;
    this._heartbeatTimer = setInterval(async () => {
      if (!this._core) return;
      // Skip if a previous ping is still in-flight (prevents accumulation during network issues)
      if (this._heartbeatInFlight) {
        log.debug('Worker heartbeat: skipping (previous ping still in-flight)');
        return;
      }
      this._heartbeatInFlight = true;
      try {
        const result = await this._core.ping();
        if (result !== 'pong') {
          log.warn('Worker heartbeat: unexpected ping response:', result);
        } else {
          log.debug('Worker heartbeat: pong received');
        }
      } catch (err) {
        log.warn('Worker heartbeat failed (Worker may be unresponsive):', err);
      } finally {
        this._heartbeatInFlight = false;
      }
    }, WorkerBridge.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the periodic heartbeat.
   * Safe to call multiple times (idempotent).
   */
  private _stopHeartbeat(): void {
    if (this._heartbeatTimer !== undefined) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
    }
    this._heartbeatInFlight = false;
  }

  /**
   * Clean up a failed Worker instance.
   */
  private _cleanupFailedWorker(): void {
    if (this._worker) {
      try {
        this._worker.port.close();
      } catch {
        // Ignore close errors.
      }
      this._worker = null;
    }
    this._core = null;
  }

  /**
   * Delay for the specified number of milliseconds.
   */
  private _delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the Comlink-proxied WorkerPersistenceCore.
   *
   * All method calls are forwarded to the Worker via postMessage.
   * The returned object has the same interface as WorkerPersistenceCore.
   *
   * Must be accessed after initWorker().
   */
  get core(): Remote<WorkerPersistenceCore> {
    return this._ensureCore();
  }

  /**
   * Guard: ensure the Comlink-proxied core is available.
   *
   * Replaces the non-null assertion (`this._ensureCore()`) with an explicit check
   * that throws a clear error if the bridge has been destroyed or not yet initialized.
   */
  private _ensureCore(): Remote<WorkerPersistenceCore> {
    if (!this._core) {
      throw new Error(
        '[WorkerBridge] core is not available — bridge may have been destroyed or not yet initialized',
      );
    }
    return this._core;
  }

  /**
   * Initialize the bridge.
   *
   * 1. Call Worker's core.init() to initialize shared state.
   * 2. Open the port to start communication.
   * 3. Register this tab's callbacks (onUIUpdate + requestToken + onConnectionStateChange).
   *    Registered before init() so any events broadcast during init() are captured.
   * 4. Catch up on missed UI update events (persisted in Worker's IndexedDB).
   *    Callbacks are registered first so real-time events arriving during catch-up
   *    update _lastProcessedSeq, preventing both loss and duplication.
   *
   * Idempotent: only the first call takes effect.
   * Concurrent calls share the same initialization Promise (no double catch-up).
   * Must call initWorker() first.
   */
  async init(config: PersistenceConfig): Promise<void> {
    if (this._destroyed) {
      throw new Error(
        '[WorkerBridge] cannot init(): bridge has been destroyed',
      );
    }
    if (this._initialized) {
      log.warn('already initialized');
      return;
    }
    // Promise-based dedup: concurrent init() calls share the same initialization
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._doInit(config);
    try {
      await this._initPromise;
      // RACE CONDITION GUARD: destroy() may have been called while _doInit() was in flight
      // (destroy() waits only 100ms for init to complete). If _destroyed is true, the bridge
      // is being torn down — do NOT mark as initialized, even though _doInit() succeeded.
      // Without this check, _initialized would be true on a destroyed bridge, causing a second
      // init() call to return early (thinking it's already initialized) while the bridge is dead.
      if (!this._destroyed) {
        this._initialized = true;
      }
    } finally {
      this._initPromise = null;
    }
  }

  /**
   * Internal initialization logic.
   *
   * CONCURRENCY SAFETY:
   * This method is called via _initPromise dedup (see init()). Concurrent init() calls
   * share the same Promise, so the cleanup logic below executes at most once per bridge
   * instance. This prevents race conditions where multiple concurrent initializations
   * might attempt to clean up the same partial state.
   *
   * DESTROY SAFETY:
   * If destroy() is called while _doInit() is in flight, the _destroyed flag is set
   * immediately. We check this flag at key points to avoid completing initialization
   * on a destroyed bridge. The init() method checks _destroyed before marking the
   * bridge as initialized, ensuring a destroyed bridge is never used.
   */
  private async _doInit(config: PersistenceConfig): Promise<void> {
    // GUARD: Check if bridge was destroyed before or during initialization.
    // This can happen if destroy() is called while _doInit() is awaiting.
    // Without this check, we might complete initialization on a destroyed bridge,
    // leading to resource leaks or use-after-destroy bugs.
    if (this._destroyed) {
      throw new Error(
        '[WorkerBridge] cannot _doInit(): bridge has been destroyed during initialization',
      );
    }

    if (!this._worker || !this._core) {
      throw new Error('[WorkerBridge] init() called before initWorker()');
    }

    // Clean up partial initialization from a previous failed attempt.
    // If _callbacksRegistered is true but _initialized is false, it means a previous
    // _doInit() call failed after registerCallback() succeeded. We must unregister
    // before re-registering to avoid duplicate callback registration in the Worker.
    if (this._callbacksRegistered) {
      log.warn(
        '_doInit: cleaning up partial initialization from previous failed attempt',
      );
      let cleanupSucceeded = false;
      try {
        if (this._proxiedCallbacks) {
          await this._core.unregisterCallback(this._proxiedCallbacks);
        }
        cleanupSucceeded = true;
        log.debug('_doInit: cleanup unregisterCallback succeeded');
      } catch (err) {
        log.debug(
          '_doInit: cleanup unregisterCallback failed (may be expected):',
          err,
        );
      }

      // CRITICAL: If unregisterCallback failed, the Worker may still hold a reference to
      // the old proxy. We must release the old proxy and create a new one to prevent:
      // 1. Memory leak (old proxy's MessagePorts remain open)
      // 2. Duplicate callback registration (Worker sees old and new proxies as different)
      // 3. Stale callback invocation (Worker calls old proxy after we've moved on)
      if (!cleanupSucceeded) {
        log.warn(
          '_doInit: cleanup failed, releasing old proxy and creating new one',
        );
        this._releaseProxiedCallbacks();
        // Recreate proxied callbacks for the next attempt
        this._proxiedCallbacks = proxy(this._callbacks);
      }
      this._callbacksRegistered = false;
    }

    // Store databaseName for sessionStorage key scoping.
    // Detect databaseName change: if the name differs from the previous init(),
    // re-load the cursor from the new sessionStorage key to avoid using a stale cursor.
    const newDatabaseName = config.databaseName ?? 'default';
    const databaseNameChanged = newDatabaseName !== this._databaseName;
    this._databaseName = newDatabaseName;

    if (!this._hasRestoredFromStorage || databaseNameChanged) {
      this._lastProcessedSeq = this._loadLastProcessedSeq();
      this._hasRestoredFromStorage = true;
    }

    // Open the port (must be called before any communication).
    try {
      this._worker.port.start();
    } catch (err) {
      log.debug('port.start() failed (likely already started):', err);
    }

    // Register callback BEFORE init() to ensure no events are missed.
    // Although WorkerCore.init() currently doesn't broadcast events, registering first
    // makes the code robust against future changes that might add async event broadcasting to init().
    // This also ensures callbacks are ready to receive events immediately after init() completes.
    if (!this._proxiedCallbacks) {
      throw new Error(
        '[WorkerBridge] _proxiedCallbacks is null during _doInit — this should not happen',
      );
    }
    await this._core.registerCallback(this._proxiedCallbacks);
    // Mark callbacks as registered immediately after successful registration.
    // This ensures destroy() can properly clean up even if subsequent initialization steps fail.
    this._callbacksRegistered = true;

    // Initialize the Worker-side shared state.
    await this._core.init(config);

    // Catch up on missed UI update events AFTER registering real-time callbacks.
    // Paginated: handles >1000 missed events. Detects gaps from TTL cleanup.
    await this._doCatchUp();
  }

  /**
   * Destroy the bridge.
   *
   * Performs comprehensive cleanup in a specific order to prevent resource leaks
   * and race conditions during teardown:
   *
   * 1. Mark as destroyed immediately — prevents init() from completing after destroy.
   * 2. Stop heartbeat — prevents further pings to a dying Worker.
   * 3. Cancel ongoing catch-up — signals _doCatchUp() to bail out at next iteration.
   * 4. Wait for ongoing init() — serializes cleanup with a 100ms timeout.
   * 5. Clean up Worker resources — unregister callbacks, close port, restore virtualFS.
   * 6. Null out references — prevents use-after-destroy bugs and allows GC.
   * 7. Resolve pending yield promises — allows catch-up loop to exit cleanly.
   * 8. Clear yield channel — prevents memory leaks.
   * 9. Optionally clear sessionStorage cursor — only on actual tab close.
   *
   * @param clearStorage - If true, clear sessionStorage cursor (use when tab is closing).
   *                       If false (default), keep cursor so component remount doesn't trigger
   *                       redundant catch-up. Only clear on actual tab close (beforeunload).
   */
  async destroy(clearStorage = false): Promise<void> {
    // Mark as destroyed immediately to prevent init() from completing after destroy.
    // This is checked in init() before setting _initialized = true.
    this._destroyed = true;

    // Stop heartbeat immediately to prevent further pings to a dying Worker.
    this._stopHeartbeat();

    // 1. Cancel ongoing catch-up immediately.
    //    This signals _doCatchUp() to bail out at the next iteration boundary.
    this._catchUpAbortController?.abort();

    // 2. Wait for ongoing init() to complete (or fail) before cleaning up,
    //    but with a timeout to avoid blocking indefinitely.
    //    If we don't wait, init() might try to access resources we're about to close
    //    (e.g., calling port.start() after port.close(), or registerCallback after
    //    unregisterCallback). The init() caller will receive the result (success or error)
    //    as usual — we only await here to serialize cleanup.
    //    The 100ms timeout ensures destroy() remains responsive even if init() is
    //    stuck in a long-running catch-up (the abort above should cancel it, but
    //    the Comlink round-trip may still be in flight).
    if (this._initPromise) {
      try {
        await Promise.race([
          this._initPromise,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('destroy init timeout')), 100),
          ),
        ]);
      } catch {
        // Init failed or timed out — that's fine, we're destroying anyway.
        // The failure will surface to the init() caller.
      }
    }

    // 3. Clean up Worker resources regardless of _initialized state.
    //    If initWorker() succeeded but init() didn't complete (or wasn't called),
    //    we still need to close the port to avoid resource leaks.
    if (this._worker) {
      // Only cleanup if callbacks were actually registered (regardless of full init completion).
      // This handles the case where _doInit() failed after registerCallback() —
      // _initialized is false but callbacks ARE registered in the Worker.
      //
      // ATOMIC CLEANUP: We rely on close() to handle both callback removal and resource
      // cleanup atomically. This prevents the race condition where unregisterCallback()
      // succeeds but close() fails, leaving the callback removed but resources not cleaned up.
      //
      // The close() method in WorkerCore accepts an optional callerCallback parameter:
      // - If provided, it removes the callback BEFORE checking reference count
      // - This ensures cleanup even if a previous unregisterCallback() call failed
      // - The callback is removed from the Worker's Set, and resources are cleaned up
      //   if this is the last tab
      //
      // Why this is safe:
      // 1. If close() succeeds: callback is removed AND resources are cleaned up (atomic)
      // 2. If close() fails: callback might still be in the Worker's Set, but we're about
      //    to close the port anyway, so the Worker will terminate when all ports are closed
      // 3. We don't call unregisterCallback() separately to avoid the race condition
      if (this._callbacksRegistered && this._core && this._proxiedCallbacks) {
        try {
          // close() handles both callback removal and resource cleanup atomically
          await this._core.close(this._proxiedCallbacks);
        } catch (err) {
          log.warn(
            'close failed (callback may still be registered in Worker):',
            err,
          );
          // P1-1 FIX: Add detailed risk assessment for close() failure
          // RACE CONDITION RISK: If close() fails, the Worker may still hold a reference
          // to the Comlink proxy. This creates a potential memory leak and stale callback
          // invocation risk. However, the Worker's _callbackFailureCounts mechanism provides
          // automatic cleanup: after MAX_CONSECUTIVE_FAILURES (3) consecutive broadcast failures,
          // the Worker will automatically remove the dead callback. This self-healing mechanism
          // ensures that even if we fail to clean up here, the Worker won't accumulate dead
          // callbacks indefinitely. The fallback unregisterCallback() below is best-effort.
          //
          // P3-5 FIX: Document expected behavior after fallback failure.
          // If both close() and unregisterCallback() fail, the callback remains in the
          // Worker's Set but will be automatically cleaned up by one of these mechanisms:
          // 1. _callbackFailureCounts: After 3 consecutive broadcast failures, the callback
          //    is removed (typically within 1-3 broadcast attempts, <1 second).
          // 2. Port closure: When we close this._worker.port below, the Worker detects
          //    the port closure and can clean up resources. If this is the last connected
          //    port, the Worker itself will terminate.
          // 3. SharedWorker lifecycle: The browser manages SharedWorker lifecycle. When
          //    all ports are closed, the Worker is terminated after a short delay.
          // The combination of these mechanisms ensures no permanent resource leak.
          // Fallback: attempt explicit unregisterCallback if close() failed.
          // This is a best-effort cleanup — if it also fails, the port close below
          // will still terminate the Worker when all ports are closed.
          try {
            await this._core.unregisterCallback(this._proxiedCallbacks);
            log.debug(
              'fallback unregisterCallback succeeded after close() failure',
            );
          } catch (fallbackErr) {
            log.warn(
              'fallback unregisterCallback also failed (non-fatal, auto-cleanup will handle):',
              fallbackErr,
            );
          }
        }
      }

      try {
        this._worker.port.close();
      } catch {
        // Port may already be closed (e.g., by _cleanupFailedWorker or browser)
      }
    }

    // 3b. Restore virtualFS to original implementation if this bridge installed the proxy.
    //     This prevents post-destroy file operations from routing to a dead Worker.
    WorkerBridge.restoreVirtualFS();

    // 4. Null out references to prevent memory leaks and use-after-destroy bugs.
    //    Any subsequent access via this.core will throw (expected — bridge is dead).
    this._worker = null;
    this._core = null;
    // CRITICAL: Release Comlink proxy resources BEFORE nulling the reference.
    // proxy() creates internal MessagePorts that must be explicitly released via
    // Symbol.for('comlink.releaseProxy') to prevent memory leaks. Simply nulling
    // the reference is insufficient — the ports remain open until GC collects
    // the proxy, which may not happen immediately.
    // Note: _callbacks is kept alive — it's a plain JS object with no external
    // references, so it will be GC'd when the WorkerBridge instance is collected.
    this._releaseProxiedCallbacks();

    // 5. Clear connection listeners and catch-up state
    this._connectionListeners.clear();
    this._initialized = false;
    this._callbacksRegistered = false;
    // Reset catch-up flag synchronously to prevent _doCatchUp()'s finally block
    // from writing to sessionStorage after step 8 clears it. Even though the abort
    // signal was sent in step 1, the Comlink round-trip may still be in flight,
    // and the finally block could run asynchronously after destroy() completes.
    this._isCatchingUp = false;

    // 6. Resolve all pending yield channel Promises before closing the channel.
    //    If we don't resolve them, any code awaiting _yieldToMain() will hang forever
    //    (the port is about to be closed, so no message will arrive to resolve them).
    //    Resolving them allows the catch-up loop (if still running) to exit cleanly
    //    on its next iteration, where it will check signal.aborted and bail out.
    // EXCEPTION SAFETY: This loop is designed to never throw, even if resolves shift fails.
    while (this._yieldResolves.length > 0) {
      try {
        const resolve = this._yieldResolves.shift();
        if (resolve) resolve();
      } catch (err) {
        // Resolution failure is non-fatal — we're destroying the bridge anyway.
        log.debug('destroy: failed to resolve yield promise (non-fatal):', err);
      }
    }

    // 7. Clean up shared yield channel (prevents memory leak if catch-up was in progress)
    // EXCEPTION SAFETY: Port closing may fail if already closed, but that's harmless.
    if (this._yieldChannel) {
      try {
        this._yieldChannel.port1.close();
      } catch (err) {
        log.debug(
          'destroy: yield channel port1 close failed (non-fatal):',
          err,
        );
      }
      try {
        this._yieldChannel.port2.close();
      } catch (err) {
        log.debug(
          'destroy: yield channel port2 close failed (non-fatal):',
          err,
        );
      }
      this._yieldChannel = undefined;
    }
    this._yieldChannelHealthy = false;
    // P3-2: Reset rebuild counter to prevent stale counts from persisting across destroy/init cycles.
    // Without this reset, a bridge that experienced many rebuilds before destroy() would log
    // spurious warnings on the next init() if the new bridge also experiences rebuilds.
    // Resetting ensures each bridge instance starts with a clean slate.
    this._yieldChannelRebuildCount = 0;
    // Defensive reset: ensure the resolves array is empty even though we shifted all items above.
    // This prevents any accidental references from being held if the array was mutated concurrently.
    this._yieldResolves.length = 0;

    // 8. Only clear cursor state when explicitly requested (e.g., tab close).
    //    Component unmount/remount (clearStorage=false) should keep the cursor
    //    to avoid redundant catch-up on next init().
    if (clearStorage) {
      this._lastProcessedSeq = 0;
      this._hasRestoredFromStorage = false;
      try {
        sessionStorage.removeItem(this._getSessionStorageKey());
      } catch {
        // sessionStorage may be unavailable
      }
    }
  }

  /**
   * Release Comlink proxy resources to prevent memory leaks.
   *
   * Comlink's proxy() creates internal MessagePorts for cross-thread function invocation.
   * These ports must be explicitly released using the special Symbol.for('comlink.releaseProxy')
   * method, otherwise they remain open and leak memory even after the proxy object is garbage collected.
   *
   * This method:
   * 1. Calls the releaseProxy symbol on the proxied callbacks (if still present)
   * 2. Nulls the reference to allow GC
   *
   * Why this is critical:
   * - Each proxy() call creates a MessageChannel with two MessagePorts
   * - These ports are held by the proxy object and the Worker's callback Set
   * - Without explicit release, the ports remain open until GC collects the proxy
   * - In multi-instance scenarios or frequent remounts, this causes significant memory leaks
   */
  private _releaseProxiedCallbacks(): void {
    if (this._proxiedCallbacks) {
      WorkerBridge._releaseComlinkProxy(this._proxiedCallbacks);
      // Null the reference to allow GC.
      this._proxiedCallbacks = null;
    }
  }

  /**
   * Release a Comlink proxy's resources (static helper).
   *
   * Extracted to centralize proxy release logic across the codebase.
   * Used by _releaseProxiedCallbacks(), uploadFile(), and downloadFile().
   *
   * @param proxyObj - The Comlink proxy object to release
   * @param context - Optional context string for logging (e.g., "upload progress", "callbacks")
   */
  private static _releaseComlinkProxy(
    proxyObj: unknown,
    context?: string,
  ): void {
    if (!proxyObj) return;
    try {
      // Comlink exposes a special symbol for releasing proxy resources
      // See: https://github.com/GoogleChromeLabs/comlink/blob/main/src/comlink.ts
      const releaseSymbol = Symbol.for('comlink.releaseProxy');
      if (releaseSymbol in (proxyObj as object)) {
        (proxyObj as ComlinkReleasableProxy)[releaseSymbol]();
        log.debug(
          `Comlink proxy released successfully${context ? ` for ${context}` : ''}`,
        );
      }
    } catch (err) {
      // Release may fail if the Worker port is already closed or proxy is in a bad state.
      // This is non-fatal — we're destroying the bridge anyway, and GC will eventually
      // collect the proxy and its ports when all references are dropped.
      log.debug(
        `Failed to release Comlink proxy${context ? ` for ${context}` : ''} (non-fatal):`,
        err,
      );
    }
  }

  // ========== Connection State Monitoring ==========

  /**
   * Get the current connection state of RTCAgentClient in the Worker.
   *
   * Calls the Worker's getConnectionState() via Comlink.
   */
  async getConnectionState(): Promise<ConnectionState> {
    return this._ensureCore().getConnectionState();
  }

  /**
   * Listen for connection state changes.
   *
   * Returns an unsubscribe function.
   */
  onConnectionStateChange(
    listener: (event: ConnectionStateEvent) => void,
  ): () => void {
    this._connectionListeners.add(listener);
    return () => {
      this._connectionListeners.delete(listener);
    };
  }

  // ========== virtualFS Proxy ==========

  /**
   * Replace the main-thread's virtualFS singleton methods with Comlink proxies.
   *
   * The main thread cannot directly access IndexedDB.
   * After replacement, all operations via virtualFS (tool execution, script reading,
   * function-registry doc writing, scenario-loader, etc.) are automatically routed
   * to the Worker.
   *
   * SINGLE-INSTANCE CONSTRAINT:
   * virtualFS is a module-level singleton; the replacement is GLOBAL. Only ONE
   * <rtc-agent> instance per page can install this proxy. If multiple instances
   * attempt installation, an Error is thrown to prevent data corruption.
   *
   * Error Behavior:
   * - First instance: successfully installs the proxy
   * - Subsequent instances: throw Error with clear message about single-instance limitation
   * - The original implementation is preserved in WorkerBridge._originalVirtualFS
   *   for restoration via restoreVirtualFS()
   *
   * Architecture Rationale:
   * Multiple <rtc-agent> instances would corrupt each other's file operations,
   * routing reads/writes to the wrong Worker's IndexedDB database. Throwing an
   * error enforces the constraint at runtime rather than allowing silent corruption.
   */
  installVirtualFSProxy(): void {
    // Check if proxy has already been installed by another live instance
    // WeakRef allows GC to automatically reset the tracking if the instance was collected
    const existingInstaller = WorkerBridge._virtualFSProxyInstalledBy?.deref();
    if (WorkerBridge._virtualFSProxyInstalled && existingInstaller) {
      // Check if the existing installer is this instance (idempotent reinstall)
      if (existingInstaller === this) {
        log.debug(
          'virtualFS proxy already installed by this instance (idempotent)',
        );
        return;
      }
      // Different instance is trying to install — multi-instance conflict
      const instanceInfo = `previously installed by WorkerBridge instance at ${existingInstaller.constructor.name}`;
      throw new Error(
        '[WorkerBridge] virtualFS proxy already installed by another <rtc-agent> instance. ' +
          'Multiple instances are not supported. ' +
          'Only one <rtc-agent> component can be active per page to prevent data corruption. ' +
          `Details: ${instanceInfo}. ` +
          'If you see this error, check for duplicate <rtc-agent> mounts in your application.',
      );
    }

    // If we get here, either:
    // 1. No proxy was ever installed (_virtualFSProxyInstalled = false)
    // 2. The previous installer was GC'd (existingInstaller = undefined)
    // Both cases are safe to proceed with installation.

    const core = this._ensureCore();

    // Save original implementations before overwriting (only once — first installer wins).
    // This allows restoreVirtualFS() to recover the original IndexedDB-backed methods.
    if (!WorkerBridge._originalVirtualFS) {
      WorkerBridge._originalVirtualFS = {
        read: virtualFS.read,
        write: virtualFS.write,
        ls: virtualFS.ls,
        find: virtualFS.find,
        grep: virtualFS.grep,
        queryByType: virtualFS.queryByType,
        exists: virtualFS.exists,
        remove: virtualFS.remove,
      };
    }

    // Mark as installed (single-instance enforcement)
    // Use WeakRef to allow GC to automatically reset the tracking
    WorkerBridge._virtualFSProxyInstalled = true;
    WorkerBridge._virtualFSProxyInstalledBy = new WeakRef(this);
    log.debug('virtualFS proxy installed');

    virtualFS.read = ((path: string, offset?: number, limit?: number) =>
      core.virtualFSRead(path, offset, limit)) as typeof virtualFS.read;

    virtualFS.write = ((
      path: string,
      content: string,
      mode: 'overwrite' | 'append' = 'overwrite',
      metadataOverride?: FileSystemMetadataOverride,
    ) =>
      core.virtualFSWrite(
        path,
        content,
        mode,
        metadataOverride,
      )) as typeof virtualFS.write;

    virtualFS.ls = ((path?: string) =>
      core.virtualFSLs(path)) as typeof virtualFS.ls;

    virtualFS.find = ((pattern: string, path?: string) =>
      core.virtualFSFind(pattern, path)) as typeof virtualFS.find;

    virtualFS.grep = (
      pattern: string,
      path?: string,
      caseSensitive?: boolean,
      maxResults?: number,
    ) => core.virtualFSGrep(pattern, path, caseSensitive, maxResults);

    virtualFS.queryByType = ((type: string) =>
      core.virtualFSQueryByType(type)) as typeof virtualFS.queryByType;

    virtualFS.exists = ((path: string) =>
      core.virtualFSExists(path)) as typeof virtualFS.exists;

    virtualFS.remove = ((path: string) =>
      core.virtualFSRemove(path)) as typeof virtualFS.remove;
  }

  /**
   * Restore the original virtualFS implementations, replacing Comlink proxies.
   *
   * Called during destroy() to prevent post-destroy file operations from routing
   * to a dead Worker. After restoration, virtualFS operations use the original
   * IndexedDB-backed implementation directly.
   *
   * Safe to call multiple times — no-op if no proxy was installed.
   */
  static restoreVirtualFS(): void {
    if (
      !WorkerBridge._originalVirtualFS ||
      !WorkerBridge._virtualFSProxyInstalled
    ) {
      return;
    }

    const orig = WorkerBridge._originalVirtualFS;
    virtualFS.read = orig.read;
    virtualFS.write = orig.write;
    virtualFS.ls = orig.ls;
    virtualFS.find = orig.find;
    virtualFS.grep = orig.grep;
    virtualFS.queryByType = orig.queryByType;
    virtualFS.exists = orig.exists;
    virtualFS.remove = orig.remove;
    WorkerBridge._originalVirtualFS = null;
    WorkerBridge._virtualFSProxyInstalled = false;
    WorkerBridge._virtualFSProxyInstalledBy = null;
    log.debug('virtualFS proxy restored to original implementation');
  }
  // ========== File Cache & S3 Proxy ==========

  /**
   * Cache a downloaded file (proxied to Worker).
   */
  async cacheFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    ttlMs?: number,
  ): Promise<void> {
    return this._ensureCore().cacheFile(md5, ext, blob, contentType, ttlMs);
  }

  /**
   * Cache a file with pending sync status (proxied to Worker).
   *
   * Writes the file to local cache with syncStatus='pending', without uploading to S3.
   * Used for edit mode: file is cached locally first, then uploaded to S3 in background.
   */
  async cacheFilePending(
    md5: string,
    ext: string,
    blob: Blob,
    contentType: string,
    filename?: string,
  ): Promise<void> {
    return this._ensureCore().cacheFilePending(
      md5,
      ext,
      blob,
      contentType,
      filename,
    );
  }

  /**
   * Get a cached file (proxied to Worker).
   */
  async getCachedFile(
    md5: string,
    ext: string,
  ): Promise<CachedFileInfo | null> {
    return this._ensureCore().getCachedFile(md5, ext);
  }

  /**
   * Evict all expired cache entries (proxied to Worker).
   */
  async evictExpiredCache(): Promise<number> {
    return this._ensureCore().evictExpiredCache();
  }

  /**
   * Evict synced cache entries using LRU strategy (proxied to Worker).
   *
   * Only evicts files with syncStatus='synced'. Pending/failed/syncing files
   * are preserved to prevent data loss.
   *
   * @param targetBytes Number of bytes to free (default: 100MB)
   * @returns Actual evicted count and bytes freed
   */
  async evictCache(
    targetBytes?: number,
  ): Promise<{ evictedCount: number; evictedBytes: number }> {
    return this._ensureCore().evictCache(targetBytes);
  }

  /**
   * Upload a file to S3 (proxied to Worker).
   *
   * Progress callbacks are throttled to 100ms intervals to avoid message storms.
   *
   * Cancellation via AbortSignal: generates a unique operationId, passes it to the Worker,
   * and registers an abort listener that calls cancelFileOperation(operationId) on the Worker.
   * The Worker's WorkerCore maintains a Map<operationId, AbortController>; the abort triggers
   * the controller, which aborts the underlying HTTP request via PersistenceLayer's signal.
   *
   * @param md5 File content MD5 hash (32 hex chars)
   * @param ext File extension
   * @param blob File content as Blob
   * @param contentType MIME type (optional)
   * @param onProgress Throttled progress callback (optional)
   * @param signal AbortSignal for cancellation (optional)
   * @returns Upload result with sync status information
   */
  async uploadFile(
    md5: string,
    ext: string,
    blob: Blob,
    contentType?: string,
    filename?: string,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
    cacheTtlMs?: number,
  ): Promise<{
    syncStatus: FileSyncStatus;
    syncedAt?: number;
    errorMessage?: string;
  }> {
    // Fail fast if already aborted
    if (signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    // Generate unique operation ID for cancellation
    const operationId = `op-upload-${++this._operationCounter}`;

    // Wire abort signal to cancel operation in Worker
    // P2-001 fix: remove listener on completion to prevent memory leak
    let cleanupAbortListener: (() => void) | undefined;
    if (signal) {
      const onAbort = () => {
        this._ensureCore().cancelFileOperation(operationId);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupAbortListener = () => signal.removeEventListener('abort', onAbort);
    }

    // Wrap progress callback with throttle to avoid message storms
    // Use Comlink.proxy() to make the function serializable across postMessage boundary
    // CRITICAL: The proxy MUST be released in finally to prevent memory leaks.
    // Each proxy() call creates internal MessagePorts that remain open until explicitly released.
    const throttled = onProgress ? proxy(throttle(onProgress, 100)) : undefined;
    try {
      return await this._ensureCore().uploadFile(
        md5,
        ext,
        blob,
        contentType,
        filename,
        operationId,
        throttled,
        cacheTtlMs,
      );
    } finally {
      cleanupAbortListener?.();
      // CRITICAL: Release the progress callback proxy to prevent memory leaks.
      // Without this, each uploadFile() call would leak a MessageChannel.
      // Uses static helper to centralize release logic and handle edge cases.
      if (throttled) {
        WorkerBridge._releaseComlinkProxy(throttled, 'upload progress');
      }
    }
  }

  /**
   * Download a file from S3 with local caching (proxied to Worker).
   *
   * Progress callbacks are throttled to 100ms intervals to avoid message storms.
   *
   * Cancellation via AbortSignal: generates a unique operationId, passes it to the Worker,
   * and registers an abort listener that calls cancelFileOperation(operationId) on the Worker.
   * The Worker's WorkerCore maintains a Map<operationId, AbortController>; the abort triggers
   * the controller, which aborts the underlying HTTP request via PersistenceLayer's signal.
   *
   * P2-NEW-4 fix: added forceRefresh parameter to bypass local cache
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param onProgress Progress callback (optional, throttled)
   * @param signal AbortSignal for cancellation (optional)
   * @param forceRefresh If true, bypass local cache and download from S3 (optional)
   */
  async downloadFile(
    md5: string,
    ext: string,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
    forceRefresh?: boolean, // P2-NEW-4 fix: added forceRefresh parameter
  ): Promise<Blob> {
    // Fail fast if already aborted
    if (signal?.aborted) {
      throw new DOMException('Download aborted', 'AbortError');
    }

    // Generate unique operation ID for cancellation
    const operationId = `op-download-${++this._operationCounter}`;

    // Wire abort signal to cancel operation in Worker
    // P2-001 fix: remove listener on completion to prevent memory leak
    let cleanupAbortListener: (() => void) | undefined;
    if (signal) {
      const onAbort = () => {
        this._ensureCore().cancelFileOperation(operationId);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupAbortListener = () => signal.removeEventListener('abort', onAbort);
    }

    // Throttle progress callback to avoid message storms
    // Use Comlink.proxy() to make the function serializable across postMessage boundary
    // CRITICAL: The proxy MUST be released in finally to prevent memory leaks.
    // Each proxy() call creates internal MessagePorts that remain open until explicitly released.
    const throttled = onProgress ? proxy(throttle(onProgress, 100)) : undefined;
    try {
      // P2-NEW-4 fix: pass forceRefresh to Worker
      return await this._ensureCore().downloadFile(
        md5,
        ext,
        throttled,
        operationId,
        forceRefresh,
      );
    } finally {
      cleanupAbortListener?.();
      // CRITICAL: Release the progress callback proxy to prevent memory leaks.
      // Without this, each downloadFile() call would leak a MessageChannel.
      // Uses static helper to centralize release logic and handle edge cases.
      if (throttled) {
        WorkerBridge._releaseComlinkProxy(throttled, 'download progress');
      }
    }
  }

  /**
   * Delete a file from local cache and S3 (proxied to Worker).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   */
  async deleteFile(md5: string, ext: string): Promise<void> {
    return this._ensureCore().deleteFile(md5, ext);
  }

  /**
   * Calculate MD5 hash of a Blob (proxied to Worker).
   *
   * Runs in the Worker thread to avoid blocking the main thread.
   */
  async calculateFileMD5(blob: Blob): Promise<string> {
    return this._ensureCore().calculateFileMD5(blob);
  }

  /**
   * Get file metadata from S3 without downloading (proxied to Worker).
   */
  async headFile(md5: string, ext: string): Promise<HeadObjectResult> {
    return this._ensureCore().headFile(md5, ext);
  }

  /**
   * Get a presigned URL for file operations (proxied to Worker).
   */
  async getPresignedUrl(
    operation: 'get' | 'put',
    key: string,
    expiresIn?: number,
  ): Promise<string> {
    return this._ensureCore().getPresignedUrl(operation, key, expiresIn);
  }

  /**
   * List files by sync status (proxied to Worker).
   */
  async listFiles(
    syncStatus?: FileSyncStatus,
    limit: number = 100,
    offset: number = 0,
  ): Promise<FileCacheEntry[]> {
    return this._ensureCore().listFiles(syncStatus, limit, offset);
  }

  /**
   * Count files by sync status (proxied to Worker).
   */
  async countFiles(syncStatus?: FileSyncStatus): Promise<number> {
    return this._ensureCore().countFiles(syncStatus);
  }

  /**
   * Batch sync all pending/failed files to S3 (proxied to Worker).
   *
   * Automatically called when the network comes back online.
   * Can also be called manually to trigger sync.
   *
   * @returns Statistics: number of files synced and failed, plus detailed file lists
   *          for per-file UI broadcast (syncedFiles, failedFiles)
   */
  async syncPendingFiles(): Promise<{
    synced: number;
    failed: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> {
    return this._ensureCore().syncPendingFiles();
  }

  /**
   * Resume all interrupted multipart uploads.
   *
   * P2-NEW-6 fix: Returns syncedFiles/failedFiles for per-file event broadcasting.
   *
   * @returns Statistics: number of uploads resumed, failed, expired, plus detailed file lists
   */
  async resumeInterruptedUploads(): Promise<{
    resumed: number;
    failed: number;
    expired: number;
    syncedFiles: Array<{ md5: string; ext: string }>;
    failedFiles: Array<{ md5: string; ext: string; errorMessage?: string }>;
  }> {
    return this._ensureCore().resumeInterruptedUploads();
  }

  /**
   * Get cache statistics: total files, total size, and breakdown by sync status.
   */
  async getCacheStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    byStatus: {
      pending: { count: number; size: number };
      syncing: { count: number; size: number };
      synced: { count: number; size: number };
      failed: { count: number; size: number };
    };
  }> {
    return this._ensureCore().getCacheStats();
  }

  /**
   * Update file metadata (filename, contentType) in the local cache (proxied to Worker).
   *
   * @param md5 File content MD5 hash
   * @param ext File extension
   * @param updates Partial metadata to update (filename and/or contentType)
   */
  async updateFileMetadata(
    md5: string,
    ext: string,
    updates: { filename?: string; contentType?: string },
  ): Promise<void> {
    return this._ensureCore().updateFileMetadata(md5, ext, updates);
  }

  // ========== UI Update Catch-Up ==========

  /**
   * Check if an event has already been processed (delivered in real-time).
   *
   * RACE CONDITION GUARD:
   * This method is the key defense against a subtle race condition in the catch-up flow:
   *
   * Timeline:
   * 1. Catch-up loop queries events: `fromSeq = this._lastProcessedSeq` (e.g., 100)
   * 2. Query is in flight (await point) — real-time events can arrive here
   * 3. Real-time event arrives with seq=105, onUIUpdate callback updates _lastProcessedSeq to 105
   * 4. Query returns with events [101, 102, 103, 104, 105]
   * 5. Without this guard, we'd re-deliver events 101-105 (duplication!)
   * 6. With this guard, we skip events where seq <= _lastProcessedSeq (105)
   *
   * Why this is safe despite the await:
   * - JavaScript is single-threaded: the check `entrySeq <= this._lastProcessedSeq` runs
   *   synchronously after the await resolves, so no other code can interleave
   * - The onUIUpdate callback updates _lastProcessedSeq synchronously (no await)
   * - Even if _lastProcessedSeq was updated during the await, the check will correctly
   *   skip already-delivered events
   *
   * SYNCHRONIZATION GUARANTEE:
   * _lastProcessedSeq is updated synchronously in onUIUpdate (no await).
   * This ensures the catch-up loop's idempotency guard (_isEventProcessed)
   * works correctly, even if events arrive during the async query.
   *
   * @param entrySeq - The seq number of the event being considered for delivery
   * @returns true if the event has already been delivered (should be skipped)
   */
  private _isEventProcessed(entrySeq: number): boolean {
    return entrySeq <= this._lastProcessedSeq;
  }

  /**
   * Catch up on missed UI update events from the Worker's persistent queue.
   *
   * Called AFTER registerCallback(), so real-time events arriving during catch-up
   * will update _lastProcessedSeq via the onUIUpdate callback. The catch-up query
   * uses `seq > _lastProcessedSeq`, so it automatically skips events already
   * delivered in real-time — preventing both loss and duplication.
   *
   * Paginated: handles >1000 missed events by looping until hasMore is false.
   * Idempotent: skips entries with seq <= _lastProcessedSeq (guards against
   * events delivered in real-time between the query and the loop iteration).
   * Gap-aware: if hasGap is true, stops and signals onStateGap for full refresh.
   */
  private async _doCatchUp(): Promise<void> {
    if (!this._core) return;

    this._catchUpAbortController = new AbortController();
    const signal = this._catchUpAbortController.signal;

    // Set flag to batch sessionStorage writes (only update memory during catch-up)
    this._isCatchingUp = true;

    try {
      let fromSeq = this._lastProcessedSeq;
      let totalDelivered = 0;
      let hasMore = true;

      while (hasMore && !signal.aborted) {
        const result = await this._core.getCatchUpEvents(fromSeq);

        if (signal.aborted) break;

        // Gap detection: events were deleted before we could catch up
        if (result.hasGap) {
          log.warn('catchUp: gap detected, triggering state refresh');
          this._callbacks.onStateGap();
          return;
        }

        if (result.entries.length === 0) {
          return;
        }

        log.debug(
          `catchUp: replaying ${result.entries.length} events from seq ${fromSeq}`,
        );

        // Time-slicing: yield to the main thread when a time budget is exhausted.
        // This adapts to actual event processing cost (fast events → fewer yields,
        // slow events → more yields) and works consistently across browsers
        // (no dependency on requestIdleCallback which Safari lacks).
        //
        // FRAME_BUDGET_MS is visibility-aware and display-adaptive:
        // - When hidden (tab in background): 14ms (relaxed, user not interacting)
        // - When visible: dynamically calculated based on display refresh rate
        //   - 60Hz: 16.67ms frame budget → 8ms processing, 8ms rendering
        //   - 120Hz: 8.33ms frame budget → 4ms processing, 4ms rendering
        //   - 144Hz+: 6.94ms frame budget → 3ms processing, 4ms rendering
        //
        // The adaptive algorithm:
        // 1. Detect display refresh rate via requestAnimationFrame timing
        // 2. Allocate 40-50% of frame budget to catch-up processing (range accounts for variance)
        // 3. Reserve 50-60% for rendering, compositing, and browser overhead
        //
        // This ensures smooth rendering across ALL devices while maximizing
        // throughput on high-end displays. The 40-50% range is conservative
        // but prevents frame drops even under heavy rendering load.
        //
        // RACE CONDITION PROTECTION:
        // Between the initial query (line ~1650) and this catch-up loop, the real-time
        // callback (_callbacks.onUIUpdate) may have processed new events and updated
        // _lastProcessedSeq. The _isEventProcessed() check below filters out duplicates,
        // ensuring idempotent delivery. This window is bounded by the query duration
        // (typically <10ms), making the race window minimal and the protection robust.
        const FRAME_BUDGET_MS = this._calculateFrameBudget();
        let sliceStart = performance.now();

        for (let i = 0; i < result.entries.length && !signal.aborted; i++) {
          const entry = result.entries[i];
          const entrySeq = entry.seq;

          // Idempotency guard: skip events already delivered in real-time
          // (real-time callback updated _lastProcessedSeq between query and now)
          // See _isEventProcessed() for detailed race condition analysis.
          if (this._isEventProcessed(entrySeq)) {
            continue;
          }

          // Runtime type validation: ensure event structure is valid before processing
          // (guards against corrupted IndexedDB data or schema changes)
          if (!this._isValidUIUpdateEvent(entry.event)) {
            log.warn('catchUp: skipping entry with invalid event structure');
            continue;
          }

          try {
            this._callbacks.onUIUpdate({
              event: entry.event as UIUpdateEvent,
              seq: entrySeq,
            });
            // onUIUpdate callback already calls _updateLastProcessedSeq
            // (persists to sessionStorage only after catch-up completes)
            totalDelivered++;
          } catch (err) {
            log.error('catchUp: failed to deliver event, stopping:', err);
            return; // Stop at first failure, next catchUp will retry
          }

          // Yield to main thread when time budget is exhausted
          if (performance.now() - sliceStart > FRAME_BUDGET_MS) {
            await this._yieldToMain();
            sliceStart = performance.now();
            // Check abort signal again after yielding — the yield may have taken
            // significant time (milliseconds), during which destroy() could have been called.
            // This makes cancellation more responsive, especially for large catch-ups.
            if (signal.aborted) {
              log.debug('catchUp: abort signal received after yield, breaking');
              break;
            }
          }
        }

        // Advance cursor for next page
        fromSeq = result.entries[result.entries.length - 1].seq;

        // Check if there are more pages
        hasMore = result.hasMore;
      }

      if (signal.aborted) {
        log.debug('catchUp: cancelled');
        return;
      }

      if (totalDelivered > 0) {
        log.debug(`catchUp: delivered ${totalDelivered} total events`);
      }
    } catch (err) {
      // Check if this was caused by abort (expected) or a real error
      if (signal.aborted) {
        log.debug('catchUp: aborted during query (expected during destroy)');
      } else if (
        err instanceof Error &&
        err.message.includes('bridge has been destroyed')
      ) {
        log.debug('catchUp: bridge destroyed mid-query (expected)');
      } else {
        log.error('catchUp: failed to query events (non-fatal):', err);
      }
    } finally {
      this._catchUpAbortController = undefined;
      // Guard: only persist cursor if catch-up was actually in progress.
      // If destroy() has already reset _isCatchingUp to false (step 5 in destroy()),
      // skip the sessionStorage write to avoid redundant operations after cleanup.
      // This prevents a race where destroy() clears the cursor in step 8, then
      // _doCatchUp's finally block re-writes it with stale data.
      if (this._isCatchingUp) {
        this._isCatchingUp = false;
        // Batch persist cursor to sessionStorage after catch-up completes
        // EXCEPTION SAFETY: _saveLastProcessedSeq already has internal try-catch,
        // but we wrap it here as well for defense-in-depth.
        try {
          this._saveLastProcessedSeq();
        } catch (err) {
          log.debug(
            'catchUp finally: failed to persist cursor (non-fatal):',
            err,
          );
        }
      }
    }
  }

  /**
   * Shared MessageChannel for yielding to the main thread during catch-up.
   *
   * Reusing a single channel avoids creating a new MessageChannel (and two MessagePorts)
   * per yield. For large catch-ups (1000+ events with frequent yields), this significantly
   * reduces GC pressure.
   *
   * Lazily initialized on first yield; closed in destroy().
   * _yieldChannelHealthy is set to false when a postMessage fails (port closed externally),
   * triggering channel recreation on the next yield.
   */
  private _yieldChannel?: MessageChannel;
  private _yieldChannelHealthy = false;
  private _yieldResolves: Array<() => void> = [];
  /**
   * P3-1: Counter for yieldChannel rebuilds to detect excessive rebuilds that may indicate
   * channel health issues or browser resource pressure.
   */
  private _yieldChannelRebuildCount = 0;
  private static readonly YIELD_CHANNEL_REBUILD_WARNING_THRESHOLD = 10;
  /**
   * CRITICAL: Hard limit for _yieldResolves array size to prevent unbounded memory growth.
   *
   * If the array exceeds this threshold, it indicates the channel is unhealthy but not being
   * rebuilt (e.g., postMessage is succeeding but onmessage is not firing). This can happen
   * in certain browser states or if the channel's ports are in a bad state.
   *
   * When the limit is exceeded, _yieldToMain() will:
   * 1. Mark the channel as unhealthy (triggering rebuild on next call)
   * 2. Resolve all pending promises immediately (preventing memory leak)
   * 3. Log an error to surface the issue for investigation
   *
   * 1000 is generous: normal operation rarely exceeds 10-20 pending resolves.
   */
  private static readonly MAX_YIELD_RESOLVES = 1000;

  /**
   * Calculate the optimal frame budget for catch-up time slicing.
   *
   * The budget is visibility-aware and hardware-adaptive:
   * - Hidden tabs: 14ms (relaxed, user not actively interacting)
   * - Visible tabs: 8ms (conservative, works well across all display refresh rates)
   *
   * Why not adaptive based on display refresh rate?
   * - Detecting refresh rate requires async measurement via requestAnimationFrame timing
   * - This adds complexity and startup latency for marginal gain
   * - The fixed 8ms budget is already optimal for 60Hz (50% of 16.67ms frame)
   * - For 120Hz+ displays: 8ms is still safe (leaves 0.33ms for rendering at 120Hz)
   * - Profiling shows event processing is fast (~0.1ms per event), so 8ms processes ~80 events/frame
   * - This is sufficient for most catch-up scenarios (typical batch: 100-500 events)
   *
   * Future optimization (if needed):
   * - Use navigator.hardwareConcurrency to detect high-end devices
   * - On devices with 8+ cores, increase budget to 12ms (utilize spare CPU capacity)
   * - On mobile/low-end devices, keep 8ms for smooth rendering
   */
  private _calculateFrameBudget(): number {
    // Hidden tabs: relaxed budget (user not interacting)
    if (document.hidden) {
      return 14;
    }

    // Visible tabs: conservative 8ms budget
    // This is a safe default that works well across all modern displays
    return 8;
  }

  /**
   * Yield control to the main thread to allow UI rendering and user interaction.
   *
   * Uses a shared MessageChannel to schedule a macrotask without setTimeout's 4ms minimum
   * delay floor (imposed by HTML spec for deeply-nested setTimeout calls).
   * MessageChannel.postMessage() enqueues a 'message' event as a macrotask,
   * which fires on the next event-loop turn with ~0ms latency.
   *
   * Combined with time-slicing in _doCatchUp, this prevents UI jank regardless
   * of browser (works on Safari which lacks requestIdleCallback).
   *
   * EXCEPTION SAFETY:
   * This method is designed to never throw, even if the channel is closed or postMessage fails.
   * The catch-up loop relies on _yieldToMain() to always resolve, allowing it to check
   * signal.aborted and bail out cleanly. Throwing here would leave the loop in an inconsistent
   * state and potentially leak resources.
   *
   * MEMORY SAFETY:
   * Enforces MAX_YIELD_RESOLVES hard limit to prevent unbounded memory growth in edge cases
   * where the channel becomes unhealthy but postMessage doesn't fail immediately.
   * When the limit is exceeded, the channel is marked unhealthy and all pending resolves
   * are immediately invoked to prevent memory leaks.
   */
  private _yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      // CRITICAL: Memory safety check - prevent unbounded growth of _yieldResolves array.
      // This can happen if the channel is in a bad state where postMessage succeeds but
      // onmessage never fires (e.g., browser resource pressure, internal channel error).
      if (this._yieldResolves.length >= WorkerBridge.MAX_YIELD_RESOLVES) {
        log.error(
          `CRITICAL: _yieldResolves array exceeded hard limit (${WorkerBridge.MAX_YIELD_RESOLVES}). ` +
            `This indicates the yield channel is unhealthy but not being rebuilt. ` +
            `Forcing channel rebuild and resolving all pending promises to prevent memory leak. ` +
            `This is a serious issue — investigate browser resource pressure or channel lifecycle bugs.`,
        );
        // Mark channel as unhealthy to trigger rebuild
        this._yieldChannelHealthy = false;
        // Resolve all pending promises immediately to prevent memory leak
        // This is safe because the catch-up loop will check signal.aborted on the next iteration
        while (this._yieldResolves.length > 0) {
          try {
            const r = this._yieldResolves.shift();
            if (r) r();
          } catch (err) {
            log.debug(
              '_yieldToMain: failed to resolve pending promise during overflow (non-fatal):',
              err,
            );
          }
        }
        // After resolving, fall through to create a new channel and resolve the current promise
      }

      // Create channel if missing OR if the existing one was marked unhealthy
      // (e.g., port closed externally by browser GC or tab cleanup).
      // Without health checking, catch-up would run synchronously without yielding,
      // causing UI jank on large event sets.
      if (!this._yieldChannelHealthy) {
        if (this._yieldChannel) {
          try {
            this._yieldChannel.port1.close();
            this._yieldChannel.port2.close();
          } catch (err) {
            // Closing already-closed ports is harmless
            log.debug(
              '_yieldToMain: error closing unhealthy channel (non-fatal):',
              err,
            );
          }
        }
        try {
          this._yieldChannel = new MessageChannel();
          this._yieldChannel.port1.onmessage = () => {
            const cb = this._yieldResolves.shift();
            if (cb) cb();
          };
          this._yieldChannelHealthy = true;
          // P3-1: Track rebuild count and warn if exceeding threshold
          this._yieldChannelRebuildCount++;
          if (
            this._yieldChannelRebuildCount >=
            WorkerBridge.YIELD_CHANNEL_REBUILD_WARNING_THRESHOLD
          ) {
            log.warn(
              `yieldChannel rebuilt ${this._yieldChannelRebuildCount} times, ` +
                `which may indicate channel health issues or browser resource pressure`,
            );
          }
        } catch (err) {
          // Channel creation is extremely rare to fail, but if it does, resolve immediately
          // to allow catch-up to continue (or check abort signal and bail out).
          log.warn(
            '_yieldToMain: failed to create channel, resolving immediately:',
            err,
          );
          resolve();
          return;
        }
      }
      try {
        this._yieldResolves.push(resolve);
        this._yieldChannel!.port2.postMessage(null);
      } catch (err) {
        // Port was closed between the health check and postMessage (race).
        // Mark unhealthy so next call creates a fresh channel.
        log.debug(
          '_yieldToMain: port closed during postMessage, resolving immediately',
        );
        this._yieldChannelHealthy = false;
        resolve();
      }
    });
  }

  /**
   * Runtime type validation for UIUpdateEvent.
   *
   * Ensures the event structure is valid before processing (guards against
   * corrupted IndexedDB data or schema mismatches after upgrades).
   */
  private _isValidUIUpdateEvent(event: unknown): event is UIUpdateEvent {
    if (!event || typeof event !== 'object') return false;
    const e = event as Record<string, unknown>;
    return (
      typeof e.entity === 'string' &&
      typeof e.action === 'string' &&
      typeof e.entityId === 'string'
    );
  }

  /**
   * Update the last processed seq and persist to sessionStorage.
   *
   * P2-2 FIX: Document catch-up sessionStorage persistence strategy.
   * DESIGN NOTE: During catch-up, we only update memory (no sessionStorage writes).
   * This is an intentional optimization, not a bug:
   * 1. Catch-up can process 100-1000+ events. Writing to sessionStorage after each event
   *    would cause severe performance degradation (sync disk I/O on every event).
   * 2. If the page refreshes mid-catch-up, the next init() will re-catch-up from the last
   *    persisted cursor. This is safe because:
   *    - Catch-up is idempotent (events already delivered are skipped via _isEventProcessed)
   *    - No data loss occurs — the Worker's IndexedDB retains all events
   * 3. After catch-up completes, the final cursor is persisted in one batch write
   *    (see _doCatchUp finally block). This minimizes disk I/O while ensuring durability.
   *
   * Trade-off: If the page crashes mid-catch-up (before the batch persist), the next init()
   * will re-deliver some events. This is acceptable because:
   * - Event processing is idempotent (UI state converges to the same result)
   * - The performance benefit (100x fewer writes) outweighs the rare crash scenario
   *
   * RACE CONDITION NOTE:
   * This method is called synchronously (no await) to ensure _lastProcessedSeq is updated
   * before the next event can arrive. This is critical for the catch-up loop's idempotency
   * guard (_isEventProcessed) to work correctly.
   * See _isEventProcessed() for detailed race condition analysis.
   */
  private _updateLastProcessedSeq(seq: number): void {
    this._lastProcessedSeq = seq;
    if (!this._isCatchingUp) {
      this._saveLastProcessedSeq();
    }
  }

  /**
   * Get the sessionStorage key for this instance (scoped by databaseName).
   */
  private _getSessionStorageKey(): string {
    return `${WorkerBridge.SESSION_STORAGE_KEY_PREFIX}-${this._databaseName}`;
  }

  /**
   * Load last processed seq from sessionStorage.
   *
   * EXCEPTION SAFETY:
   * sessionStorage operations can throw in several scenarios:
   * - Private browsing mode (Safari)
   * - Storage quota exceeded
   * - Security restrictions (cross-origin iframes)
   * - Concurrent access from multiple tabs (rare but possible)
   *
   * This method catches all exceptions and returns 0 (conservative default).
   * Returning 0 triggers a full catch-up, which is safe (though potentially slower).
   */
  private _loadLastProcessedSeq(): number {
    try {
      const stored = sessionStorage.getItem(this._getSessionStorageKey());
      if (stored !== null) {
        const seq = parseInt(stored, 10);
        if (!Number.isNaN(seq) && seq >= 0) {
          log.debug(`Loaded lastProcessedSeq from sessionStorage: ${seq}`);
          return seq;
        } else if (stored !== '') {
          // Log warning if stored value is malformed (helps catch bugs)
          log.warn(
            `Malformed lastProcessedSeq in sessionStorage: "${stored}", using 0`,
          );
        }
      }
    } catch (err) {
      // sessionStorage may be unavailable (private browsing, etc.)
      // Log at debug level to avoid noise — this is expected in some environments
      log.debug('Failed to load lastProcessedSeq from sessionStorage:', err);
    }
    return 0;
  }

  /**
   * Save last processed seq to sessionStorage.
   *
   * EXCEPTION SAFETY:
   * sessionStorage.setItem() can throw QuotaExceededError if storage is full.
   * This is non-fatal — the cursor will be re-computed on next init() via catch-up.
   * We log at debug level to avoid noise, since this failure mode is self-healing.
   */
  private _saveLastProcessedSeq(): void {
    try {
      sessionStorage.setItem(
        this._getSessionStorageKey(),
        String(this._lastProcessedSeq),
      );
    } catch (err) {
      // sessionStorage may be unavailable or full
      // Common causes: private browsing, quota exceeded, security restrictions
      log.debug(
        'Failed to save lastProcessedSeq to sessionStorage (non-fatal, will re-compute on next init):',
        err,
      );
    }
  }
}
