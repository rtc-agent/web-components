/**
 * Script Engine
 *
 * 脚本执行引擎：保存、转换、执行 LLM 生成的脚本
 *
 * 设计原则：
 * - 沙箱限制"副作用"（存储/网络/DOM），不限制"表达力"（语言/数据结构/逻辑）
 * - 使用 Babel AST 转换在编译期阻断危险 API 访问（存储、网络、DOM、原型链逃逸）
 * - 使用 new Function() 执行，配合 "use strict" + fn.call(undefined) 防止 this 逃逸
 * - LLM 的创造力在逻辑层——开放完整的纯计算标准库 + rtcAgent API
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
 *
 * 沙箱策略：开放纯计算标准库 + 阻断副作用 API（存储/网络/DOM）
 * LLM 的创造力在逻辑层（数据处理、控制流、rtcAgent 调用组合），这一层完全敞开。
 */
export interface ScriptSandbox {
  /** rtcAgent 宿主 API（见 RtcAgentAPI 接口定义） */
  rtcAgent: RtcAgentAPI;
  /** 劫持的 console（输出同时收集到 ConsoleOutput） */
  console: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** 脚本调用参数 */
  params: Record<string, unknown>;

  // === 语言构造器与内置对象 ===
  Promise: PromiseConstructor;
  Date: DateConstructor;
  Math: typeof Math;
  JSON: typeof JSON;
  Array: ArrayConstructor;
  Object: ObjectConstructor;
  String: StringConstructor;
  Number: NumberConstructor;
  Boolean: BooleanConstructor;
  Error: ErrorConstructor;

  // 数据结构
  Map: MapConstructor;
  Set: SetConstructor;
  WeakMap: WeakMapConstructor;
  WeakSet: WeakSetConstructor;
  RegExp: RegExpConstructor;
  Symbol: SymbolConstructor;
  BigInt: BigIntConstructor;

  // Error 子类（结构兼容 ErrorConstructor）
  TypeError: ErrorConstructor;
  RangeError: ErrorConstructor;
  ReferenceError: ErrorConstructor;
  SyntaxError: ErrorConstructor;
  URIError: ErrorConstructor;
  AggregateError: ErrorConstructor;

  // === 解析与编码函数 ===
  parseInt: typeof parseInt;
  parseFloat: typeof parseFloat;
  isNaN: typeof isNaN;
  isFinite: typeof isFinite;
  encodeURIComponent: typeof encodeURIComponent;
  decodeURIComponent: typeof decodeURIComponent;
  encodeURI: typeof encodeURI;
  decodeURI: typeof decodeURI;
  atob: typeof atob;
  btoa: typeof btoa;

  // === 工具函数 ===
  structuredClone: typeof structuredClone;

  // === 特殊值 ===
  NaN: number;
  Infinity: number;
  undefined: undefined;

  // === URL 解析（纯数据操作，无网络） ===
  URL: typeof URL;
  URLSearchParams: typeof URLSearchParams;
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
 * 注入三类内容：
 * 1. rtcAgent / params — 宿主 API 与调用参数（非全局对象）
 * 2. console — 劫持版（输出同时收集到 ConsoleOutput）
 * 3. 纯计算标准库 — Map/Set/RegExp/parseInt/structuredClone 等
 *    （这些在浏览器主线程已存在，显式注入使 API 表面清晰可审计）
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
    // 语言构造器
    Promise, Date, Math, JSON, Array, Object, String, Number, Boolean, Error,
    // 数据结构
    Map, Set, WeakMap, WeakSet, RegExp, Symbol, BigInt,
    // Error 子类
    TypeError: TypeError as unknown as ErrorConstructor,
    RangeError: RangeError as unknown as ErrorConstructor,
    ReferenceError: ReferenceError as unknown as ErrorConstructor,
    SyntaxError: SyntaxError as unknown as ErrorConstructor,
    URIError: URIError as unknown as ErrorConstructor,
    AggregateError: AggregateError as unknown as ErrorConstructor,
    // 解析与编码
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    atob, btoa,
    // 工具
    structuredClone,
    // 特殊值
    NaN, Infinity, undefined,
    // URL
    URL, URLSearchParams,
  };
}

// ============================================================
// Babel Transform — Sandbox Plugin (MD2, 安全加固)
// ============================================================

/**
 * 缓存 Babel preset 对象，避免每次 transform 都重新构造 (M2)
 */
const cachedPresets = [presetTypescript] as NonNullable<TransformOptions['presets']>;

/**
 * 禁止在脚本中直接访问的全局标识符（副作用 API）
 *
 * 沙箱策略：限制"副作用"（存储/网络/DOM），不限制"表达力"（语言/数据结构/逻辑）。
 * 脚本的创造力应在逻辑层——数据处理、控制流、rtcAgent 调用组合。
 * 平台 API 应通过 rtcAgent.callFunction 间接访问。
 *
 * 以下分类列出被阻断的全局标识符：
 */
