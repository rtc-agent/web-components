import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RtcProcessor, type ConfirmDialogFn, type AskUserDialogFn, type MasterLike } from './rtc-processor.js';
import type { PersistenceLayer } from './index.js';
import type { LocalRtc } from './database.js';
import type { ToolResult } from './tools/types.js';

// ============================================================
// Mock dependencies (vi.hoisted so they're available in vi.mock factories)
// ============================================================

const { mockNeedsConfirm, mockToolExecute } = vi.hoisted(() => ({
  mockNeedsConfirm: vi.fn(),
  mockToolExecute: vi.fn(),
}));

// Mock permission checker
vi.mock('./permission.js', () => ({
  permissionChecker: {
    needsConfirm: mockNeedsConfirm,
  },
}));

// Mock tool registry
vi.mock('./tools/index.js', () => ({
  toolRegistry: {
    execute: mockToolExecute,
  },
}));

// Mock client logger to keep test output clean
vi.mock('@rtc-agent/client', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock persistence layer
function createMockPersistence(): Pick<PersistenceLayer, 'getNextRtcToProcess' | 'submitRtcResult'> {
  return {
    getNextRtcToProcess: vi.fn(),
    submitRtcResult: vi.fn(),
  };
}

// ============================================================
// Helpers
// ============================================================

function createMockRtc(overrides: Partial<LocalRtc> = {}): LocalRtc {
  return {
    client_id: 'rtc-001',
    session_client_id: 'session-001',
    sync_status: 'pending',
    server_id: 'server-rtc-001',
    turn_id: 'turn-001',
    tool_name: 'ls',
    status: 'pending',
    parameters: {},
    result: null,
    error_message: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as LocalRtc;
}

/**
 * Run onRtcUpdate() while advancing fake timers concurrently.
 *
 * Needed because processLoop uses sleep() with setTimeout; with fake timers
 * the setTimeout never fires unless we advance the clock.
 */
async function runWithTimers(p: Promise<void>): Promise<void> {
  // Give the promise a chance to start, then drain all pending timers
  await vi.runAllTimersAsync();
  await p;
}

// ============================================================
// Tests
// ============================================================

describe('RtcProcessor', () => {
  let processor: RtcProcessor;
  let mockPersistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPersistence = createMockPersistence();
    processor = new RtcProcessor(mockPersistence as unknown as PersistenceLayer);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // Mode management
  // ============================================================

  describe('mode management', () => {
    it('should default to edit mode', () => {
      expect(processor.getMode()).toBe('edit');
    });

    it('should update mode via setMode', () => {
      processor.setMode('auto');
      expect(processor.getMode()).toBe('auto');
    });

    it('should support all valid modes', () => {
      const modes = ['manual', 'edit', 'plan', 'auto', 'bypass'] as const;
      for (const mode of modes) {
        processor.setMode(mode);
        expect(processor.getMode()).toBe(mode);
      }
    });
  });

  // ============================================================
  // Master eligibility
  // ============================================================

  describe('master eligibility', () => {
    it('should allow processing when no master injected', async () => {
      const rtc = createMockRtc();
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledOnce();
    });

    it('should skip processing when master.isMaster is false', async () => {
      const master: MasterLike = { isMaster: false };
      processor.setMaster(master);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockPersistence.getNextRtcToProcess).not.toHaveBeenCalled();
    });

    it('should process when master.isMaster is true', async () => {
      const master: MasterLike = { isMaster: true };
      processor.setMaster(master);

      const rtc = createMockRtc();
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledOnce();
    });

    it('should resume processing after master upgrade from false to true', async () => {
      const master: MasterLike = { isMaster: false };
      processor.setMaster(master);

      await runWithTimers(processor.onRtcUpdate());
      expect(mockPersistence.getNextRtcToProcess).not.toHaveBeenCalled();

      // Upgrade to master
      master.isMaster = true;

      const rtc = createMockRtc();
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledOnce();
    });
  });

  // ============================================================
  // onRtcUpdate concurrency
  // ============================================================

  describe('onRtcUpdate concurrency', () => {
    it('should set pendingCheck when already processing', async () => {
      const rtc1 = createMockRtc({ client_id: 'rtc-1' });
      const rtc2 = createMockRtc({ client_id: 'rtc-2' });

      // First fetch: while fetching, trigger another onRtcUpdate (sets pendingCheck)
      mockPersistence.getNextRtcToProcess
        .mockImplementationOnce(async () => {
          void processor.onRtcUpdate();
          return rtc1;
        })
        .mockResolvedValueOnce(rtc2)
        .mockResolvedValueOnce(undefined);

      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      // Both RTCs should have been processed
      expect(mockToolExecute).toHaveBeenCalledTimes(2);
    });

    it('should exit loop when no RTCs and no pendingCheck', async () => {
      mockPersistence.getNextRtcToProcess.mockResolvedValue(undefined);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockPersistence.getNextRtcToProcess).toHaveBeenCalledOnce();
    });

    it('should continue loop when pendingCheck set and no more RTCs', async () => {
      const rtc1 = createMockRtc({ client_id: 'rtc-1' });
      const rtc2 = createMockRtc({ client_id: 'rtc-2' });

      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc1)
        // Second fetch: returns undefined, but triggers onRtcUpdate which sets pendingCheck
        .mockImplementationOnce(async () => {
          void processor.onRtcUpdate();  // Sets pendingCheck=true
          return undefined;
        })
        // Third fetch (loop continues due to pendingCheck): returns rtc2
        .mockResolvedValueOnce(rtc2)
        .mockResolvedValueOnce(undefined);

      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // New RTC processing
  // ============================================================

  describe('processOne - new RTC', () => {
    it('should execute tool directly when no confirmation needed', async () => {
      const rtc = createMockRtc({ tool_name: 'ls' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      const toolResult: ToolResult = { success: true, data: { files: ['a.ts'] } };
      mockToolExecute.mockResolvedValue(toolResult);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledWith('ls', {});
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: true,
        result: { files: ['a.ts'] },
        error: undefined,
      });
    });

    it('should pass RTC parameters to tool execute', async () => {
      const params = { path: '/src', recursive: true };
      const rtc = createMockRtc({ tool_name: 'ls', parameters: params });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledWith('ls', params);
    });

    it('should request confirmation and execute when approved', async () => {
      const rtc = createMockRtc({ tool_name: 'script' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(true);

      const confirmDialog: ConfirmDialogFn = vi.fn().mockResolvedValue(true);
      processor.setConfirmDialog(confirmDialog);
      mockToolExecute.mockResolvedValue({ success: true, data: 'executed' });

      await runWithTimers(processor.onRtcUpdate());

      expect(confirmDialog).toHaveBeenCalledWith(rtc);
      expect(mockToolExecute).toHaveBeenCalledOnce();
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: true,
        result: 'executed',
        error: undefined,
      });
    });

    it('should deny and submit failure when user rejects confirmation', async () => {
      const rtc = createMockRtc({ tool_name: 'script' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(true);

      const confirmDialog: ConfirmDialogFn = vi.fn().mockResolvedValue(false);
      processor.setConfirmDialog(confirmDialog);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).not.toHaveBeenCalled();
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        error: 'User denied',
      });
    });

    it('should default to reject when confirmDialog is not set', async () => {
      const rtc = createMockRtc({ tool_name: 'script' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(true);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).not.toHaveBeenCalled();
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        error: 'User denied',
      });
    });

    it('should handle tool execution throwing an error', async () => {
      const rtc = createMockRtc({ tool_name: 'script' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockRejectedValue(new Error('tool crashed'));

      await runWithTimers(processor.onRtcUpdate());

      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        result: undefined,
        error: 'tool crashed',
      });
    });

    it('should handle tool returning success: false', async () => {
      const rtc = createMockRtc({ tool_name: 'ls' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: false, error: 'not found' });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        result: undefined,
        error: 'not found',
      });
    });

    it('should use empty object when RTC parameters are null', async () => {
      const rtc = createMockRtc({ tool_name: 'ls', parameters: null as unknown as Record<string, unknown> });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledWith('ls', {});
    });

    it('should stringify non-Error thrown values', async () => {
      const rtc = createMockRtc({ tool_name: 'ls' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockRejectedValue('string error');

      await runWithTimers(processor.onRtcUpdate());

      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        result: undefined,
        error: 'string error',
      });
    });

    it('should continue loop when submitRtcResult fails', async () => {
      const rtc = createMockRtc({ tool_name: 'ls' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });
      mockPersistence.submitRtcResult.mockRejectedValueOnce(new Error('submit failed'));

      await runWithTimers(processor.onRtcUpdate());

      // Loop should continue (not throw) and exit gracefully
      expect(mockPersistence.getNextRtcToProcess).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // askUser processing
  // ============================================================

  describe('processOne - askUser', () => {
    it('should route to askUserDialog instead of tool execution', async () => {
      const rtc = createMockRtc({ tool_name: 'askUser' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      const payload = { answers: { q1: 'yes' }, annotations: { q1: { preview: 'ok' } } };
      const askUserDialog: AskUserDialogFn = vi.fn().mockResolvedValue(payload);
      processor.setAskUserDialog(askUserDialog);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).not.toHaveBeenCalled();
      expect(askUserDialog).toHaveBeenCalledWith(rtc);
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: true,
        result: payload,
      });
    });

    it('should submit declined when askUserDialog returns null', async () => {
      const rtc = createMockRtc({ tool_name: 'askUser' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      const askUserDialog: AskUserDialogFn = vi.fn().mockResolvedValue(null);
      processor.setAskUserDialog(askUserDialog);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        error: 'User declined to answer questions',
      });
    });

    it('should default to reject when askUserDialog is not set', async () => {
      const rtc = createMockRtc({ tool_name: 'askUser' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).not.toHaveBeenCalled();
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        error: 'User declined to answer questions',
      });
    });

    it('should submit error when askUserDialog throws', async () => {
      const rtc = createMockRtc({ tool_name: 'askUser' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      const askUserDialog: AskUserDialogFn = vi.fn().mockRejectedValue(new Error('dialog crash'));
      processor.setAskUserDialog(askUserDialog);

      await runWithTimers(processor.onRtcUpdate());

      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        error: 'dialog crash',
      });
    });

    it('should not throw when askUserDialog throws and submitRtcResult also fails', async () => {
      const rtc = createMockRtc({ tool_name: 'askUser' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      const askUserDialog: AskUserDialogFn = vi.fn().mockRejectedValue(new Error('dialog crash'));
      processor.setAskUserDialog(askUserDialog);
      mockPersistence.submitRtcResult.mockRejectedValueOnce(new Error('submit failed'));

      // Should not throw
      await runWithTimers(processor.onRtcUpdate());
    });

    it('should bypass permission check for ask_user', async () => {
      const rtc = createMockRtc({ tool_name: 'askUser' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      const askUserDialog: AskUserDialogFn = vi.fn().mockResolvedValue({ answers: { q: 'a' } });
      processor.setAskUserDialog(askUserDialog);

      await runWithTimers(processor.onRtcUpdate());

      // askUser bypasses permissionChecker entirely
      expect(mockNeedsConfirm).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Failed RTC retry
  // ============================================================

  describe('processOne - failed RTC retry', () => {
    it('should retry a failed RTC by submitting its existing result', async () => {
      const rtc = createMockRtc({
        sync_status: 'failed',
        status: 'completed',
        result: { old: 'data' },
        error_message: null,
      });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      const p = processor.onRtcUpdate();
      await runWithTimers(p);

      // Should call submitRtcResult (retry), not toolRegistry.execute
      expect(mockToolExecute).not.toHaveBeenCalled();
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: true,  // status === 'completed'
        result: { old: 'data' },
        error: null,
      });
    });

    it('should retry with success: false when status is failed', async () => {
      const rtc = createMockRtc({
        sync_status: 'failed',
        status: 'failed',
        result: null,
        error_message: 'previous error',
      });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);

      const p = processor.onRtcUpdate();
      await runWithTimers(p);

      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        result: null,
        error: 'previous error',
      });
    });

    it('should increment retry counter on submit failure and continue loop', async () => {
      const rtc = createMockRtc({
        sync_status: 'failed',
        status: 'completed',
      });

      // First attempt: submitRtcResult fails (non-connection error)
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockPersistence.submitRtcResult
        .mockRejectedValueOnce(new Error('submit failed'))
        .mockResolvedValueOnce(undefined);

      const p = processor.onRtcUpdate();
      await runWithTimers(p);

      // Should have attempted twice: first failed, then retried (after ERROR_RETRY_DELAY_MS)
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledTimes(2);
    });

    it('should apply backoff delay before retry submit', async () => {
      const rtc = createMockRtc({
        sync_status: 'failed',
        status: 'completed',
      });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockPersistence.submitRtcResult.mockResolvedValue(undefined);

      // Track setTimeout calls to verify backoff delay
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const p = processor.onRtcUpdate();
      await runWithTimers(p);

      // Verify a setTimeout was created with 1000ms (backoff for retryCount=0)
      const backoffCall = setTimeoutSpy.mock.calls.find(([_, ms]) => ms === 1000);
      expect(backoffCall).toBeDefined();

      setTimeoutSpy.mockRestore();
    });
  });

  // ============================================================
  // Connection error handling (only triggers in retry path)
  // ============================================================

  describe('connection error handling', () => {
    it('should exit loop when retry submitRtcResult throws connection error', async () => {
      const rtc = createMockRtc({
        sync_status: 'failed',
        status: 'completed',
      });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);  // Should NOT be called
      mockPersistence.submitRtcResult.mockRejectedValueOnce(new Error('connection lost'));

      const p = processor.onRtcUpdate();
      await runWithTimers(p);

      // Should exit immediately after connection error, not fetch more RTCs
      expect(mockPersistence.getNextRtcToProcess).toHaveBeenCalledOnce();
    });

    it('should exit loop when retry submitRtcResult throws disconnected error', async () => {
      const rtc = createMockRtc({
        sync_status: 'failed',
        status: 'completed',
      });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);  // Should NOT be called
      mockPersistence.submitRtcResult.mockRejectedValueOnce(new Error('client disconnected'));

      const p = processor.onRtcUpdate();
      await runWithTimers(p);

      expect(mockPersistence.getNextRtcToProcess).toHaveBeenCalledOnce();
    });

    it('should continue loop when retry submitRtcResult throws non-connection error', async () => {
      const rtc1 = createMockRtc({ client_id: 'rtc-1', sync_status: 'failed', status: 'completed' });
      const rtc2 = createMockRtc({ client_id: 'rtc-2', sync_status: 'failed', status: 'completed' });

      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc1)
        .mockResolvedValueOnce(rtc2)
        .mockResolvedValueOnce(undefined);
      mockPersistence.submitRtcResult
        .mockRejectedValueOnce(new Error('validation error'))
        .mockResolvedValueOnce(undefined);

      const p = processor.onRtcUpdate();
      await runWithTimers(p);

      // Both RTCs should be fetched (loop continues after non-connection error)
      expect(mockPersistence.getNextRtcToProcess).toHaveBeenCalledTimes(3);
    });

    it('should NOT exit on connection error in new RTC path (caught inside processOne)', async () => {
      // For new RTCs, tool execution errors are caught inside processOne and
      // submitted as failures. The processLoop connection error detection only
      // triggers for retry path failures.
      const rtc = createMockRtc({ tool_name: 'ls' });
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockRejectedValue(new Error('connection lost'));

      await runWithTimers(processor.onRtcUpdate());

      // processOne catches the error and submits it as a failure; loop continues
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledWith({
        rtcClientId: 'rtc-001',
        success: false,
        result: undefined,
        error: 'connection lost',
      });
      // And loop continues to check for more RTCs
      expect(mockPersistence.getNextRtcToProcess).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // Multiple RTC processing
  // ============================================================

  describe('multiple RTC processing', () => {
    it('should process RTCs sequentially until none remain', async () => {
      const rtcs = [
        createMockRtc({ client_id: 'rtc-1', tool_name: 'ls' }),
        createMockRtc({ client_id: 'rtc-2', tool_name: 'read' }),
        createMockRtc({ client_id: 'rtc-3', tool_name: 'find' }),
      ];

      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtcs[0])
        .mockResolvedValueOnce(rtcs[1])
        .mockResolvedValueOnce(rtcs[2])
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledTimes(3);
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledTimes(3);
    });

    it('should not set processing flag for non-master tab', async () => {
      const master: MasterLike = { isMaster: false };
      processor.setMaster(master);

      await runWithTimers(processor.onRtcUpdate());

      // Now switch to master and verify processing works
      master.isMaster = true;
      const rtc = createMockRtc();
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      // If processing flag were stuck, this call would just set pendingCheck
      expect(mockToolExecute).toHaveBeenCalledOnce();
    });

    it('should handle concurrent onRtcUpdate calls safely', async () => {
      const rtc = createMockRtc();
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      // Fire multiple onRtcUpdate concurrently
      const p1 = processor.onRtcUpdate();
      const p2 = processor.onRtcUpdate();
      const p3 = processor.onRtcUpdate();

      await runWithTimers(Promise.all([p1, p2, p3]));

      // Only one processLoop runs; others set pendingCheck
      expect(mockToolExecute).toHaveBeenCalledOnce();
    });
  });

  // ============================================================
  // calculateBackoff (indirect via retry behavior)
  // ============================================================

  describe('calculateBackoff', () => {
    it('should produce exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)', () => {
      // Access the private method via type assertion for direct testing
      const calc = (processor as unknown as { calculateBackoff: (n: number) => number }).calculateBackoff;

      expect(calc(0)).toBe(1000);
      expect(calc(1)).toBe(2000);
      expect(calc(2)).toBe(4000);
      expect(calc(3)).toBe(8000);
      expect(calc(4)).toBe(16000);
      expect(calc(5)).toBe(30000);  // capped
      expect(calc(10)).toBe(30000); // capped
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe('edge cases', () => {
    it('should handle RTC with undefined parameters gracefully', async () => {
      const rtc = createMockRtc({ tool_name: 'ls' });
      (rtc as { parameters: undefined }).parameters = undefined;
      mockPersistence.getNextRtcToProcess
        .mockResolvedValueOnce(rtc)
        .mockResolvedValueOnce(undefined);
      mockNeedsConfirm.mockReturnValue(false);
      mockToolExecute.mockResolvedValue({ success: true, data: {} });

      await runWithTimers(processor.onRtcUpdate());

      expect(mockToolExecute).toHaveBeenCalledWith('ls', {});
    });

    it('should clear retry counter after successful retry', async () => {
      const rtc = createMockRtc({ sync_status: 'failed', status: 'completed' });

      // First: fail to increment retry counter
      mockPersistence.getNextRtcToProcess.mockResolvedValueOnce(rtc);
      mockPersistence.submitRtcResult.mockRejectedValueOnce(new Error('fail'));

      const p1 = processor.onRtcUpdate();
      // After failure, loop continues (non-connection error), fetches rtc again
      mockPersistence.getNextRtcToProcess.mockResolvedValueOnce(rtc);
      mockPersistence.getNextRtcToProcess.mockResolvedValueOnce(undefined);
      mockPersistence.submitRtcResult.mockResolvedValueOnce(undefined);

      await runWithTimers(p1);

      // submitRtcResult called twice: first failed, then succeeded
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledTimes(2);
    });

    it('should abandon RTC after MAX_SUBMIT_RETRY_COUNT and break loop', async () => {
      const rtc = createMockRtc({ client_id: 'rtc-stuck', sync_status: 'failed', status: 'completed' });

      // getNextRtcToProcess always returns the same RTC (simulating a permanently failed RTC)
      mockPersistence.getNextRtcToProcess.mockResolvedValue(rtc);
      // submitRtcResult always fails
      mockPersistence.submitRtcResult.mockRejectedValue(new Error('permanent failure'));

      await runWithTimers(processor.onRtcUpdate());

      // Should have tried exactly 10 times (MAX_SUBMIT_RETRY_COUNT), then given up.
      // After the 10th failure, processOne silently skips (no throw), processLoop detects
      // the same RTC returned again and breaks.
      expect(mockPersistence.submitRtcResult).toHaveBeenCalledTimes(10);
      // getNextRtcToProcess called 12 times: 10 for retries + 1 where processOne silently
      // skips + 1 that returns the same RTC after the silent skip, triggering the break.
      expect(mockPersistence.getNextRtcToProcess).toHaveBeenCalledTimes(12);
    });
  });
});
