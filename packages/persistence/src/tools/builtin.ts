/**
 * Built-in Tools
 *
 * 6 个基础工具：ls, read, write, find, grep, script
 * 基于 VirtualFS 实现文件操作
 */

import type { Tool, ToolParams, ToolResult } from './types.js';
import { virtualFS, PathError } from '../virtual-fs.js';
import {
  createSandbox,
  _executeCode,
  parseScriptContent,
  saveScript,
  type RtcAgentAPI,
  type ScriptTimeoutError,
  type ScriptCompileError,
} from '../script-engine.js';

/**
 * 共用的 FS 操作包装函数
 * 统一错误处理逻辑，避免每个 Tool 重复 try/catch
 *
 * M6: 添加兜底错误处理，不再 throw 未识别的错误类型
 */
async function executeFS<T>(fn: () => Promise<T>): Promise<ToolResult> {
  try {
    const result = await fn();
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof PathError) {
      return { success: false, error: err.message };
    }
    if (err instanceof SyntaxError) {
      return { success: false, error: err.message };
    }
    // M6: 兜底处理，不再 throw 未识别的错误
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * 参数验证辅助函数
 */
function validateStringParam(params: ToolParams, name: string): string | null {
  const value = params[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new TypeError(`Parameter '${name}' must be a string, got ${typeof value}`);
  }
  return value;
}

/**
 * M7: 数字参数验证（尝试类型转换）
 */
function validateNumberParam(params: ToolParams, name: string): number | null {
  const value = params[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  // 尝试从字符串转换
  if (typeof value === 'string') {
    const num = Number(value);
    if (!isNaN(num)) {
      return num;
    }
  }
  throw new TypeError(`Parameter '${name}' must be a number, got ${typeof value}`);
}

/** write 工具的 mode 白名单 (MD4) */
const VALID_WRITE_MODES = ['overwrite', 'append'] as const;
type WriteMode = typeof VALID_WRITE_MODES[number];

function isValidWriteMode(mode: unknown): mode is WriteMode {
  return typeof mode === 'string' && (VALID_WRITE_MODES as readonly string[]).includes(mode);
}

/** ls - 列出目录内容 */
export class LsTool implements Tool {
  // m4: 移除多余的 `as const`
  readonly name = 'ls';
  readonly description = 'List directory contents';

  async execute(params: ToolParams): Promise<ToolResult> {
    const path = validateStringParam(params, 'path') || '/';
    return executeFS(() => virtualFS.ls(path));
  }
}

/** read - 读取文件内容 */
export class ReadTool implements Tool {
  readonly name = 'read';
  readonly description = 'Read file contents';

  async execute(params: ToolParams): Promise<ToolResult> {
    const path = validateStringParam(params, 'path');
    if (!path) {
      return { success: false, error: 'path is required' };
    }
    const offset = validateNumberParam(params, 'offset') ?? undefined;
    const limit = validateNumberParam(params, 'limit') ?? undefined;
    return executeFS(() => virtualFS.read(path, offset, limit));
  }
}

/** write - 写入文件 */
export class WriteTool implements Tool {
  readonly name = 'write';
  readonly description = 'Write to file';

  async execute(params: ToolParams): Promise<ToolResult> {
    const path = validateStringParam(params, 'path');
    if (!path) {
      return { success: false, error: 'path is required' };
    }
    const content = (params.content as string) || '';

    // MD4: mode 白名单校验
    const rawMode = params.mode ?? 'overwrite';
    if (!isValidWriteMode(rawMode)) {
      return { success: false, error: `Invalid mode '${rawMode}'. Must be one of: ${VALID_WRITE_MODES.join(', ')}` };
    }

    return executeFS(async () => {
      const totalChars = await virtualFS.write(path, content, rawMode);
      return { totalChars, path };
    });
  }
}

/** find - 查找文件 */
export class FindTool implements Tool {
  readonly name = 'find';
  readonly description = 'Find files by pattern';

  async execute(params: ToolParams): Promise<ToolResult> {
    const pattern = validateStringParam(params, 'pattern');
    if (!pattern) {
      return { success: false, error: 'pattern is required' };
    }
    const path = validateStringParam(params, 'path') || '/';
    return executeFS(() => virtualFS.find(pattern, path));
  }
}

/** grep - 搜索文件内容 */
export class GrepTool implements Tool {
  readonly name = 'grep';
  readonly description = 'Search file contents';

  async execute(params: ToolParams): Promise<ToolResult> {
    const pattern = validateStringParam(params, 'pattern');
    if (!pattern) {
      return { success: false, error: 'pattern is required' };
    }
    const path = validateStringParam(params, 'path') || '/';
    const caseSensitive = (params.case_sensitive as boolean) || false;
    const maxResults = validateNumberParam(params, 'max_results') ?? 100;
    return executeFS(() => virtualFS.grep(pattern, path, caseSensitive, maxResults));
  }
}

/**
 * script - 保存或执行脚本
 *
 * M5: rtcAgent 通过构造函数注入，不再依赖全局可变状态
 */
export class ScriptTool implements Tool {
  readonly name = 'script';
  readonly description = 'Save or execute scripts. Actions: save (save script to /scripts/), run (execute saved script), eval (execute inline code)';

  private readonly rtcAgent: RtcAgentAPI | null;

  /**
   * @param rtcAgent - 宿主 API，注入到脚本沙箱中（M5）
   */
  constructor(rtcAgent?: RtcAgentAPI) {
    this.rtcAgent = rtcAgent ?? null;
  }

  async execute(params: ToolParams): Promise<ToolResult> {
    const action = validateStringParam(params, 'action');
    if (!action) {
      return { success: false, error: 'action is required (save, run, or eval)' };
    }

    if (action === 'save') {
      return this._saveScript(params);
    } else if (action === 'run') {
      return this._runScript(params);
    } else if (action === 'eval') {
      return this._evalScript(params);
    } else {
      return { success: false, error: `Unknown action: ${action}. Use save, run, or eval.` };
    }
  }

  /**
   * 保存脚本到 /scripts/{name}.ts
   */
  private async _saveScript(params: ToolParams): Promise<ToolResult> {
    const name = validateStringParam(params, 'name');
    if (!name) {
      return { success: false, error: 'name is required for save action' };
    }

    const code = validateStringParam(params, 'code');
    if (!code) {
      return { success: false, error: 'code is required for save action' };
    }

    const description = validateStringParam(params, 'description') || undefined;

    try {
      const path = await saveScript(name, code, description);
      return {
        success: true,
        data: { path, name },
      };
    } catch (err) {
      // MD6: 正确处理 Error 对象
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to save script: ${msg}` };
    }
  }

  /**
   * 执行已保存的脚本
   */
  private async _runScript(params: ToolParams): Promise<ToolResult> {
    const name = validateStringParam(params, 'name');
    if (!name) {
      return { success: false, error: 'name is required for run action' };
    }

    const scriptParams = (params.params as Record<string, unknown>) || {};
    const timeout = validateNumberParam(params, 'timeout') ?? 30000;

    // MD5 + M5: 使用构造函数注入的 rtcAgent
    return this._executeCode(name, scriptParams, timeout);
  }

  /**
   * 执行内联代码（不保存）
   */
  private async _evalScript(params: ToolParams): Promise<ToolResult> {
    const code = validateStringParam(params, 'code');
    if (!code) {
      return { success: false, error: 'code is required for eval action' };
    }

    const scriptParams = (params.params as Record<string, unknown>) || {};
    const timeout = validateNumberParam(params, 'timeout') ?? 30000;

    // MD5 + M5: 使用构造函数注入的 rtcAgent
    return this._executeCode(undefined, scriptParams, timeout, code);
  }

  /**
   * MD5: 抽取公共执行逻辑，避免 _runScript 和 _evalScript 重复代码
   *
   * @param name - 脚本名称（run 时提供，eval 时为 undefined）
   * @param scriptParams - 传递给脚本的参数
   * @param timeout - 超时时间（毫秒）
   * @param inlineCode - 内联代码（eval 时提供）
   */
  private async _executeCode(
    name: string | undefined,
    scriptParams: Record<string, unknown>,
    timeout: number,
    inlineCode?: string
  ): Promise<ToolResult> {
    if (!this.rtcAgent) {
      return { success: false, error: 'rtcAgent not initialized. Pass rtcAgent to ScriptTool constructor.' };
    }

    try {
      let code: string;

      if (inlineCode !== undefined) {
        // eval 模式：直接使用内联代码
        code = inlineCode;
      } else {
        // run 模式：从文件系统读取脚本
        const path = `/scripts/${name}.ts`;
        const content = await virtualFS.read(path);
        const parsed = parseScriptContent(content);
        code = parsed.code;
      }

      // 创建输出收集器
      const output = { logs: [], warns: [], errors: [] };
      const sandbox = createSandbox(this.rtcAgent, scriptParams, output);
      const result = await _executeCode(code, sandbox, timeout, name);

      // 构建返回数据
      const data: Record<string, unknown> = {};
      if (name) data.name = name;
      if (result !== undefined) data.result = result;
      if (output.logs.length > 0) data.logs = output.logs;
      if (output.warns.length > 0) data.warnings = output.warns;
      if (output.errors.length > 0) data.errors = output.errors;

      return {
        success: true,
        data,
      };
    } catch (err) {
      // 利用自定义错误类提供更精确的错误信息 (MD2)
      if (err instanceof Error && 'isScriptTimeout' in err) {
        return { success: false, error: (err as ScriptTimeoutError).message };
      }
      if (err instanceof Error && 'isScriptCompileError' in err) {
        return { success: false, error: `Script compile error: ${(err as ScriptCompileError).message}` };
      }
      // MD6: 正确处理 Error 对象
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Script execution failed: ${msg}` };
    }
  }
}

/**
 * 创建内置工具实例列表
 *
 * M5: rtcAgent 通过参数传入 ScriptTool，不再使用全局可变状态
 *
 * @param rtcAgent - 可选的宿主 API，传递给 ScriptTool
 */
export function createBuiltinTools(rtcAgent?: RtcAgentAPI): Tool[] {
  return [
    new LsTool(),
    new ReadTool(),
    new WriteTool(),
    new FindTool(),
    new GrepTool(),
    new ScriptTool(rtcAgent),
  ];
}

/**
 * 默认内置工具实例列表（不含 rtcAgent）
 *
 * 注意：如果需要使用 script 工具的 run/eval 功能，
 * 请使用 createBuiltinTools(rtcAgent) 并提供宿主 API。
 */
export const builtinTools: Tool[] = createBuiltinTools();
