/**
 * Permission System
 *
 * Determines whether user confirmation is required based on tool name and mode.
 */

import type { ToolName } from './tools/types.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('PermissionChecker');

/** Working mode (kept consistent with the Mode type in the component package) */
export type Mode = 'manual' | 'edit' | 'plan' | 'auto' | 'bypass';

/** Permission action result */
export type PermissionAction =
  | 'allow'   // Auto-approved, no confirmation needed
  | 'confirm' // Requires user confirmation
  | 'deny';   // Execution denied

/**
 * Permission rules table
 *
 * When adding new tools, add corresponding permission rules here.
 *
 * Plan and auto modes are not yet enabled; they temporarily use
 * the same rules as edit mode.
 */
const PERMISSION_RULES: Record<ToolName, Record<Mode, PermissionAction>> = {
  ls:       { manual: 'allow',   edit: 'allow',   plan: 'allow',   auto: 'allow',   bypass: 'allow' },
  read:     { manual: 'allow',   edit: 'allow',   plan: 'allow',   auto: 'allow',   bypass: 'allow' },
  find:     { manual: 'allow',   edit: 'allow',   plan: 'allow',   auto: 'allow',   bypass: 'allow' },
  grep:     { manual: 'allow',   edit: 'allow',   plan: 'allow',   auto: 'allow',   bypass: 'allow' },
  write:    { manual: 'confirm', edit: 'allow',   plan: 'allow',   auto: 'allow',   bypass: 'allow' },
  edit:     { manual: 'confirm', edit: 'allow',   plan: 'allow',   auto: 'allow',   bypass: 'allow' },
  script:   { manual: 'confirm', edit: 'confirm', plan: 'confirm', auto: 'confirm', bypass: 'allow' },
  // askUser is inherently interactive: the "execution" IS the user's selection,
  // so it always requires the ask-user dialog regardless of mode.
  askUser: { manual: 'confirm', edit: 'confirm', plan: 'confirm', auto: 'confirm', bypass: 'allow' },
};

/**
 * Permission checker: evaluates tool execution permissions.
 */
export class PermissionChecker {
  /**
   * Check permission for a tool in the given mode.
   * @param toolName Tool name
   * @param mode Current working mode
   * @returns Permission action
   */
  check(toolName: ToolName, mode: Mode): PermissionAction {
    const rule = PERMISSION_RULES[toolName];
    if (!rule) {
      // Unknown tools default to requiring confirmation
      log.warn(`Unknown tool: ${toolName}, requiring confirm`);
      return 'confirm';
    }
    return rule[mode];
  }

  /**
   * Whether user confirmation is needed.
   */
  needsConfirm(toolName: ToolName, mode: Mode): boolean {
    return this.check(toolName, mode) === 'confirm';
  }

  /**
   * Whether the action is automatically allowed.
   */
  isAllowed(toolName: ToolName, mode: Mode): boolean {
    return this.check(toolName, mode) === 'allow';
  }
}

/** Global permission checker instance */
export const permissionChecker = new PermissionChecker();
