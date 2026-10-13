# Refactoring Plan

> This document tracks large-scale refactoring initiatives for the `@rtc-agent/web-components` monorepo.
> Each plan is a living document — update progress as work proceeds.

---

## Plan A: component -> persistence Import Audit & Fix

### Goal

Enforce the Worker boundary: `component` package should access persistence data exclusively through `WorkerBridge` (Comlink proxy to SharedWorker), not by importing persistence singletons directly.

### Current State

28 non-test files in `component/src/` import from `@rtc-agent/persistence`. After detailed audit, these fall into three categories:

#### Category 1: Legitimate (7 files) -- No action needed

These files are part of the bridge infrastructure or debug API, which by design must access persistence singletons directly.

| File | Imports | Justification |
|------|---------|---------------|
| `worker-bridge.ts` | `getUIUpdateBus`, `virtualFS`, types | IS the bridge; installs Comlink proxy on virtualFS singleton |
| `main.ts` | `toolRegistry`, `virtualFS` | Debug entry point; exposes singletons on `window` for devtools |
| `debug-api-helpers.ts` | `getDatabase` | Debug API; direct IndexedDB access for diagnostics |
| `debug-api-core.ts` | `virtualFS` | Debug API; diagnostic file operations |
| `controllers/persistence.controller.ts` | `RtcProcessor`, `PersistenceConfig`, types | Lifecycle controller; orchestrates WorkerBridge init/destroy |
| `components/rtc-agent/rtc-agent.ts` | `getUIUpdateBus`, `RtcProcessor`, `LocalRtc` | Root component; wires controllers and event bus |
| `components/input-area/rtc-input-area.ts` | `getUIUpdateBus`, `UIUpdateEvent` | Subscribes to main-thread UIUpdateBus (not persistence data) |

#### Category 2: Type-only imports (9 files) -- Low priority

Type imports are erased at compile time and have zero runtime impact. They create conceptual coupling but no architectural violation. Converting them to local type re-exports would be purely cosmetic.

| File | Types |
|------|-------|
| `types/functions-debug.ts` | `DebugHistoryItem`, `LogEntry`, `LogLevel` |
| `utils/file-storage.ts` | `FileCacheEntry` |
| `components/overlay/rtc-ask-user.ts` | `LocalRtc` |
| `components/rtc-agent/helpers/session-loader.ts` | `IPersistenceLayer` |
| `components/rtc-agent/helpers/dialog-helpers.ts` | `LocalRtc` |
| `components/rtc-agent/helpers/command-handler.ts` | `IPersistenceLayer` |
| `components/rtc-agent/helpers/bus-handler.ts` | `UIUpdateEvent` |
| `controllers/message.controller.ts` | `IPersistenceLayer`, `LocalMessage` |
| `controllers/session.controller.ts` | `IPersistenceLayer` |

#### Category 3: Singleton-proxy pattern (12 files) -- Medium priority

These files import `virtualFS` or `toolRegistry` singletons. At runtime, `WorkerBridge.installVirtualFSProxy()` replaces the singleton's methods with Comlink proxies, so calls are transparently routed to the Worker. This works correctly but creates implicit coupling:

- The proxy installation is invisible at the call site
- If `installVirtualFSProxy()` is not called (e.g., in tests), behavior differs
- Multi-instance `<rtc-agent>` on the same page conflicts (singleton overwrite)

| File | Imports |
|------|---------|
| `core/scenario-loader.ts` | `virtualFS`, `FileSystemEntryMetadata` |
| `core/function-registry.ts` | `virtualFS` |
| `components/overlay/rtc-scenario-panel.ts` | `virtualFS`, `FileSystemEntry` |
| `components/rtc-agent/helpers/vfs-operations.ts` | `virtualFS` |
| `components/rtc-agent/helpers/connection-setup.ts` | `RtcProcessor`, `IPersistenceLayer`, `LocalRtc`, `AskUserDialogFn` |
| `controllers/skill.controller.ts` | `toolRegistry`, `virtualFS` |
| `controllers/notification.controller.ts` | `IPersistenceLayer`, `getUIUpdateBus`, `UIUpdateEvent` |
| `components/rtc-agent/helpers/connection-setup.test.ts` | (test) |
| `components/overlay/rtc-ask-user.test.ts` | (test) |
| `components/rtc-agent/helpers/vfs-operations.test.ts` | (test) |
| `components/rtc-agent/helpers/bus-handler.test.ts` | (test) |
| `controllers/notification-integration.test.ts` | (test) |

### Fix Strategy

**Phase 1: Documentation (0.5 day)**

Add JSDoc comments to all Category 3 imports explaining the singleton-proxy pattern and its caveats. This ensures future developers understand the implicit routing.

**Phase 2: WorkerBridge API expansion (1-2 days)**

Add convenience methods to `WorkerBridge` for common operations, so callers can use explicit bridge methods instead of implicit singleton access:

