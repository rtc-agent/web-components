# Worker Test Utilities

Comprehensive test utilities for testing Worker-related code with complete Comlink proxy mocks.

## Overview

Testing Worker code requires mocking the Comlink proxy that bridges the main thread and the SharedWorker. This directory provides type-safe, comprehensive mock implementations that cover all methods of the `WorkerPersistenceCore` interface.

## Files

- **comlink-mock.ts** - Complete mock implementations for Worker bridge and callbacks
- **index.ts** - Clean exports for all test utilities
- **comlink-mock.examples.test.ts** - Comprehensive usage examples (also serves as integration tests)

## Quick Start

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createWorkerBridgeMock,
  createWorkerCallbacksMock,
  type WorkerBridgeMock,
  type WorkerCallbacksMock,
} from './test-utils/index.js';

describe('My Worker Test', () => {
  let mockBridge: WorkerBridgeMock;
  let mockCallbacks: WorkerCallbacksMock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge = createWorkerBridgeMock();
    mockCallbacks = createWorkerCallbacksMock();
  });

  it('should mock listSessions', async () => {
    // Override default empty array
    mockBridge.listSessions.mockResolvedValue([
      { clientId: 'session-1', title: 'Test Session' }
    ]);

    const sessions = await mockBridge.listSessions();
    expect(sessions).toHaveLength(1);
  });
});
```

## Key Features

### 1. Type-Safe Mocks

All mocks are fully type-safe and match the `WorkerPersistenceCore` interface exactly:

```typescript
// TypeScript will catch errors at compile time
mockBridge.listSessions.mockResolvedValue([
  { clientId: '1', title: 'Test' } // ✅ Correct structure
]);

mockBridge.listSessions.mockResolvedValue([
  { id: '1', name: 'Test' } // ❌ TypeScript error
]);
```

### 2. Sensible Defaults

All methods return sensible defaults that work out of the box:

```typescript
// No setup required - defaults work
const sessions = await mockBridge.listSessions(); // Returns []
const state = await mockBridge.getConnectionState(); // Returns 'disconnected'
const result = await mockBridge.ping(); // Returns 'pong'
```

### 3. Easy Customization

Override defaults per test case:

```typescript
it('should handle custom scenarios', async () => {
  // Mock success case
  mockBridge.connect.mockResolvedValue(undefined);
  
  // Mock error case
  mockBridge.connect.mockRejectedValue(new Error('Connection failed'));
  
  // Mock specific return value
  mockBridge.getSession.mockResolvedValue({
    clientId: 'session-1',
    title: 'Custom Session',
    // ... other fields
  });
});
```

### 4. Callback Testing

Test callback registration and invocation:

```typescript
it('should register callbacks', () => {
  mockBridge.registerCallback(mockCallbacks);
  expect(mockBridge.registerCallback).toHaveBeenCalledWith(mockCallbacks);
});

it('should invoke callbacks', async () => {
  const payload = {
    event: { entity: 'session', action: 'created', entityId: '123' },
    seq: 42,
  };
  
  await mockCallbacks.onUIUpdate(payload);
  expect(mockCallbacks.onUIUpdate).toHaveBeenCalledWith(payload);
});
```

## Common Patterns

### Pattern 1: Testing Session Operations

```typescript
it('should create and list sessions', async () => {
  // Mock sendMessage to return a new session
  mockBridge.sendMessage.mockResolvedValue({
    session: { clientId: 'new-session', title: 'New Chat' },
    message: { clientId: 'msg-1', content: 'Hello' },
  });

  const result = await mockBridge.sendMessage({
    content: { text: 'Hello' },
    messageClientId: 'msg-1',
    sessionClientId: 'new-session',
  });

  expect(result.session.clientId).toBe('new-session');

  // Mock listSessions to return the created session
  mockBridge.listSessions.mockResolvedValue([result.session]);
  const sessions = await mockBridge.listSessions();
  expect(sessions).toHaveLength(1);
});
```

### Pattern 2: Testing File Operations

```typescript
it('should handle file operations', async () => {
  // Mock file read
  mockBridge.virtualFSRead.mockResolvedValue('File content');
  const content = await mockBridge.virtualFSRead('/AGENT.md');
  expect(content).toBe('File content');

  // Mock file write
  mockBridge.virtualFSWrite.mockResolvedValue(100);
  const bytesWritten = await mockBridge.virtualFSWrite(
    '/test.txt',
    'Test content',
    'overwrite'
  );
  expect(bytesWritten).toBe(100);

  // Mock batch write
  await mockBridge.batchWriteFiles(
    [{ path: '/file1.txt', content: 'Content 1' }],
    ['/old-file.txt']
  );
  expect(mockBridge.batchWriteFiles).toHaveBeenCalled();
});
```

### Pattern 3: Testing Error Scenarios

```typescript
it('should handle connection errors', async () => {
  mockBridge.connect.mockRejectedValue(new Error('Network error'));
  
  await expect(mockBridge.connect()).rejects.toThrow('Network error');
});

