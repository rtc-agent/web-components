/**
 * Agent Declarative Configuration
 *
 * Declarative configuration API for the <rtc-agent> component.
 * The host application completes all configuration by setting `element.agentConfig = {...}`,
 * without needing to understand internal concepts like FunctionRegistry / FunctionGroup / toolRegistry.
 *
 * @example
 * ```ts
 * const agent = document.querySelector<RtcAgent>('#agent')!;
 * agent.agentConfig = {
 *   name: 'MermaidEditor',
 *   persona: 'You are a helpful Mermaid diagram assistant...',
 *   groups: [{
 *     name: 'editor',
 *     description: 'Editor operations',
 *     functions: [
 *       { name: 'getCode', description: 'Get current code', handler: () => editorAPI.getCode() },
 *     ],
 *   }],
 * };
 * ```
 */

import type { FunctionDef } from './skill.js';

/**
 * Agent declarative configuration
 *
 * Set via the <rtc-agent>.agentConfig property.
 * Internally, the component builds a FunctionRegistry from this config and bridges it to the toolRegistry.
 */
export interface AgentConfig {
  /** Agent name (used for system prompt, etc.). Falls back to appLabel if omitted */
  name?: string;
  /** Agent description */
  description?: string;
  /** AI persona (system prompt) */
  persona?: string;
  /**
   * Flat function list (automatically placed into a group named 'default')
   *
   * For simple scenarios, use `functions` directly; for complex scenarios, use `groups` to organize.
   * Both can be used together: `groups` is registered first, then `functions`.
   */
  functions?: FunctionDef[];
  /** Grouped function list */
  groups?: AgentFunctionGroup[];
  /** Async operation error callback (e.g. document generation failure) */
  onError?: (error: Error, context: string) => void;
}

/**
 * Agent function group
 */
export interface AgentFunctionGroup {
  /** Group name (e.g. 'editor', 'file') */
  name: string;
  /** Group description */
  description?: string;
  /** Function list under this group */
  functions: FunctionDef[];
}