```typescript
// WorkerBridge additions:
async readVirtualFile(path: string, offset?: number, limit?: number): Promise<string>
async writeVirtualFile(path: string, content: string, mode?: 'overwrite' | 'append'): Promise<void>
async listVirtualFiles(path?: string): Promise<FileSystemEntry[]>
async virtualFileExists(path: string): Promise<boolean>
getToolRegistry(): Remote<typeof toolRegistry>
```

**Phase 3: Gradual migration (2-3 days)**

Migrate Category 3 files to use WorkerBridge methods. Each file gets its own PR:

1. `core/scenario-loader.ts` -- replace virtualFS calls with bridge.readVirtualFile/writeVirtualFile
2. `core/function-registry.ts` -- replace virtualFS.remove with bridge.removeVirtualFile
3. `components/overlay/rtc-scenario-panel.ts` -- replace virtualFS with bridge
4. `components/rtc-agent/helpers/vfs-operations.ts` -- replace virtualFS with bridge
5. `controllers/skill.controller.ts` -- replace virtualFS/toolRegistry with bridge

**Phase 4: Regression prevention (0.5 day)**

```typescript
// eslint-plugin-rtc-agent rule:
// Disallow direct imports from @rtc-agent/persistence in component/src/
// Exceptions: worker-bridge.ts, debug-api-*.ts, persistence.controller.ts
{
  "rtc-agent/no-persistence-direct-import": ["error", {
    "allowedFiles": [
      "worker-bridge.ts",
      "debug-api-helpers.ts",
      "debug-api-core.ts",
      "controllers/persistence.controller.ts"
    ]
  }]
}
```

### Estimated Effort: 4-6 days

### Risk Assessment

- **Low risk**: The singleton-proxy pattern works correctly today; this is a code quality improvement, not a bug fix
- **Testing**: Each migration PR must include integration tests verifying Worker routing
- **Rollback**: Each file migration is independent and reversible

---

## Plan B: persistence/src/index.ts Split

### Goal

Split the 2696-line `index.ts` (PersistenceLayer facade) into multiple focused subsystem files while preserving the public API surface.

### Current State

`packages/persistence/src/index.ts` is a 2696-line god file containing the `PersistenceLayer` class. The file header explains the design intent:

> This file is intentionally large (2000+ lines) because it serves as the main facade for the entire persistence subsystem. All file operations (upload, download, cache, sync), RTC message handling, and lifecycle coordination flow through this class. Splitting would scatter the integration logic across files, making it harder to understand the data flow between IndexedDB, S3, and the WebSocket client.

### Analysis

The file contains these logical subsystems (approximate line counts):

| Subsystem | Lines | Description |
|-----------|-------|-------------|
| File cache & S3 operations | ~800 | cacheFile, getCachedFile, uploadFile, downloadFile, deleteFile, syncPendingFiles, evictCache, headFile, presignedUrl, cache stats |
| Session CRUD | ~350 | listSessions, getSession, closeSession, openSession, updateSession, forkSession, compactSession |
| Message CRUD | ~300 | sendMessage, listMessages, getMessage, message pagination |
| Turn operations | ~200 | listTurns, getTurn, stopTurn |
| RTC operations | ~250 | listRtc, getRtc, updateRtcStatus, submitRtcResult, askUser |
| Debug history | ~150 | getDebugHistory, clearDebugHistory, debug pagination |
| Lifecycle | ~200 | init, destroy, getConnectionState, handleTokenExpired |
| Imports & types | ~150 | Import statements, type definitions, interface implementations |
| Offset & sync | ~150 | offset management, sync status, background tasks |
| Misc helpers | ~150 | Utility methods, error handling, logging |

### Split Strategy

**Important**: The concern in the header is valid -- the facade pattern ensures all integration logic is in one place. The split must preserve integration visibility.

**Approach: Extract operation groups into mixin files, compose in facade**

```
persistence/src/
  index.ts                        # PersistenceLayer facade (composition root, ~300 lines)
  operations/
    file-operations.ts            # File cache & S3 (~800 lines)
    session-operations.ts         # Session CRUD (~350 lines)
    message-operations.ts         # Message CRUD (~300 lines)
    turn-operations.ts            # Turn operations (~200 lines)
    rtc-operations.ts             # RTC operations (~250 lines)
    debug-operations.ts           # Debug history (~150 lines)
    lifecycle-operations.ts       # Init, destroy, connection (~200 lines)
```

Each operations file exports a mixin or a set of methods that take `this` context (the shared state):

```typescript
// operations/file-operations.ts
export interface FileOperationsContext {
  db: Database;
  client: RTCAgentClient;
  s3: S3Client;
  fileCacheRepo: FileCacheRepository;
  log: Logger;
}

export async function uploadFile(
  ctx: FileOperationsContext,
  md5: string,
  ext: string,
  blob: Blob,
  // ...
): Promise<UploadResult> { ... }
```

