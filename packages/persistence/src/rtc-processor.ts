import type { PersistenceLayer } from './index.js';
import type { LocalRtc } from './database.js';
import type { Mode } from './permission.js';
import { permissionChecker } from './permission.js';
import { toolRegistry } from './tools/index.js';
import type { ToolName, ToolParams } from './tools/types.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('RtcProcessor');

/** Delay before retrying after a non-connection error in the process loop (ms). */
const ERROR_RETRY_DELAY_MS = 1000;

/**
 * Confirm dialog callback type.
 *
 * Implemented by the component layer and injected into RtcProcessor.
 * @param rtc The RTC to confirm
 * @returns Whether the user approved
 */
export type ConfirmDialogFn = (rtc: LocalRtc) => Promise<boolean>;

/**
 * AskUser dialog callback type.
 *
 * Implemented by the component layer (<rtc-ask-user>) and injected into RtcProcessor.
 * Unlike a regular confirm: for ask_user the "execution" IS collecting user input,
 * so the callback returns the user's answer dict (or null to indicate refusal).
 *
 * @param rtc The RTC to answer; parameters contain a questions array
 * @returns User answers { answers, annotations?, metadata? }, or null to indicate refusal
 */
export type AskUserDialogFn = (rtc: LocalRtc) => Promise<{
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
  metadata?: { source?: string };
} | null>;

/**
 * Minimal interface for master eligibility check.
 *
 * Designed as a minimal duck-type so that the component layer's MasterLock or
 * other implementations can be injected. The persistence package does not
 * directly depend on the component package's MasterLock class.
 *
 * @see docs/shared-worker-proposal.md section 4.2
 */
export interface MasterLike {
  readonly isMaster: boolean;
}

/**
 * RtcProcessor: serially processes RTCs to prevent re-entrancy.
 *
 * Design highlights:
 * - `processing` flag prevents concurrent loops
 * - `pendingCheck` ensures new pushes are not missed
 * - Permission mode determines whether user confirmation is required
 * - `confirmDialog` is injected externally (implemented by the component layer)
 * - Optional `MasterLike` injection: in multi-Tab scenarios only the Master Tab executes tools
 *   (when not injected, treated as always being Master)
 *
 * Device ID filtering is done at execution time (EntityRepository.getNextRtcToProcess); not handled here.
 */
export class RtcProcessor {
  private persistence: PersistenceLayer;
  private processing = false;
  private pendingCheck = false;
  /** In-memory retry counter: rtcClientId -> retry count (reset on refresh) */
  private retryCountMap = new Map<string, number>();
  /** Current working mode */
  private mode: Mode = 'edit';
  /** Confirm dialog (injected by the component layer) */
  private confirmDialog?: ConfirmDialogFn;
  /** AskUser dialog (injected by the component layer, dedicated to ask_user RTCs) */
  private askUserDialog?: AskUserDialogFn;
  /** Master eligibility check (optional, injected in multi-Tab scenarios) */
  private master?: MasterLike;

  constructor(persistence: PersistenceLayer) {
    this.persistence = persistence;
  }

  /** Set the working mode */
  setMode(mode: Mode): void {
    this.mode = mode;
  }

  /** Get the current mode */
  getMode(): Mode {
    return this.mode;
  }

  /** Set the confirm dialog callback */
  setConfirmDialog(fn: ConfirmDialogFn): void {
    this.confirmDialog = fn;
  }

  /** Set the AskUser dialog callback (dedicated to ask_user RTCs) */
  setAskUserDialog(fn: AskUserDialogFn): void {
    this.askUserDialog = fn;
  }

  /**
   * Set master eligibility check.
   *
   * In multi-Tab scenarios, the component layer injects MasterLock.
   * When not set, treated as "always Master".
   */
  setMaster(master: MasterLike | undefined): void {
    this.master = master;
  }

  /**
   * Check whether the current Tab is allowed to execute RTCs.
   *
   * - No master injected -> treated as Master
   * - Master injected -> determined by master.isMaster
   */
  private _isMasterAllowed(): boolean {
    return this.master === undefined || this.master.isMaster;
  }

  /**
   * Called when an RTC update is received.
   * If already processing, sets pendingCheck so the current loop will re-check.
   */
  async onRtcUpdate() {
    log.debug('onRtcUpdate called, processing:', this.processing);
    if (this.processing) {
      this.pendingCheck = true;
      return;
    }
    await this.processLoop();
  }

