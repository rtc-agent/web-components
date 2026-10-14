# Error Handling Strategy

This document describes the error handling patterns used throughout the RTC Agent component.

## Overview

The component uses a **layered error handling strategy** based on error criticality and recovery potential:

1. **Critical Errors** - Throw immediately, no recovery attempted
2. **Recoverable Errors** - Log warning, attempt graceful degradation
3. **Non-Fatal Errors** - Log debug/info, continue execution

## Patterns

### 1. Comlink Proxy Error Extraction

When errors cross the Comlink boundary (main thread <-> Worker), stack traces and error metadata may be lost due to structured clone limitations.

**Pattern:**
```typescript
catch (err) {
  const errorInfo = err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack ?? 'no stack available' }
    : { name: 'UnknownError', message: String(err), stack: 'no stack available' };
  log.error('operation failed:', errorInfo);
}
```

**Rationale:** Comlink uses `postMessage` with structured clone, which may not preserve Error objects fully. Extracting metadata ensures diagnostics are available.

**Example locations:**
- `worker-bridge.ts`: `onUIUpdate`, `onConnectionStateChange`, `onGapFillState` callbacks
- All Comlink-proxied callback handlers

### 2. Exception Safety in Iteration

When iterating over callbacks or listeners, wrap each iteration in try-catch to prevent one failure from breaking the chain.

**Pattern:**
```typescript
for (const listener of listeners) {
  try {
    listener(event);
  } catch (err) {
    log.error('listener error (non-fatal, continuing):', err);
  }
}
```

**Rationale:** A single faulty listener should not prevent other listeners from receiving events. This is critical for connection state changes and UI update events.

**Example locations:**
- `worker-bridge.ts`: `onConnectionStateChange` callback
- Event bus implementations

### 3. Defensive Resource Cleanup

When cleaning up resources (ports, timers, proxies), catch and log errors but don't propagate them.

**Pattern:**
```typescript
try {
  resource.close();
} catch (err) {
  log.debug('cleanup failed (non-fatal):', err);
}
```

**Rationale:** Cleanup is best-effort. If it fails, the resource will eventually be GC'd. Propagating cleanup errors can leave the system in an inconsistent state.

**Example locations:**
- `worker-bridge.ts`: `destroy()`, `_cleanupFailedWorker()`
- Port cleanup, Comlink proxy release

### 4. Storage Operation Guards

`sessionStorage` and `localStorage` operations can throw in several scenarios (private browsing, quota exceeded, cross-origin restrictions). Wrap all storage access in try-catch.

**Pattern:**
```typescript
try {
  const value = sessionStorage.getItem(key);
  // process value
} catch (err) {
  log.debug('storage unavailable (non-fatal):', err);
  return defaultValue;
}
```

**Rationale:** Storage is an optimization (caching cursors, preferences). If unavailable, the system should fall back to computation (e.g., full catch-up) rather than crashing.

**Example locations:**
- `worker-bridge.ts`: `_loadLastProcessedSeq()`, `_saveLastProcessedSeq()`
- Any persistent state caching

### 5. Promise-Based Deduplication

For async operations that should not run concurrently (initialization, token refresh), use Promise deduplication.

**Pattern:**
```typescript
private _initPromise: Promise<void> | null = null;

async init() {
  if (this._initPromise) return this._initPromise;
  this._initPromise = this._doInit();
  try {
    await this._initPromise;
  } finally {
    this._initPromise = null;
  }
}
```

**Rationale:** Prevents race conditions where multiple callers trigger the same expensive operation (e.g., double initialization, duplicate token refresh).

**Example locations:**
- `worker-bridge.ts`: `init()`
- `client.ts`: Token refresh (see memory: WorkerBridge Token Caching Bug)

### 6. Fail-Fast for Aborted Operations

Check `AbortSignal.aborted` before starting expensive operations, and register abort listeners for in-flight operations.

**Pattern:**
```typescript
if (signal?.aborted) {
  throw new DOMException('Operation aborted', 'AbortError');
}
// Start operation, wire up abort listener
signal?.addEventListener('abort', onAbort, { once: true });
try {
  return await operation();
} finally {
  signal?.removeEventListener('abort', onAbort);
}
```

**Rationale:** Provides responsive cancellation without leaking resources (listeners, in-flight requests).

**Example locations:**
- `worker-bridge.ts`: `uploadFile()`, `downloadFile()`
- Any cancellable async operation

### 7. Graceful Degradation for Optional Features

If a non-critical feature fails (e.g., progress callbacks, optional logging), log but don't throw.

**Pattern:**
```typescript
try {
  await optionalFeature();
} catch (err) {
  log.debug('optional feature failed (non-fatal):', err);
  // Continue without the feature
}
```

**Rationale:** Optional features (progress callbacks, debug logging) should not block core functionality.

**Example locations:**
- `worker-bridge.ts`: Progress callback proxy release
- Optional telemetry/metrics

## When to Use Which Pattern

| Scenario | Pattern | Severity |
|----------|---------|----------|
| Comlink callback error | Error Extraction | Warning |
| Listener/callback iteration | Exception Safety | Warning |
| Resource cleanup | Defensive Cleanup | Debug |
| Storage access | Storage Guards | Debug |
| Concurrent async operations | Promise Dedup | Info |
| Cancellable operations | Fail-Fast Abort | Info |
| Optional features | Graceful Degradation | Debug |

## Anti-Patterns to Avoid

1. **Swallowing critical errors** - Don't catch and ignore errors in core operations (init, connection, token refresh)
2. **Propagating cleanup errors** - Cleanup failures should be logged but not thrown
3. **Missing error metadata** - Always extract error name, message, stack (especially across Comlink)
4. **Blocking on optional features** - Optional features should not block core functionality
5. **Forgetting abort listeners** - Always remove abort listeners in finally blocks

## References

- [Comlink Error Handling](https://github.com/GoogleChromeLabs/comlink#error-handling)
- [MDN: Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN: AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