The facade composes them:

```typescript
// index.ts
export class PersistenceLayer {
  async uploadFile(...args) {
    return uploadFile(this._ctx, ...args);
  }
}
```

### Phases

1. **Phase 1: Extract operations (1 day)** -- Create `operations/` directory, extract method bodies into standalone functions with context parameter
2. **Phase 2: Compose facade (0.5 day)** -- Rewrite `index.ts` to delegate to extracted operations
3. **Phase 3: Verify API compatibility (0.5 day)** -- Ensure all public methods have identical signatures and behavior
4. **Phase 4: Update imports (0.5 day)** -- Internal files that import specific operations can import from the operations file directly

### Estimated Effort: 2-3 days

### Risk Assessment

- **Medium risk**: Public API must remain 100% compatible; any signature change breaks consumers
- **Testing**: Existing test suite (`persistence-layer.test.ts`) must pass without modification
- **Benefit**: Each subsystem file is independently reviewable and testable

---

## Plan C: Admin-UI Test Coverage Enhancement

### Goal

Add unit test coverage for critical admin-ui business pages that currently lack tests.

### Current State

| Page Directory | Files | Existing Tests | Coverage Gap |
|----------------|-------|----------------|--------------|
| `pages/rtc-users/management` | 8 | None (only e2e `rtcUser.spec.ts`) | **High** -- core user management |
| `pages/system/configs` | 8 | None (only e2e `serverConfig.spec.ts`) | **High** -- system configuration |
| `pages/system/roles` | 3 | None (only e2e `role.spec.ts`) | **Medium** -- permission core |
| `pages/system/permissions` | 3 | None | **Medium** -- permission management |
| `pages/system/audit-logs` | 2 | None (only e2e `auditLog.spec.ts`) | **Low** -- read-only page |
| `pages/dashboard` | 1 | None | **Low** -- overview page |

### Priority Order

1. **rtc-users/management** (P1) -- Core business: create/edit/delete RTC users, view sessions/messages
2. **system/configs** (P1) -- Critical: system configuration changes affect all users
3. **system/roles** (P2) -- Important: role/permission management is security-sensitive
4. **system/permissions** (P2) -- Related to roles, lower traffic
5. **system/audit-logs** (P3) -- Read-only, low risk
6. **dashboard** (P3) -- Overview, minimal logic

### Test Types Per Page

For each page, add three categories of tests:

#### 1. API Service Tests

```typescript
// pages/rtc-users/management/service.test.ts
describe('RtcUserService', () => {
  it('should list users with pagination', async () => { ... });
  it('should create user with valid data', async () => { ... });
  it('should reject duplicate username', async () => { ... });
  it('should handle API errors gracefully', async () => { ... });
});
```

#### 2. Form Validation Tests

```typescript
// pages/rtc-users/management/components/UserForm.test.tsx
describe('UserForm', () => {
  it('should validate required fields', async () => { ... });
  it('should validate email format', async () => { ... });
  it('should disable submit on invalid input', async () => { ... });
  it('should show error messages from API', async () => { ... });
});
```

#### 3. Error Handling Tests

```typescript
// pages/system/configs/service.test.ts
describe('SystemConfigService', () => {
  it('should handle network errors', async () => { ... });
  it('should retry on transient failures', async () => { ... });
  it('should preserve existing values on partial update failure', async () => { ... });
});
```

### Implementation Plan

**Phase 1: rtc-users/management (1 day)**

- `service.test.ts` -- CRUD API tests (list, create, update, delete, view details)
- `components/UserForm.test.tsx` -- Form validation, submission, error display
- `components/SessionList.test.tsx` -- Session table pagination, filtering
- Error boundary tests

**Phase 2: system/configs (0.5 day)**

- `service.test.ts` -- Config CRUD, default override semantics
- `components/ConfigForm.test.tsx` -- JSON validation, reset to default

**Phase 3: system/roles (0.5 day)**

- `service.test.ts` -- Role CRUD, permission assignment
- `components/RoleForm.test.tsx` -- Permission tree selection, validation

### Estimated Effort: 2 days

### Risk Assessment

- **Low risk**: Adding tests does not change production code
- **Dependencies**: Need to understand existing mock infrastructure in admin-ui
- **Maintenance**: Tests must be updated when APIs change

---

## Progress Tracker

| Plan | Status | Started | Completed | Notes |
|------|--------|---------|-----------|-------|
| A: Import audit | Not started | - | - | 28 files audited, categorized |
| B: Index.ts split | Not started | - | - | 2696 lines identified for splitting |
| C: Test coverage | Not started | - | - | 6 pages need tests |

---

## Completed Fixes

| Fix | Date | Commit | Notes |
|-----|------|--------|-------|
| Remove `export * from '@rtc-agent/protocol'` from client/src/index.ts | 2026-10-13 | Pending | Impact analysis: 0 files depended on the re-export |
