/**
 * Skill Context
 *
 * Provides Skill system state to child components
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: future Skill panels, Function list components, etc.
 */

import { createContext } from '@lit/context';
import type { FunctionRegistry } from '../core/function-registry.js';

/**
 * Skill Context value
 */
export interface SkillContextValue {
  /** Function registry instance */
  registry: FunctionRegistry | null;
}

/**
 * Skill Context default value
 */
export const DEFAULT_SKILL_STATE: SkillContextValue = {
  registry: null,
};

/**
 * Skill Context key
 */
export const SkillContext = createContext<SkillContextValue>(Symbol('skill-context'));
