/**
 * Tool Registry
 *
 * 管理工具注册和执行
 */

import type { Tool, ToolName, ToolParams, ToolResult } from './types.js';
import { createBuiltinTools, ScriptTool } from './builtin.js';
import type { RtcAgentAPI } from '../script-engine.js';

/**
 * 工具注册表
 *
 * 扩展新工具：
 * 1. 实现 Tool 接口
 * 2. 调用 register(tool) 注册
 */
export class ToolRegistry {
  private tools = new Map<ToolName, Tool>();
  private rtcAgent?: RtcAgentAPI;

  /**
   * @param rtcAgent - 可选的宿主 API，传递给 ScriptTool（M5）
   */
  constructor(rtcAgent?: RtcAgentAPI) {
    this.rtcAgent = rtcAgent;
    // 注册所有内置工具（M5：传入 rtcAgent）
    const builtinTools = createBuiltinTools(rtcAgent);
    for (const tool of builtinTools) {
      this.register(tool);
    }
  }

  /**
   * 注入 rtcAgent API 到 ScriptTool
   *
   * 用于延迟注入：全局 toolRegistry 创建时可能没有 rtcAgent，
   * 组件初始化后调用此方法注入。
   */
  setRtcAgent(rtcAgent: RtcAgentAPI): void {
    this.rtcAgent = rtcAgent;
    // 替换 ScriptTool 实例
    this.register(new ScriptTool(rtcAgent));
  }

  /** 注册工具 */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** 获取工具 */
  get(name: ToolName): Tool | undefined {
    return this.tools.get(name);
  }

  /** 检查工具是否存在 */
  has(name: ToolName): boolean {
    return this.tools.has(name);
  }

  /** 获取所有工具名称 */
  getToolNames(): ToolName[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 执行工具
   * @throws Error 如果工具不存在
   */
  async execute(name: ToolName, params: ToolParams): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(params);
  }
}

/** 全局工具注册表实例（不含 rtcAgent，需要通过 register() 手动添加 ScriptTool 或传入 rtcAgent 创建新实例） */
export const toolRegistry = new ToolRegistry();
