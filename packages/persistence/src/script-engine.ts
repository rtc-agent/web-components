/**
 * Script Engine
 *
 * 脚本执行引擎：保存、转换、执行 LLM 生成的脚本
 *
 * 设计原则：
 * - 白名单是"提醒"，不是"防线"（LLM 不是攻击者）
 * - 使用 Babel 转换 TypeScript 语法
 * - 使用 new Function() 执行（无需安全沙箱）
 * - 使用 "use strict" + fn.call(undefined) 防止 this 逃逸到 globalThis
 */

import { transformSync } from '@babel/core';
import presetTypescript from '@babel/preset-typescript';
import type { TransformOptions } from '@babel/core';
import { virtualFS } from './virtual-fs.js';

// ============================================================
// Custom Error Classes (MD2)
// ============================================================

/**
 * ScriptTimeoutError - 脚本执行超时
 */
export class ScriptTimeoutError extends Error {
  readonly isScriptTimeout = true;
  constructor(timeoutMs: number) {
    super(`Script execution timeout after ${timeoutMs}ms`);
    this.name = 'ScriptTimeoutError';
  }
}

/**
 * ScriptCompileError - 脚本编译（Babel 转换）失败
 */
export class ScriptCompileError extends Error {
  readonly isScriptCompileError = true;
  constructor(message: string, public readonly scriptName?: string) {
    super(message);
    this.name = 'ScriptCompileError';
  }
}

// ============================================================
// RtcAgentAPI Interface (MD3)
// ============================================================

/**
 * RtcAgentAPI - 脚本中可用的 rtcAgent 最小接口
 *
 * 定义脚本沙箱中 rtcAgent 对象暴露的最小 API 表面。
 * 实际传入的对象可以包含更多方法，但脚本中只能安全使用此接口定义的方法。
 */
export interface RtcAgentAPI {
  /** 调用已注册的 function */
  callFunction?: (path: string, params: Record<string, unknown>) => Promise<unknown>;
  /** 读取文件 */
  readFile?: (path: string) => Promise<string>;
  /** 写入文件 */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** 列出目录 */
  listDir?: (path: string) => Promise<string[]>;
}

/**
 * 脚本执行沙箱中可用的 API
 */
export interface ScriptSandbox {
  /** rtcAgent 宿主 API（见 RtcAgentAPI 接口定义） */
  rtcAgent: RtcAgentAPI;
  console: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  params: Record<string, unknown>;
  // 基础类型
  Promise: PromiseConstructor;
  Date: DateConstructor;
  Math: Math;
  JSON: JSON;
  Array: ArrayConstructor;
  Object: ObjectConstructor;
  String: StringConstructor;
  Number: NumberConstructor;
  Boolean: BooleanConstructor;
  Error: ErrorConstructor;
}

/**
 * 控制台输出收集器
 */
export interface ConsoleOutput {
  logs: string[];
  warns: string[];
  errors: string[];
}

/**
 * 创建默认沙箱
 *
 * @param rtcAgent - 宿主 API
 * @param params - 脚本参数
 * @param output - 可选的输出收集器，用于捕获 console 输出
 */
export function createSandbox(
  rtcAgent: RtcAgentAPI,
  params: Record<string, unknown> = {},
  output?: ConsoleOutput
): ScriptSandbox {
  const formatArgs = (args: unknown[]): string =>
    args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

  return {
    rtcAgent,
    console: {
      log: (...args) => {
        const msg = formatArgs(args);
        console.log('[Script]', msg);
        if (output) output.logs.push(msg);
      },
      warn: (...args) => {
        const msg = formatArgs(args);
        console.warn('[Script]', msg);
        if (output) output.warns.push(msg);
      },
      error: (...args) => {
        const msg = formatArgs(args);
        console.error('[Script]', msg);
        if (output) output.errors.push(msg);
      },
    },
    params,
    Promise,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
  };
}

// ============================================================
// Babel Transform (M2, MD1, m1)
// ============================================================

/**
 * 缓存 Babel preset 对象，避免每次 transform 都重新构造 (M2)
 */
const cachedPresets = [presetTypescript] as NonNullable<TransformOptions['presets']>;

/**
 * 使用 Babel 转换 TypeScript 语法
 *
 * @param code - TypeScript 源代码
 * @param name - 脚本名称，用于错误定位 (MD1)
 * @throws ScriptCompileError 当 Babel 转换失败时
 */
