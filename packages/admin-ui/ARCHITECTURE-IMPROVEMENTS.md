# Architecture Improvement Recommendations

**Date**: 2026-10-14  
**Author**: rtc-agent-reviewer  
**Context**: P2/P3 architecture issues from web-components review

## Overview

This document outlines architectural improvements to address coupling issues identified during the web-components code review. These are **recommendations for future refactoring**, not immediate action items.

---

## P2-3: Persistence Reverse Dependency on Client

### Current State
`persistence/src/s3-upload.ts` imports `S3Client` from `@rtc-agent/client`, creating a reverse dependency (lower layer depending on upper layer).

### Impact
- Violates layered architecture principles
- Makes it harder to evolve persistence independently
- Creates circular dependency risk if client ever needs persistence

### Root Cause
S3Client was placed in the `client` package for convenience, but it's actually a storage utility that should be independent.

### Recommended Solution

**Option 1: Extract to Shared Storage Package** (Preferred)
```
@rtc-agent/storage-client (new package)
├── S3Client
├── S3 types (HeadObjectResult, etc.)
└── Presigned URL utilities

Dependency graph:
  persistence -> storage-client <- client
```

**Option 2: Move S3Client to Persistence**
If S3Client is only used by persistence, move it there:
```
persistence/
├── s3-client.ts (moved from client)
└── s3-upload.ts
```

### Migration Steps
1. Identify all S3Client consumers (currently: persistence, possibly tests)
2. Create new package or move to persistence
3. Update imports across the codebase
4. Add deprecation notice in old location
5. Remove after one release cycle

### Priority
**Medium** - Current design works but limits future evolution.

---

## P2-4: Persistence/index.ts Responsibility Overload

### Current State
`persistence/src/index.ts` exceeds 2000 lines and handles:
1. WebSocket client lifecycle
2. Session/Message/RTC CRUD
3. File cache & S3 operations
4. Multipart upload with resume
5. Background sync with retry
6. Debug history management
7. Network-aware auto-sync

### Impact
- Harder to understand and maintain
- Difficult to test individual concerns
- Changes to one concern may affect others
- Long compilation times

### Root Cause
The class acts as a facade for the entire persistence subsystem. While this centralizes integration logic, it has grown beyond a manageable size.

### Recommended Solution

**Extract Domain Controllers**

```typescript
// FileOperationManager.ts
// - uploadFile, downloadFile, cacheFile, deleteFile
// - FileSyncTransaction coordination
// - Multipart upload orchestration

// SyncCoordinator.ts
// - syncPendingFiles, resumeInterruptedUploads
// - Network listener management
// - Retry logic with exponential backoff

// SessionController.ts
// - sendMessage, stopTurn, closeSession, openSession
// - forkSession, deleteSession, updateSessionTitle
// - _syncToServer, _syncWithRetry

// DebugHistoryController.ts (already partially done)
// - addDebugHistoryItem, queryDebugHistory
// - clearDebugHistory, batchDeleteDebugHistory

// PersistenceLayer.ts (orchestrator)
// - Lifecycle management
// - Component initialization
// - Cross-controller coordination
```

### Migration Strategy
1. Extract one controller at a time (start with DebugHistoryController - already done)
2. Keep PersistenceLayer as the public facade
3. Inject dependencies into controllers (S3Client, repositories, lifecycle guard)
4. Maintain backward compatibility via delegation methods

### Trade-offs
**Pros:**
- Easier to understand and test individual concerns
- Clearer ownership of responsibilities
- Better separation of concerns

**Cons:**
- More files to navigate
- Need to carefully manage cross-controller dependencies
- Risk of over-fragmentation

### Priority
**Low-Medium** - Current design works but will become harder to maintain as features grow.

---

## P2-5: Admin-UI Over-Reliance on Component Utilities

### Current State
27 files in `admin-ui/src/rtc-agent/groups/**/*.ts` import `withMeta` and `z` (zod) from `@rtc-agent/component`.

### Impact
- Creates unnecessary coupling between admin-ui and component
- Validation utilities are not core component functionality
- Makes it harder to evolve validation independently

### Root Cause
`withMeta` and `z` (zod) are re-exported from `component/src/validation/index.ts` for convenience. Admin-ui uses them for parameter validation schemas.

