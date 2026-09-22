/**
 * Tool System Types
 */

/** Tool name */
export type ToolName = 'ls' | 'read' | 'write' | 'find' | 'grep' | 'script' | 'askUser';

/** Tool parameters */
export interface ToolParams {
  [key: string]: unknown;
}

/** Tool execution result */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Tool interface */
export interface Tool {
  /** Tool name */
  readonly name: ToolName;

  /** Tool description */
  readonly description: string;

  /**
   * Execute the tool.
   * @param params Tool parameters
   * @returns Execution result
   */
  execute(params: ToolParams): Promise<ToolResult>;
}