export function transformTypeScript(code: string, name?: string): string {
  const filename = name ? `${name}.ts` : 'script.ts';

  let result;
  try {
    result = transformSync(code, {
      presets: cachedPresets,
      filename,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScriptCompileError(`Babel transformation failed for '${filename}': ${msg}`, name);
  }

  if (!result || !result.code) {
    throw new ScriptCompileError('Babel transformation failed: no output', name);
  }

  return result.code;
}

// ============================================================
// Script Content Parsing (M3, M4)
// ============================================================

/**
 * 解析脚本文件内容（frontmatter + 代码块）
 *
 * YAML 解析限制 (M3)：
 * - 仅支持简单的 key: value 键值对
 * - 不支持多行值、数组、嵌套对象
 * - 值两端的双引号会被自动移除
 * - 如需复杂配置，请在脚本代码内部处理
 */
export function parseScriptContent(content: string): {
  metadata: Record<string, string>;
  code: string;
} {
  // 解析 frontmatter
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error('Invalid script format: missing frontmatter');
  }

  const yamlStr = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // 解析 YAML（简化版 - 仅支持简单 key: value，不支持多行/数组/嵌套，见 M3）
  const metadata: Record<string, string> = {};
  const lines = yamlStr.split(/\r?\n/);
  for (const line of lines) {
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // 移除引号
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    if (key) {
      metadata[key] = value;
    }
  }

  // 提取所有代码块（M4：支持多个代码块，拼接所有内容）
  const codeBlockRegex = /```(?:typescript|javascript|ts|js)?\r?\n?([\s\S]*?)\r?\n?```/g;
  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(body)) !== null) {
    codeBlocks.push(match[1].trim());
  }

  if (codeBlocks.length === 0) {
    // 如果没有代码块，直接使用 body（假设是纯代码）
    return { metadata, code: body.trim() };
  }

  if (codeBlocks.length > 1) {
    console.warn(`[ScriptEngine] Found ${codeBlocks.length} code blocks in script, concatenating all.`);
  }

  const code = codeBlocks.join('\n\n');
  return { metadata, code };
}

/**
 * 生成脚本文件内容（frontmatter + 代码块）
 */
export function generateScriptContent(
  name: string,
  code: string,
  description?: string
): string {
  const now = new Date().toISOString();

  let content = '---\n';
  content += `name: "${name}"\n`;
  if (description) {
    content += `description: "${description}"\n`;
  }
  content += `createdAt: "${now}"\n`;
  content += '---\n\n';
  content += '```typescript\n';
  content += code;
  content += '\n```\n';

  return content;
}

// ============================================================
// Script Execution (B1, M1, MD5, MD6)
// ============================================================

/**
 * 执行脚本代码的核心逻辑（MD5：抽取公共逻辑）
 *
 * 超时说明 (B1)：
 * - 超时仅放弃等待（reject Promise），不会终止正在执行的脚本。
 * - 脚本仍在后台运行直至完成，但调用方会收到 ScriptTimeoutError。
 * - 如需真正终止脚本，请使用 Worker 或子进程。
 *
 * @param code - 要执行的代码（TypeScript 或 JavaScript）
 * @param sandbox - 沙箱环境
 * @param timeoutMs - 超时时间（毫秒）
 * @param scriptName - 脚本名称，用于错误定位
 */
export async function _executeCode(
  code: string,
  sandbox: ScriptSandbox,
  timeoutMs: number,
  scriptName?: string
): Promise<unknown> {
  // 转换 TypeScript 语法（传入 name 用于错误定位，MD1）
  const jsCode = transformTypeScript(code, scriptName);

  // 创建沙箱键值对
  const keys = Object.keys(sandbox);
  const values = keys.map(k => sandbox[k as keyof ScriptSandbox]);

  // 使用 Function 构造器执行
  // 包装成 async IIFE 以支持 await
  // M1: 添加 "use strict" 防止 this 逃逸到 globalThis
  const wrappedCode = `
    "use strict";
    return (async () => {
      ${jsCode}
    })();
  `;

  // 创建函数
  const fn = new Function(...keys, wrappedCode);

  // 执行并设置超时
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ScriptTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    // M1: 使用 fn.call(undefined, ...) 将 this 绑定到 undefined（严格模式下）
    const executionPromise = fn.call(undefined, ...values);
    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    // B1: 清除超时定时器，避免内存泄漏
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * 执行脚本代码（公开 API）
 *
 * 超时说明 (B1)：
 * - 超时仅放弃等待，不终止正在执行的脚本。
 * - 脚本仍在后台运行直至完成，但调用方会收到 ScriptTimeoutError。
 */
export async function executeScriptCode(
  code: string,
  sandbox: ScriptSandbox,
  timeoutMs: number = 30000
): Promise<unknown> {
  return _executeCode(code, sandbox, timeoutMs);
}

/**
 * 保存脚本到虚拟文件系统
 */
export async function saveScript(
  name: string,
  code: string,
  description?: string
): Promise<string> {
  const content = generateScriptContent(name, code, description);
  const path = `/scripts/${name}.ts`;
  await virtualFS.write(path, content, 'overwrite');
  return path;
}

/**
 * 从虚拟文件系统加载并执行脚本
 */
export async function loadAndExecuteScript(
  name: string,
  rtcAgent: RtcAgentAPI,
  params: Record<string, unknown> = {},
  timeoutMs: number = 30000
): Promise<unknown> {
  const path = `/scripts/${name}.ts`;
  const content = await virtualFS.read(path);
  const { code } = parseScriptContent(content);

  const sandbox = createSandbox(rtcAgent, params);
  return _executeCode(code, sandbox, timeoutMs, name);
}
