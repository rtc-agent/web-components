/**
 * Skill Context
 *
 * 提供 Skill 系统状态给子组件
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: 未来的 Skill 面板、Function 列表组件等
 */

import { createContext } from '@lit/context';
import type { FunctionRegistry } from '../core/function-registry.js';

/**
 * Skill Context 值
 */
export interface SkillContextValue {
  /** Function 注册表实例 */
  registry: FunctionRegistry | null;
}

/**
 * Skill Context 默认值
 */
export const DEFAULT_SKILL_STATE: SkillContextValue = {
  registry: null,
};

/**
 * Skill Context key
 */
export const SkillContext = createContext<SkillContextValue>(Symbol('skill-context'));
