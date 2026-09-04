/**
 * Permission System
 *
 * 根据工具名称和模式，决定是否需要用户确认
 */

import type { ToolName } from './tools/types.js';

/** 工作模式（与 component 包的 Mode 类型保持一致） */
export type Mode = 'manual' | 'edit' | 'plan' | 'auto' | 'bypass';

/** 权限动作 */
export type PermissionAction =
  | 'allow'   // 自动通过，无需确认
  | 'confirm' // 需要用户确认
  | 'deny';   // 禁止执行

/**
 * 权限规则表
 *
 * 扩展新工具时，在此添加对应的权限规则
 *
 * plan 和 auto 模式当前未启用，暂时使用与 edit 相同的规则
 */
const PERMISSION_RULES: Record<ToolName, Record<Mode, PermissionAction>> = {
  ls:     { manual: 'allow', edit: 'allow', plan: 'allow', auto: 'allow', bypass: 'allow' },
  read:   { manual: 'allow', edit: 'allow', plan: 'allow', auto: 'allow', bypass: 'allow' },
  find:   { manual: 'allow', edit: 'allow', plan: 'allow', auto: 'allow', bypass: 'allow' },
  grep:   { manual: 'allow', edit: 'allow', plan: 'allow', auto: 'allow', bypass: 'allow' },
  write:  { manual: 'confirm', edit: 'allow', plan: 'allow', auto: 'allow', bypass: 'allow' },
  script: { manual: 'confirm', edit: 'confirm', plan: 'confirm', auto: 'confirm', bypass: 'allow' },
};

/**
 * 权限检查器
 */
export class PermissionChecker {
  /**
   * 检查权限
   * @param toolName 工具名称
   * @param mode 当前模式
   * @returns 权限动作
   */
  check(toolName: ToolName, mode: Mode): PermissionAction {
    const rule = PERMISSION_RULES[toolName];
    if (!rule) {
      // 未知工具默认需要确认
      console.warn(`[PermissionChecker] Unknown tool: ${toolName}, requiring confirm`);
      return 'confirm';
    }
    return rule[mode];
  }

  /**
   * 是否需要用户确认
   */
  needsConfirm(toolName: ToolName, mode: Mode): boolean {
    return this.check(toolName, mode) === 'confirm';
  }

  /**
   * 是否自动允许
   */
  isAllowed(toolName: ToolName, mode: Mode): boolean {
    return this.check(toolName, mode) === 'allow';
  }
}

/** 全局权限检查器实例 */
export const permissionChecker = new PermissionChecker();