  private async processLoop() {
    // Non-master Tab skips tool execution (proposal section 4.2)
    // Does not set the processing flag, to avoid blocking future Master upgrade processing
    if (!this._isMasterAllowed()) {
      log.debug('processLoop: not master, skipping');
      return;
    }

    this.processing = true;
    log.debug('processLoop started');

    try {
      while (true) {
        this.pendingCheck = false;

        const rtc = await this.persistence.getNextRtcToProcess(undefined);
        if (!rtc) {
          log.debug('processLoop: no more RTC to process, exiting');
          if (this.pendingCheck) {
            continue;
          }
          break;
        }

        log.debug('processing RTC:', rtc.client_id, 'tool:', rtc.tool_name, 'sync_status:', rtc.sync_status);
        try {
          await this.processOne(rtc);
          log.debug('processOne completed successfully');
        } catch (err) {
          log.error('processOne failed:', err);
          // If it's a connection error, exit the loop and wait for connection recovery
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes('connection') || errMsg.includes('disconnected')) {
            log.warn('connection error detected, exiting processLoop');
            break;
          }
          // For other errors, wait briefly before retrying to avoid tight loops
          await this.sleep(ERROR_RETRY_DELAY_MS);
        }
      }
    } finally {
      this.processing = false;
      log.debug('processLoop finished');
    }
  }

  private async processOne(rtc: LocalRtc) {
    if (rtc.sync_status === 'failed') {
      // Retry: exponential backoff based on retry count
      const retryCount = this.retryCountMap.get(rtc.client_id) || 0;
      const delay = this.calculateBackoff(retryCount);
      await this.sleep(delay);

      try {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success: rtc.status === 'completed',
          result: rtc.result,
          error: rtc.error_message,
        });
        // Success: clear retry counter
        this.retryCountMap.delete(rtc.client_id);
      } catch (err) {
        // Failure: increment retry counter
        this.retryCountMap.set(rtc.client_id, retryCount + 1);
        throw err;
      }
    } else {
      // New task: check permissions
      const toolName = rtc.tool_name as ToolName;

      // ask_user is a special case: its "execution" IS the user's input.
      // Route to the dedicated ask-user dialog instead of the generic confirm.
      if (toolName === 'ask_user') {
        await this.processAskUser(rtc);
        return;
      }

      const needsConfirm = permissionChecker.needsConfirm(toolName, this.mode);

      let approved = true;
      if (needsConfirm) {
        approved = await this.showConfirmDialog(rtc);
      }

      if (!approved) {
        try {
          await this.persistence.submitRtcResult({
            rtcClientId: rtc.client_id,
            success: false,
            error: 'User denied',
          });
        } catch (err) {
          log.error('submitRtcResult (denied) failed:', err);
        }
        return;
      }

      // Execute tool
      let result: unknown;
      let success = true;
      let errorMsg: string | undefined;

      try {
        const params = (rtc.parameters || {}) as ToolParams;
        const toolResult = await toolRegistry.execute(toolName, params);
        result = toolResult.data;
        if (!toolResult.success) {
          success = false;
          errorMsg = toolResult.error;
        }
      } catch (err) {
        success = false;
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      try {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success,
          result,
          error: errorMsg,
        });
      } catch (err) {
        log.error('submitRtcResult failed:', err);
      }
    }
  }

  /**
   * Process an ask_user RTC.
   *
   * Unlike regular tools, ask_user has no "execution" phase; the user's selection
   * IS the RTC result. The dedicated askUserDialog callback renders the multi-select
   * UI, collects answers, and submits them directly as the result.
   */
  private async processAskUser(rtc: LocalRtc): Promise<void> {
    if (!this.askUserDialog) {
      log.warn('askUserDialog not set, defaulting to reject');
      try {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success: false,
          error: 'User declined to answer questions',
        });
      } catch (err) {
        log.error('submitRtcResult (ask_user no dialog) failed:', err);
      }
      return;
    }

    let payload: Awaited<ReturnType<AskUserDialogFn>>;
    try {
      payload = await this.askUserDialog(rtc);
    } catch (err) {
      log.error('askUserDialog threw:', err);
      try {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch (submitErr) {
        log.error('submitRtcResult (ask_user error) failed:', submitErr);
      }
      return;
    }

    try {
      if (payload === null) {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success: false,
          error: 'User declined to answer questions',
        });
      } else {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success: true,
          result: payload,
        });
      }
    } catch (err) {
      log.error('submitRtcResult (ask_user) failed:', err);
    }
  }

  /**
   * Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped).
   */
  private calculateBackoff(retryCount: number): number {
    return Math.min(1000 * Math.pow(2, retryCount), 30000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Show the confirm dialog.
   *
   * Uses the injected confirmDialog callback.
   * If no callback is set, defaults to false (reject).
   */
  private async showConfirmDialog(rtc: LocalRtc): Promise<boolean> {
    if (!this.confirmDialog) {
      log.warn('confirmDialog not set, defaulting to reject');
      return false;
    }
    return this.confirmDialog(rtc);
  }
}
