/**
 * Agent Declarative Configuration
 *
 * 用于 <rtc-agent> 组件的声明式配置 API。
 * 宿主应用通过设置 `element.agentConfig = {...}` 完成所有配置，
 * 无需了解内部的 FunctionRegistry / FunctionGroup / toolRegistry 等概念。
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
 * Agent 声明式配置
 *
 * 通过 <rtc-agent>.agentConfig 属性设置。
 * 组件内部会基于此配置构建 FunctionRegistry 并桥接到 toolRegistry。
 */
export interface AgentConfig {
  /** Agent 名称（用于 system prompt 等场景）。缺省使用 appLabel */
  name?: string;
  /** Agent 描述 */
  description?: string;
  /** AI 人设（system prompt） */
  persona?: string;
  /**
   * 平铺的函数列表（自动放入名为 'default' 的 group）
   *
   * 简单场景可直接使用 functions；复杂场景使用 groups 分组。
   * 两者可同时使用：groups 在前，functions 在后注册。
   */
  functions?: FunctionDef[];
  /** 分组的函数列表 */
  groups?: AgentFunctionGroup[];
  /** 异步操作错误回调（如文档生成失败） */
  onError?: (error: Error, context: string) => void;
}

/**
 * Agent 函数分组
 */
export interface AgentFunctionGroup {
  /** 分组名称（如 'editor'、'file'） */
  name: string;
  /** 分组描述 */
  description?: string;
  /** 该分组下的函数列表 */
  functions: FunctionDef[];
}