it('should handle file not found', async () => {
  mockBridge.virtualFSRead.mockRejectedValue(new Error('File not found'));
  
  await expect(mockBridge.virtualFSRead('/missing.txt'))
    .rejects.toThrow('File not found');
});
```

### Pattern 4: Testing Catch-Up Events

```typescript
it('should detect gaps in events', async () => {
  mockBridge.getCatchUpEvents.mockResolvedValue({
    entries: [
      { seq: 1, event: { entity: 'session' } },
      { seq: 2, event: { entity: 'message' } },
    ],
    hasGap: true,
    hasMore: false,
  });

  const result = await mockBridge.getCatchUpEvents(0);
  expect(result.hasGap).toBe(true);
  expect(result.entries).toHaveLength(2);
});
```

### Pattern 5: Testing File Cache

```typescript
it('should cache and retrieve files', async () => {
  const blob = new Blob(['test content'], { type: 'text/plain' });
  
  // Cache a file
  await mockBridge.cacheFile('abc123', 'txt', blob, 'text/plain');
  expect(mockBridge.cacheFile).toHaveBeenCalled();

  // Retrieve cached file
  mockBridge.getCachedFile.mockResolvedValue({
    blob,
    contentType: 'text/plain',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  const cached = await mockBridge.getCachedFile('abc123', 'txt');
  expect(cached).toBeDefined();
  expect(cached!.blob).toBe(blob);
});
```

## API Reference

### createWorkerBridgeMock()

Creates a complete mock of the `WorkerPersistenceCore` interface with 60+ methods covering:

- **Initialization**: `init`, `ping`
- **Callback Management**: `registerCallback`, `unregisterCallback`
- **Connection**: `connect`, `disconnect`, `reconnect`, `getConnectionState`
- **Queries**: `listSessions`, `getSession`, `listMessages`, `getMessage`, `listRtc`, etc.
- **Operations**: `sendMessage`, `stopTurn`, `closeSession`, `deleteSession`, etc.
- **Virtual File System**: `virtualFSRead`, `virtualFSWrite`, `virtualFSLs`, `batchWriteFiles`, etc.
- **File Cache & S3**: `cacheFile`, `uploadFile`, `downloadFile`, `deleteFile`, etc.
- **Debug History**: `addDebugHistoryItem`, `queryDebugHistory`, `clearDebugHistory`, etc.

### createWorkerCallbacksMock()

Creates a mock of the `WorkerCallbacks` interface:

- `onUIUpdate` - UI update notifications
- `requestToken` - Token requests
- `requestTokenRefresh` - Token refresh requests
- `onConnectionStateChange` - Connection state changes
- `onGapFillState` - Gap fill state changes
- `onStateGap` - State gap notifications
- `onAccountBanned` - Account ban notifications

## Best Practices

### 1. Clear Mocks Between Tests

Always clear mocks in `beforeEach` to prevent test pollution:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  mockBridge = createWorkerBridgeMock();
});
```

### 2. Use Type Helpers

Use the provided type helpers for better type safety:

```typescript
let mockBridge: WorkerBridgeMock;
let mockCallbacks: WorkerCallbacksMock;
```

### 3. Override Only What You Need

Don't mock everything - only override the methods your test actually uses:

```typescript
it('should list sessions', async () => {
  // Only override listSessions, other methods use defaults
  mockBridge.listSessions.mockResolvedValue([/* test data */]);
  
  const sessions = await mockBridge.listSessions();
  // ...
});
```

### 4. Verify Important Calls

Use `expect().toHaveBeenCalledWith()` to verify important method calls:

```typescript
await mockBridge.updateSessionTitle('session-1', 'New Title');

expect(mockBridge.updateSessionTitle).toHaveBeenCalledWith(
  'session-1',
  'New Title'
);
```

### 5. Test Error Paths

Don't forget to test error scenarios:

```typescript
it('should handle errors', async () => {
  mockBridge.connect.mockRejectedValue(new Error('Network error'));
  await expect(mockBridge.connect()).rejects.toThrow('Network error');
});
```

## Migration Guide

If you have existing tests with incomplete mocks, migrate to this utility:

### Before

```typescript
// ❌ Incomplete mock, missing many methods
const mockBridge = {
  listSessions: vi.fn(),
  connect: vi.fn(),
  // ... many methods missing
};
```

### After

```typescript
// ✅ Complete, type-safe mock
import { createWorkerBridgeMock } from './test-utils/index.js';

const mockBridge = createWorkerBridgeMock();
// All 60+ methods are mocked with sensible defaults
```

## Examples

See `comlink-mock.examples.test.ts` for comprehensive usage examples covering:

- Basic usage and customization
- Callback management
- Session operations
- Virtual file system
- File cache & S3 operations
- Connection state
- Catch-up events
- Debug history
- Cache statistics
- Verification patterns

## Troubleshooting

### Problem: Mock method returns undefined

**Solution**: The method is mocked but you're not awaiting it:

```typescript
// ❌ Wrong
const sessions = mockBridge.listSessions(); // Returns Promise

// ✅ Correct
const sessions = await mockBridge.listSessions(); // Returns []
```

### Problem: TypeScript errors when mocking

**Solution**: Use the correct types:

```typescript
import type { LocalSession } from '@rtc-agent/persistence';

mockBridge.listSessions.mockResolvedValue([
  { clientId: '1', title: 'Test' } as LocalSession
]);
```

### Problem: Mock not working after clearAllMocks

**Solution**: Re-create the mock:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  mockBridge = createWorkerBridgeMock(); // Re-create after clearing
});
```

## Related Documentation

- [Testing Standards](../../../../../../.claude/skills/rtc-agent-development-standards/02-testing-standards.md)
- [Worker Architecture](../../../../../../.claude/skills/rtc-agent-review/web-components/rtc-agent-component.md)
- [Core Interface](../core-interface.ts)
