import type { PersistenceLayer } from './index.js';
import type { LocalRtc } from './database.js';
import type { Mode } from './permission.js';
import { permissionChecker } from './permission.js';
import { toolRegistry } from './tools/index.js';
import type { ToolName, ToolParams } from './tools/types.js';

/**
 * 确认对话框回调类型
 *
 * 由 component 层实现，注入到 RtcProcessor
 * @param rtc 待确认的 RTC
 * @returns 用户是否批准
 */
export type ConfirmDialogFn = (rtc: LocalRtc) => Promise<boolean>;

/**
 * AskUser 对话框回调类型
 *
 * 由 component 层实现（<rtc-ask-user>），注入到 RtcProcessor。
 * 与普通 confirm 不同：ask_user 的"执行"就是收集用户选择，
 * 所以回调返回用户答案 dict（或 null 表示拒绝）。
 *
 * @param rtc 待回答的 RTC，parameters 内含 questions 数组
 * @returns 用户答案 { answers, annotations?, metadata? }，或 null 表示拒绝
 */
export type AskUserDialogFn = (rtc: LocalRtc) => Promise<{
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
  metadata?: { source?: string };
} | null>;

/**
 * Master 资格判断的最小接口
 *
 * 设计为最小 duck-type，以便 component 层的 MasterLock 或其他实现都能注入。
 * persistence 包不直接依赖 component 包的 MasterLock 类。
 *
 * @see docs/shared-worker-proposal.md §4.2
 */
export interface MasterLike {
  readonly isMaster: boolean;
}

/**
 * RTC 处理器：串行处理 RTC，防止重入
 *
 * 设计要点：
 * - processing 标志防止多个循环并发
 * - pendingCheck 确保不遗漏新推送
 * - 根据权限模式决定是否需要用户确认
 * - confirmDialog 由外部注入（component 层实现）
 * - 可选注入 MasterLike：多 Tab 场景下仅 Master Tab 执行工具
 *   （未注入时视为永远是 Master）
 *
 * Device ID 过滤在写入时完成（EntityRepository），此处无需关心。
 */
export class RtcProcessor {
  private persistence: PersistenceLayer;
  private processing = false;
  private pendingCheck = false;
  /** 内存中的重试计数器：rtcClientId → 重试次数（刷新后清零） */
  private retryCountMap = new Map<string, number>();
  /** 当前工作模式 */
  private mode: Mode = 'edit';
  /** 确认对话框（由 component 层注入） */
  private confirmDialog?: ConfirmDialogFn;
  /** AskUser 对话框（由 component 层注入，专用于 ask_user RTC） */
  private askUserDialog?: AskUserDialogFn;
  /** Master 资格判断（可选，多 Tab 场景注入） */
  private master?: MasterLike;

  constructor(persistence: PersistenceLayer) {
    this.persistence = persistence;
  }

  /** 设置工作模式 */
  setMode(mode: Mode): void {
    this.mode = mode;
  }

  /** 获取当前模式 */
  getMode(): Mode {
    return this.mode;
  }

  /** 设置确认对话框回调 */
  setConfirmDialog(fn: ConfirmDialogFn): void {
    this.confirmDialog = fn;
  }

  /** 设置 AskUser 对话框回调（专用于 ask_user RTC） */
  setAskUserDialog(fn: AskUserDialogFn): void {
    this.askUserDialog = fn;
  }

  /**
   * 设置 Master 资格判断
   *
   * 多 Tab 场景下由 component 层注入 MasterLock。
   * 不设置时视为"永远是 Master"。
   */
  setMaster(master: MasterLike | undefined): void {
    this.master = master;
  }

  /**
   * 判断当前 Tab 是否允许执行 RTC
   *
   * - 未注入 master → 视为 Master
   * - 已注入 master → 按 master.isMaster 判断
   */
  private _isMasterAllowed(): boolean {
    return this.master === undefined || this.master.isMaster;
  }

  /**
   * 收到 RTC 更新时调用
   * 如果已经在处理，标记 pendingCheck，当前循环会检查
   */
  async onRtcUpdate() {
    console.log('[RtcProcessor] onRtcUpdate called, processing:', this.processing);
    if (this.processing) {
      this.pendingCheck = true;
      return;
    }
    await this.processLoop();
  }

