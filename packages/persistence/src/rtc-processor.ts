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
 * RTC 处理器：串行处理 RTC，防止重入
 *
 * 设计要点：
 * - processing 标志防止多个循环并发
 * - pendingCheck 确保不遗漏新推送
 * - 根据权限模式决定是否需要用户确认
 * - confirmDialog 由外部注入（component 层实现）
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

  /**
   * 收到 RTC 更新时调用
   * 如果已经在处理，标记 pendingCheck，当前循环会检查
   */
  async onRtcUpdate() {
    if (this.processing) {
      this.pendingCheck = true;
      return;
    }
    await this.processLoop();
  }

  private async processLoop() {
    this.processing = true;

    try {
      while (true) {
        this.pendingCheck = false;

        const rtc = await this.persistence.getNextRtcToProcess();
        if (!rtc) {
          if (this.pendingCheck) {
            continue;
          }
          break;
        }

        try {
          await this.processOne(rtc);
        } catch (err) {
          console.error('[RtcProcessor] processOne failed:', err);
        }
      }
    } finally {
      this.processing = false;
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