const BLOCKED_GLOBALS: ReadonlySet<string> = new Set([
  // 存储 API — 脚本应通过 rtcAgent.readFile/writeFile 访问文件
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore',
  // 网络 API — 脚本应通过 rtcAgent.callFunction 调用外部服务
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel',
  // DOM / 浏览器环境 — 脚本应通过 rtcAgent 操作 UI
  'window', 'self', 'document', 'navigator', 'location', 'history',
  'screen', 'alert', 'confirm', 'prompt', 'open', 'close', 'print',
  'postMessage', 'frames', 'parent', 'top', 'opener',
  // 元编程 / 逃逸 — 防止突破沙箱
  'eval', 'Function', 'globalThis', 'global',
  // Worker — 防止创建新的执行上下文
  'Worker', 'SharedWorker', 'ServiceWorker', 'importScripts',
  // 定时器 — 防止逃逸超时控制（应使用 rtcAgent.delay 等包装版本）
  'setTimeout', 'setInterval',
  // 共享内存
  'SharedArrayBuffer', 'Atomics',
  // Node.js 兼容 — 防止 bundler 注入的 CJS 全局
  'require', 'module', 'exports', '__dirname', '__filename',
]);

/**
 * 禁止通过 MemberExpression 访问的属性名
 *
 * 防止原型链逃逸：
 * - `x.constructor.constructor('return this')()`
 * - `x.__proto__`
 */
const BLOCKED_MEMBER_PROPERTIES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
]);

/**
 * 沙箱安全插件
 *
 * 在 Babel 转换阶段静态阻断以下类别的语法：
 *
 * 1. 危险全局标识符（BLOCKED_GLOBALS）
 *    - 阻断对存储/网络/DOM/元编程等副作用 API 的直接访问
 *    - 如果标识符有本地绑定（变量声明/函数参数），允许（用户自己声明的同名变量）
 *    - 跳过 TypeScript 类型位置（type annotation 不触发阻断）
 *
 * 2. 原型链逃逸属性（BLOCKED_MEMBER_PROPERTIES）
 *    - 阻断 `.constructor` / `.__proto__` 访问（包括字符串索引形式 `['constructor']`）
 *
 * 3. 动态 import()
 *    - 阻断 `import(...)` 语法，防止加载远程代码
 *
 * 4. 危险循环语法（原有 loopGuardPlugin 逻辑）
 *    - `while` / `do...while` / `for(;;)` — 没有可预见的终止条件
 *    - 允许：`for...of` / `for...in` / 有界 `for` / Array 迭代方法
 */
const sandboxPlugin = {
  visitor: {
    // 1. 阻断危险全局标识符
    Identifier(path: {
      isReferencedIdentifier: () => boolean;
      node: { name: string };
      parent: { type: string };
      scope: { hasBinding: (name: string) => boolean };
      buildCodeFrameError: (msg: string) => Error;
    }) {
      if (!path.isReferencedIdentifier()) return;

      const name = path.node.name;
      if (!BLOCKED_GLOBALS.has(name)) return;

      // 有本地绑定（变量声明/函数参数等），允许
      if (path.scope.hasBinding(name)) return;

      // 跳过 TypeScript 类型位置（type annotation 不是值引用）
      if (path.parent.type.startsWith('TS')) return;

      throw path.buildCodeFrameError(
        `Access to global '${name}' is not allowed. Use rtcAgent APIs instead.`,
      );
    },

    // 2. 阻断原型链逃逸
    MemberExpression(path: {
      node: { property: { type: string; name?: string; value?: string }; computed: boolean };
      buildCodeFrameError: (msg: string) => Error;
    }) {
      const { property, computed } = path.node;

      let propName: string | undefined;
      if (!computed && property.type === 'Identifier') {
        propName = property.name;
      } else if (computed && property.type === 'StringLiteral') {
        propName = property.value;
      }

      if (propName && BLOCKED_MEMBER_PROPERTIES.has(propName)) {
        throw path.buildCodeFrameError(
          `Access to '.${propName}' is not allowed (prototype chain escape prevention).`,
        );
      }
    },

    // 3. 阻断动态 import()
    ImportExpression(path: {
      buildCodeFrameError: (msg: string) => Error;
    }) {
      throw path.buildCodeFrameError(
        'Dynamic import() is not allowed in scripts.',
      );
    },

    // 4. 循环守卫
    WhileStatement(path: { buildCodeFrameError: (msg: string) => Error }) {
      throw path.buildCodeFrameError(
        '`while` loops are not allowed. Use `for...of` or Array iteration methods (forEach/map/filter/reduce) instead.',
      );
    },
    DoWhileStatement(path: { buildCodeFrameError: (msg: string) => Error }) {
      throw path.buildCodeFrameError(
        '`do...while` loops are not allowed. Use `for...of` or Array iteration methods instead.',
      );
    },
    ForStatement(path: { node: { test: unknown }; buildCodeFrameError: (msg: string) => Error }) {
      // 仅拦截 for(;;)：test 为 null 表示没有终止条件
      if (path.node.test === null) {
        throw path.buildCodeFrameError(
          '`for(;;)` infinite loops are not allowed. Use a bounded `for` loop or `for...of` instead.',
        );
      }
    },
  },
};

/**
 * 使用 Babel 转换 TypeScript 语法并应用沙箱安全检查
 *
 * 转换流程：
 * 1. TypeScript 类型擦除（preset-typescript）
 * 2. 沙箱安全插件（阻断危险 API、原型链逃逸、动态 import、无限循环）
 *
 * @param code - TypeScript 源代码
 * @param name - 脚本名称，用于错误定位 (MD1)
 * @throws ScriptCompileError 当 Babel 转换失败或检测到危险语法/API 访问时
 */
export function transformTypeScript(code: string, name?: string): string {
  const filename = name ? `${name}.ts` : 'script.ts';

  let result;
  try {
    result = transformSync(code, {
      presets: cachedPresets,
      filename,
      plugins: [sandboxPlugin],
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
