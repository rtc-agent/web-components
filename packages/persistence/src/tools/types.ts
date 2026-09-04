/**
 * Tool System Types
 */

/** 工具名称 */
export type ToolName = 'ls' | 'read' | 'write' | 'find' | 'grep' | 'script';

/** 工具参数 */
export interface ToolParams {
  [key: string]: unknown;
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** 工具接口 */
export interface Tool {
  /** 工具名称 */
  readonly name: ToolName;

  /** 工具描述 */
  readonly description: string;

  /**
   * 执行工具
   * @param params 工具参数
   * @returns 执行结果
   */
  execute(params: ToolParams): Promise<ToolResult>;
}