### Recommended Solution

**Extract Validation Utilities Package**
```
@rtc-agent/validation-utils (new package)
├── withMeta.ts
├── zod.ts (re-export zod)
├── validateParams.ts
├── formatValidationError.ts
├── buildValidator.ts
├── withValidation.ts
├── zodToParams.ts
├── zodToOpenAPISchema.ts
└── openApiToZod.ts

Dependency graph:
  admin-ui -> validation-utils <- component
```

### Migration Steps
1. Create `@rtc-agent/validation-utils` package
2. Move validation utilities from component to new package
3. Update component to import from validation-utils
4. Update admin-ui to import from validation-utils
5. Re-export from component for backward compatibility (optional)

### Alternative: Keep Current Design
If creating a new package is too much overhead:
- Document the dependency clearly (done via comments)
- Ensure validation utilities have stable APIs
- Consider admin-ui and component as a coupled unit

### Priority
**Low** - Current design works, but creates mild coupling.

---

## P2-6: Admin-UI Imports Component Internal Types

### Current State
- `admin-ui/src/utils/rtc-auth-provider.ts` imports `AuthProvider` from `@rtc-agent/component`
- `admin-ui/src/utils/rtc-agent-manager.ts` imports `RtcAgentWithLifecycle` from `@rtc-agent/component`

### Impact
- Couples admin-ui to component's internal type definitions
- Makes it harder to evolve auth/lifecycle interfaces independently
- Violates encapsulation (types are "internal" but exported)

### Root Cause
These types are part of the public API (exported from component's index.ts), but they represent internal implementation details (auth provider interface, lifecycle management).

### Recommended Solution

**Move to Protocol Package**
```typescript
// @rtc-agent/protocol/src/auth.ts
export interface AuthProvider {
  type: 'direct' | 'token-exchange';
  getExchangeToken?: () => Promise<string>;
  getToken?: () => Promise<string>;
  isLoggedIn: () => boolean;
  logout: () => Promise<void>;
  getUserId: () => string;
  deviceId: string;
}

// @rtc-agent/protocol/src/component.ts
export interface RtcAgentWithLifecycle extends HTMLElement {
  destroy(): void;
  // ... other lifecycle methods
}
```

### Migration Steps
1. Identify all types that should be in protocol (AuthProvider, RtcAgentWithLifecycle, etc.)
2. Move type definitions to protocol package
3. Update component to import from protocol
4. Update admin-ui to import from protocol
5. Re-export from component for backward compatibility (optional)

### Alternative: Accept Current Design
Since these types are part of the public API:
- Document them clearly (done via comments)
- Treat them as stable contracts
- Version them carefully

### Priority
**Low** - Types are stable and part of the public API.

---

## Implementation Timeline

### Phase 1: Documentation (Done)
- [x] Add architecture notes to affected files
- [x] Create this recommendations document

### Phase 2: Quick Wins (Optional)
- [ ] If P2-3 is a blocker, extract S3Client to a shared package
- [ ] If P2-4 becomes a maintenance burden, extract one controller (e.g., FileOperationManager)

### Phase 3: Structural Improvements (Future)
- [ ] Extract validation-utils package (P2-5)
- [ ] Move AuthProvider/RtcAgentWithLifecycle to protocol (P2-6)

### Phase 4: Persistence Refactoring (If Needed)
- [ ] Extract remaining controllers from PersistenceLayer
- [ ] Establish clear boundaries between controllers

---

## Decision Criteria

When to implement these recommendations:
1. **Pain Point**: Is the current design causing actual problems (bugs, slow development, testing difficulties)?
2. **Growth**: Is the codebase growing in a way that makes the issue worse?
3. **Cost vs Benefit**: Does the refactoring cost justify the improvement?
4. **Risk**: How risky is the refactoring? (e.g., breaking changes, regression risk)

**General Rule**: Refactor when the pain of not refactoring exceeds the cost of refactoring.

---

## Conclusion

These recommendations address real architectural concerns, but they are not urgent. The current design works and has been documented. Future refactoring should be driven by:
- Actual maintenance pain
- New feature requirements
- Team growth and onboarding needs

The most important improvement is **documentation** (now done), which ensures future developers understand the trade-offs and can make informed decisions about when to refactor.
