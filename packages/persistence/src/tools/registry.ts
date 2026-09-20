/**
 * Tool Registry
 *
 * Manages tool registration and execution.
 */

import type { Tool, ToolName, ToolParams, ToolResult } from './types.js';
import { createBuiltinTools, ScriptTool } from './builtin.js';
import type { RtcAgentAPI } from '../script-engine.js';

/**
 * Tool registry.
 *
 * To add a new tool:
 * 1. Implement the Tool interface
 * 2. Call register(tool) to register it
 */
export class ToolRegistry {
  private tools = new Map<ToolName, Tool>();

  /**
   * @param rtcAgent - Optional host API, passed to ScriptTool (M5)
   */
  constructor(rtcAgent?: RtcAgentAPI) {
    // Register all built-in tools (M5: pass rtcAgent)
    const builtinTools = createBuiltinTools(rtcAgent);
    for (const tool of builtinTools) {
      this.register(tool);
    }
  }

  /**
   * Inject rtcAgent API into ScriptTool.
   *
   * Used for deferred injection: the global toolRegistry may be created without rtcAgent;
   * the component layer calls this method after initialization to inject it.
   */
  setRtcAgent(rtcAgent: RtcAgentAPI): void {
    // Replace ScriptTool instance
    this.register(new ScriptTool(rtcAgent));
  }

  /** Register a tool */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** Get a tool by name */
  get(name: ToolName): Tool | undefined {
    return this.tools.get(name);
  }

  /** Check if a tool exists */
  has(name: ToolName): boolean {
    return this.tools.has(name);
  }

  /** Get all tool names */
  getToolNames(): ToolName[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool.
   * @throws Error if the tool does not exist
   */
  async execute(name: ToolName, params: ToolParams): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(params);
  }
}

/** Global tool registry instance (no rtcAgent; ScriptTool must be added manually via register() or create a new instance with rtcAgent) */
export const toolRegistry = new ToolRegistry();
