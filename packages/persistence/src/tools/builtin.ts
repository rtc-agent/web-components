/**
 * Built-in Tools
 *
 * 6 basic tools: ls, read, write, find, grep, script
 * File operations are implemented on top of VirtualFS.
 */

import type { Tool, ToolParams, ToolResult } from './types.js';
import { virtualFS, PathError } from '../virtual-fs.js';
import {
  createSandbox,
  _executeCode,
  parseScriptContent,
  saveScript,
  transformTypeScript,
  type RtcAgentAPI,
  type ScriptTimeoutError,
  type ScriptCompileError,
} from '../script-engine.js';

/**
 * Shared FS operation wrapper.
 * Centralizes error handling to avoid duplicating try/catch in every Tool.
 *
 * M6: Added catch-all error handling; unrecognized error types are no longer thrown.
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
    // M6: Catch-all handling; unrecognized errors are no longer thrown
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * String parameter validation helper.
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
 * M7: Number parameter validation (with type coercion attempt).
 */
function validateNumberParam(params: ToolParams, name: string): number | null {
  const value = params[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  // Attempt string-to-number conversion
  if (typeof value === 'string') {
    const num = Number(value);
    if (!isNaN(num)) {
      return num;
    }
  }
  throw new TypeError(`Parameter '${name}' must be a number, got ${typeof value}`);
}

/** write tool mode whitelist (MD4) */
const VALID_WRITE_MODES = ['overwrite', 'append', 'create-new'] as const;
type WriteMode = typeof VALID_WRITE_MODES[number];

function isValidWriteMode(mode: unknown): mode is WriteMode {
  return typeof mode === 'string' && (VALID_WRITE_MODES as readonly string[]).includes(mode);
}

/** ls - list directory contents */
export class LsTool implements Tool {
  // m4: removed redundant `as const`
  readonly name = 'ls';
  readonly description = 'List directory contents';

  async execute(params: ToolParams): Promise<ToolResult> {
    const path = validateStringParam(params, 'path') || '/';
    return executeFS(() => virtualFS.ls(path));
  }
}

/** read - read file contents */
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

/** write - write to file */
export class WriteTool implements Tool {
  readonly name = 'write';
  readonly description = 'Write to file';

  async execute(params: ToolParams): Promise<ToolResult> {
    const path = validateStringParam(params, 'path');
    if (!path) {
      return { success: false, error: 'path is required' };
    }
    const content = (params.content as string) || '';

    // MD4: mode whitelist validation
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

/** find - search for files by pattern */
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

/** grep - search file contents */
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
 * script - save or execute scripts.
 *
 * M5: rtcAgent is injected via constructor, no longer relying on global mutable state.
 */
export class ScriptTool implements Tool {
  readonly name = 'script';
  readonly description = 'Save or execute scripts. Actions: save (save script to /scripts/), run (execute saved script), eval (execute inline code)';

  private readonly rtcAgent: RtcAgentAPI | null;

  /**
   * @param rtcAgent - Host API, injected into the script sandbox (M5)
   */
  constructor(rtcAgent?: RtcAgentAPI) {
    this.rtcAgent = rtcAgent ?? null;
  }

  async execute(params: ToolParams): Promise<ToolResult> {
    let action = validateStringParam(params, 'action');
    if (!action) {
      action = 'eval';
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
   * Save script to /scripts/{name}.ts.
   *
   * Performs syntax validation (including loop guard) before saving, rejecting
   * scripts containing dangerous loop constructs. This prevents leaving
   * "time bombs" in the file system that would only be caught at run time.
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

    // Run syntax check first (triggers loopGuardPlugin); reject save on failure
    try {
      transformTypeScript(code, name);
    } catch (err) {
      if (err instanceof Error && 'isScriptCompileError' in err) {
        return { success: false, error: `Script syntax check failed: ${(err as ScriptCompileError).message}` };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Script syntax check failed: ${msg}` };
    }

    try {
      const path = await saveScript(name, code, description);
      return {
        success: true,
        data: { path, name },
      };
    } catch (err) {
      // MD6: Properly handle Error objects
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to save script: ${msg}` };
    }
  }

  /**
   * Execute a saved script.
   */
  private async _runScript(params: ToolParams): Promise<ToolResult> {
    const name = validateStringParam(params, 'name');
    if (!name) {
      return { success: false, error: 'name is required for run action' };
    }

    const scriptParams = (params.params as Record<string, unknown>) || {};
    const timeout = validateNumberParam(params, 'timeout') ?? 30000;
    const title = validateStringParam(params, 'title') ?? undefined;

    // MD5 + M5: Use constructor-injected rtcAgent
    return this._executeCode(name, scriptParams, timeout, undefined, title);
  }

  /**
   * Execute inline code (not saved).
   */
  private async _evalScript(params: ToolParams): Promise<ToolResult> {
    const code = validateStringParam(params, 'code');
    if (!code) {
      return { success: false, error: 'code is required for eval action' };
    }

    const scriptParams = (params.params as Record<string, unknown>) || {};
    const timeout = validateNumberParam(params, 'timeout') ?? 30000;
    const title = validateStringParam(params, 'title') ?? undefined;

    // MD5 + M5: Use constructor-injected rtcAgent
    return this._executeCode(undefined, scriptParams, timeout, code, title);
  }

  /**
   * MD5: Extracted common execution logic to avoid code duplication
   * between _runScript and _evalScript.
   *
   * @param name - Script name (provided on run, undefined on eval)
   * @param scriptParams - Parameters passed to the script
   * @param timeout - Timeout in milliseconds
   * @param inlineCode - Inline code (provided on eval)
   */
  private async _executeCode(
    name: string | undefined,
    scriptParams: Record<string, unknown>,
    timeout: number,
    inlineCode?: string,
    title?: string
  ): Promise<ToolResult> {
    if (!this.rtcAgent) {
      return { success: false, error: 'rtcAgent not initialized. Pass rtcAgent to ScriptTool constructor.' };
    }

    try {
      let code: string;

      if (inlineCode !== undefined) {
        // Eval mode: use inline code directly
        code = inlineCode;
      } else {
        // Run mode: read script from file system
        const path = `/scripts/${name}.ts`;
        const content = await virtualFS.read(path);
        const parsed = parseScriptContent(content);
        code = parsed.code;
      }

      // Create output collector
      const output = { logs: [], warns: [], errors: [] };
      const sandbox = createSandbox(this.rtcAgent, scriptParams, output, title || undefined);

      // Timing: record script execution duration
      const startTime = performance.now();
      const result = await _executeCode(code, sandbox, timeout, name);
      const durationMs = Math.round(performance.now() - startTime);

      // Build return data
      const data: Record<string, unknown> = {};
      if (name) data.name = name;
      if (result !== undefined) data.result = result;
      // Truncate console output (max 100 entries to prevent oversized data from bloating the database)
      const MAX_LOG_ENTRIES = 100;
      if (output.logs.length > 0) data.logs = output.logs.slice(0, MAX_LOG_ENTRIES);
      if (output.warns.length > 0) data.warnings = output.warns.slice(0, MAX_LOG_ENTRIES);
      if (output.errors.length > 0) data.errors = output.errors.slice(0, MAX_LOG_ENTRIES);
      data.duration_ms = durationMs;

      return {
        success: true,
        data,
      };
    } catch (err) {
      // Leverage custom error classes for more precise error information (MD2)
      if (err instanceof Error && 'isScriptTimeout' in err) {
        return { success: false, error: (err as ScriptTimeoutError).message };
      }
      if (err instanceof Error && 'isScriptCompileError' in err) {
        return { success: false, error: `Script compile error: ${(err as ScriptCompileError).message}` };
      }
      // MD6: Properly handle Error objects
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Script execution failed: ${msg}` };
    }
  }
}

/**
 * Create built-in tool instance list.
 *
 * M5: rtcAgent is passed via parameter to ScriptTool instead of using global mutable state.
 *
 * @param rtcAgent - Optional host API, passed to ScriptTool
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
 * Default built-in tool instance list (without rtcAgent).
 *
 * Note: To use the script tool's run/eval functionality, use
 * createBuiltinTools(rtcAgent) and provide the host API.
 */
export const builtinTools: Tool[] = createBuiltinTools();