  private async processLoop() {
    // 非 Master Tab 跳过工具执行（proposal §4.2）
    // 不设置 processing 标志，避免阻塞未来 Master 升级后的处理
    if (!this._isMasterAllowed()) {
      console.log('[RtcProcessor] processLoop: not master, skipping');
      return;
    }

    this.processing = true;
    console.log('[RtcProcessor] processLoop started');

    try {
      while (true) {
        this.pendingCheck = false;

        const rtc = await this.persistence.getNextRtcToProcess(undefined);
        if (!rtc) {
          console.log('[RtcProcessor] processLoop: no more RTC to process, exiting');
          if (this.pendingCheck) {
            continue;
          }
          break;
        }

        console.log('[RtcProcessor] processing RTC:', rtc.client_id, 'tool:', rtc.tool_name, 'sync_status:', rtc.sync_status);
        try {
          await this.processOne(rtc);
          console.log('[RtcProcessor] processOne completed successfully');
        } catch (err) {
          console.error('[RtcProcessor] processOne failed:', err);
          // 如果是连接错误，退出循环，等待连接恢复
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes('connection') || errMsg.includes('disconnected')) {
            console.warn('[RtcProcessor] connection error detected, exiting processLoop');
            break;
          }
          // 其他错误，等待一下再重试，避免快速循环
          await this.sleep(1000);
        }
      }
    } finally {
      this.processing = false;
      console.log('[RtcProcessor] processLoop finished');
    }
  }

  private async processOne(rtc: LocalRtc) {
    if (rtc.sync_status === 'failed') {
      // 重试：根据重试次数指数退避
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
        // 成功：清除重试计数
        this.retryCountMap.delete(rtc.client_id);
      } catch (err) {
        // 失败：递增重试计数
        this.retryCountMap.set(rtc.client_id, retryCount + 1);
        throw err;
      }
    } else {
      // 新任务：检查权限
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
          console.error('[RtcProcessor] submitRtcResult (denied) failed:', err);
        }
        return;
      }

      // 执行工具
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
        console.error('[RtcProcessor] submitRtcResult failed:', err);
      }
    }
  }

  /**
   * 处理 ask_user RTC
   *
   * ask_user 与普通工具不同：没有"执行"阶段，用户的选择本身就是 RTC 结果。
   * 通过专用的 askUserDialog 回调渲染多选 UI，收集答案后直接作为 result 提交。
   */
  private async processAskUser(rtc: LocalRtc): Promise<void> {
    if (!this.askUserDialog) {
      console.warn('[RtcProcessor] askUserDialog not set, defaulting to reject');
      try {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success: false,
          error: 'User declined to answer questions',
        });
      } catch (err) {
        console.error('[RtcProcessor] submitRtcResult (ask_user no dialog) failed:', err);
      }
      return;
    }

    let payload: Awaited<ReturnType<AskUserDialogFn>>;
    try {
      payload = await this.askUserDialog(rtc);
    } catch (err) {
      console.error('[RtcProcessor] askUserDialog threw:', err);
      try {
        await this.persistence.submitRtcResult({
          rtcClientId: rtc.client_id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch (submitErr) {
        console.error('[RtcProcessor] submitRtcResult (ask_user error) failed:', submitErr);
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
      console.error('[RtcProcessor] submitRtcResult (ask_user) failed:', err);
    }
  }

  /**
   * 指数退避：1s, 2s, 4s, 8s, 16s, 30s（封顶）
   */
  private calculateBackoff(retryCount: number): number {
    return Math.min(1000 * Math.pow(2, retryCount), 30000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 显示确认对话框
   *
   * 使用注入的 confirmDialog 回调。
   * 如果未设置回调，默认返回 false（拒绝）。
   */
  private async showConfirmDialog(rtc: LocalRtc): Promise<boolean> {
    if (!this.confirmDialog) {
      console.warn('[RtcProcessor] confirmDialog not set, defaulting to reject');
      return false;
    }
    return this.confirmDialog(rtc);
  }
}
