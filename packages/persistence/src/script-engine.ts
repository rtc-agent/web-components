/**
 * Script Engine
 *
 * Save, transform, and execute LLM-generated scripts.
 *
 * Design principles:
 * - Sandbox restricts "side effects" (storage/network/DOM) but preserves "expressiveness" (language/data structures/logic)
 * - Uses Babel AST transforms to block dangerous API access at compile time (storage, network, DOM, prototype chain escape)
 * - Uses new Function() for execution, with "use strict" + fn.call(undefined) to prevent this escape
 * - LLM creativity lives in the logic layer -- full pure-computation standard library + rtcAgent API are exposed
 */

import { transformSync } from '@babel/core';
import presetTypescript from '@babel/preset-typescript';
import type { TransformOptions } from '@babel/core';
import { virtualFS } from './virtual-fs.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('ScriptEngine');

// ============================================================
// Custom Error Classes (MD2)
// ============================================================

/**
 * ScriptTimeoutError - script execution timed out
 */
export class ScriptTimeoutError extends Error {
  readonly isScriptTimeout = true;
  constructor(timeoutMs: number) {
    super(`Script execution timeout after ${timeoutMs}ms`);
    this.name = 'ScriptTimeoutError';
  }
}

/**
 * ScriptCompileError - script compilation (Babel transform) failed
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
 * RtcAgentAPI - minimal rtcAgent interface available inside scripts.
 *
 * Defines the minimum API surface exposed by the rtcAgent object in the script sandbox.
 * The actual injected object may contain additional methods, but only the methods defined
 * in this interface can be safely used within scripts.
 */
export interface RtcAgentAPI {
  /** Call a registered function */
  callFunction?: (path: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Read a file */
  readFile?: (path: string) => Promise<string>;
  /** Write a file */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** List directory contents */
  listDir?: (path: string) => Promise<string[]>;
}

/**
 * APIs available inside the script execution sandbox.
 *
 * Sandbox strategy: expose pure-computation standard library + block side-effect APIs (storage/network/DOM).
 * LLM creativity lives in the logic layer (data processing, control flow, rtcAgent call composition) --
 * this layer is fully open.
 */
export interface ScriptSandbox {
  /** rtcAgent host API (see RtcAgentAPI interface definition) */
  rtcAgent: RtcAgentAPI;
  /** Hijacked console (output simultaneously collected to ConsoleOutput) */
  console: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** Script invocation parameters */
  params: Record<string, unknown>;

  // === Language constructors and built-in objects ===
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

  // Data structures
  Map: MapConstructor;
  Set: SetConstructor;
  WeakMap: WeakMapConstructor;
  WeakSet: WeakSetConstructor;
  RegExp: RegExpConstructor;
  Symbol: SymbolConstructor;
  BigInt: BigIntConstructor;

  // Error subclasses (structurally compatible with ErrorConstructor)
  TypeError: ErrorConstructor;
  RangeError: ErrorConstructor;
  ReferenceError: ErrorConstructor;
  SyntaxError: ErrorConstructor;
  URIError: ErrorConstructor;
  AggregateError: ErrorConstructor;

  // === Parsing and encoding functions ===
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

  // === Utility functions ===
  structuredClone: typeof structuredClone;

  // === Special values ===
  NaN: number;
  Infinity: number;
  undefined: undefined;

  // === URL parsing (pure data operations, no network) ===
  URL: typeof URL;
  URLSearchParams: typeof URLSearchParams;
}

/**
 * Console output collector.
 */
export interface ConsoleOutput {
  logs: string[];
  warns: string[];
  errors: string[];
}

/**
 * Create the default sandbox.
 *
 * Injects three categories of content:
 * 1. rtcAgent / params -- host API and invocation parameters (not global objects)
 * 2. console -- hijacked version (output simultaneously collected to ConsoleOutput)
 * 3. Pure-computation standard library -- Map/Set/RegExp/parseInt/structuredClone etc.
 *    (These already exist in the browser main thread; explicit injection makes the API
 *    surface clearly auditable)
 *
 * @param rtcAgent - Host API
 * @param params - Script parameters
 * @param output - Optional output collector for capturing console output
 */
export function createSandbox(
  rtcAgent: RtcAgentAPI,
  params: Record<string, unknown> = {},
  output?: ConsoleOutput,
  title?: string
): ScriptSandbox {
  const prefix = title ? `[Script: ${title}]` : '[Script]';
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
        console.log(prefix, msg);
        if (output) output.logs.push(msg);
      },
      warn: (...args) => {
        const msg = formatArgs(args);
        console.warn(prefix, msg);
        if (output) output.warns.push(msg);
      },
      error: (...args) => {
        const msg = formatArgs(args);
        console.error(prefix, msg);
        if (output) output.errors.push(msg);
      },
    },
    params,
    // Language constructors
    Promise, Date, Math, JSON, Array, Object, String, Number, Boolean, Error,
    // Data structures
    Map, Set, WeakMap, WeakSet, RegExp, Symbol, BigInt,
    // Error subclasses
    TypeError: TypeError as unknown as ErrorConstructor,
    RangeError: RangeError as unknown as ErrorConstructor,
    ReferenceError: ReferenceError as unknown as ErrorConstructor,
    SyntaxError: SyntaxError as unknown as ErrorConstructor,
    URIError: URIError as unknown as ErrorConstructor,
    AggregateError: AggregateError as unknown as ErrorConstructor,
    // Parsing and encoding
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    atob, btoa,
    // Utilities
    structuredClone,
    // Special values
    NaN, Infinity, undefined,
    // URL
    URL, URLSearchParams,
  };
}

// ============================================================
// Babel Transform -- Sandbox Plugin (MD2, security hardening)
// ============================================================

/**
 * Cached Babel preset to avoid reconstructing on every transform (M2).
 */
const cachedPresets = [presetTypescript] as NonNullable<TransformOptions['presets']>;

/**
 * Global identifiers blocked from direct script access (side-effect APIs).
 *
 * Sandbox strategy: restrict "side effects" (storage/network/DOM), not "expressiveness"
 * (language/data structures/logic). Script creativity should focus on the logic layer --
 * data processing, control flow, rtcAgent call composition. Platform APIs should be
 * accessed indirectly via rtcAgent.callFunction.
 *
 * Blocked global identifiers by category:
 */
const BLOCKED_GLOBALS: ReadonlySet<string> = new Set([
  // Storage APIs -- scripts should use rtcAgent.readFile/writeFile for file access
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore',
  // Network APIs -- scripts should use rtcAgent.callFunction for external services
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'BroadcastChannel',
  // DOM / browser environment -- scripts should use rtcAgent for UI manipulation
  'window', 'self', 'document', 'navigator', 'location', 'history',
  'screen', 'alert', 'confirm', 'prompt', 'open', 'close', 'print',
  'postMessage', 'frames', 'parent', 'top', 'opener',
  // Metaprogramming / escape -- prevent sandbox breakout
  'eval', 'Function', 'globalThis', 'global',
  // Worker -- prevent creating new execution contexts
  'Worker', 'SharedWorker', 'ServiceWorker', 'importScripts',
  // Timers -- prevent escaping timeout control (should use rtcAgent.delay wrappers)
  'setTimeout', 'setInterval',
  // Shared memory
  'SharedArrayBuffer', 'Atomics',
  // Node.js compatibility -- prevent bundler-injected CJS globals
  'require', 'module', 'exports', '__dirname', '__filename',
]);

/**
 * Property names blocked from MemberExpression access.
 *
 * Prevents prototype chain escape:
 * - `x.constructor.constructor('return this')()`
 * - `x.__proto__`
 */
const BLOCKED_MEMBER_PROPERTIES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
]);

/**
 * Sandbox security plugin.
 *
 * Statically blocks the following categories of syntax at Babel transform time:
 *
 * 1. Dangerous global identifiers (BLOCKED_GLOBALS)
 *    - Blocks direct access to side-effect APIs (storage/network/DOM/metaprogramming)
 *    - If the identifier has a local binding (variable declaration/function parameter), it is allowed
 *    - TypeScript type positions are skipped (type annotations are not value references)
 *
 * 2. Prototype chain escape properties (BLOCKED_MEMBER_PROPERTIES)
 *    - Blocks `.constructor` / `.__proto__` access (including string-indexed form `['constructor']`)
 *
 * 3. Dynamic import()
 *    - Blocks `import(...)` syntax to prevent loading remote code
 *
 * 4. Dangerous loop constructs (original loopGuardPlugin logic)
 *    - `while` / `do...while` / `for(;;)` -- no foreseeable termination condition
 *    - Allowed: `for...of` / `for...in` / bounded `for` / Array iteration methods
 */
const sandboxPlugin = {
  visitor: {
    // 1. Block dangerous global identifiers
    Identifier(path: {
      isReferencedIdentifier: () => boolean;
      node: { name: string };
      parent: { type: string };
      scope: { hasBinding: (name: string, opts?: { noGlobals?: boolean }) => boolean };
      buildCodeFrameError: (msg: string) => Error;
    }) {
      if (!path.isReferencedIdentifier()) return;

      const name = path.node.name;
      if (!BLOCKED_GLOBALS.has(name)) return;

      // Has local binding (variable declaration / function parameter etc.) -- allow
      // Use { noGlobals: true } to exclude built-in globals like `eval`, `Function`, etc.
      if (path.scope.hasBinding(name, { noGlobals: true })) return;

      // Skip TypeScript type positions (type annotations are not value references)
      if (path.parent.type.startsWith('TS')) return;

      throw path.buildCodeFrameError(
        `Access to global '${name}' is not allowed. Use rtcAgent APIs instead.`,
      );
    },

    // 2. Block prototype chain escape
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

    // 3. Block dynamic import()
    // Note: Babel may parse import() as ImportExpression or as CallExpression
    // with callee.type === 'Import', depending on parser configuration.
    ImportExpression(path: {
      buildCodeFrameError: (msg: string) => Error;
    }) {
      throw path.buildCodeFrameError(
        'Dynamic import() is not allowed in scripts.',
      );
    },
    CallExpression(path: {
      node: { callee: { type: string } };
      buildCodeFrameError: (msg: string) => Error;
    }) {
      if (path.node.callee.type === 'Import') {
        throw path.buildCodeFrameError(
          'Dynamic import() is not allowed in scripts.',
        );
      }
    },

    // 4. Loop guard
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
      // Only intercept for(;;): test === null means no termination condition
      if (path.node.test === null) {
        throw path.buildCodeFrameError(
          '`for(;;)` infinite loops are not allowed. Use a bounded `for` loop or `for...of` instead.',
        );
      }
    },
  },
};

/**
 * Transform TypeScript syntax using Babel and apply sandbox security checks.
 *
 * Transform pipeline:
 * 1. TypeScript type erasure (preset-typescript)
 * 2. Sandbox security plugin (blocks dangerous APIs, prototype chain escape, dynamic import, infinite loops)
 *
 * @param code - TypeScript source code
 * @param name - Script name for error location reporting (MD1)
 * @throws ScriptCompileError when Babel transform fails or detects dangerous syntax/API access
 */
export function transformTypeScript(code: string, name?: string): string {
  const filename = name ? `${name}.ts` : 'script.ts';

  let result;
  try {
    result = transformSync(code, {
      presets: cachedPresets,
      filename,
      plugins: [sandboxPlugin],
      // Allow top-level `return` so scripts can produce values.
      // The transformed code is later wrapped in an async IIFE by _executeCode,
      // where the `return` becomes a valid return inside the arrow function.
      parserOpts: {
        allowReturnOutsideFunction: true,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScriptCompileError(`Babel transformation failed for '${filename}': ${msg}`, name);
  }

  if (!result) {
    throw new ScriptCompileError('Babel transformation failed: no output', name);
  }

  // Empty code produces empty output -- this is valid (no-op script)
  return result.code ?? '';
}

// ============================================================
// Script Content Parsing (M3, M4)
// ============================================================

/**
 * Parse script file content (frontmatter + code blocks).
 *
 * YAML parsing limitations (M3):
 * - Only supports simple key: value pairs
 * - Does not support multi-line values, arrays, or nested objects
 * - Surrounding double quotes on values are automatically removed
 * - For complex configuration, handle it within the script code itself
 */
export function parseScriptContent(content: string): {
  metadata: Record<string, string>;
  code: string;
} {
  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error('Invalid script format: missing frontmatter');
  }

  const yamlStr = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // Parse YAML (simplified -- only simple key: value, no multi-line/array/nesting; see M3)
  const metadata: Record<string, string> = {};
  const lines = yamlStr.split(/\r?\n/);
  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Strip quotes
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    if (key) {
      metadata[key] = value;
    }
  }

  // Extract all code blocks (M4: support multiple blocks, concatenate all content)
  const codeBlockRegex = /```(?:typescript|javascript|ts|js)?\r?\n?([\s\S]*?)\r?\n?```/g;
  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(body)) !== null) {
    codeBlocks.push(match[1].trim());
  }

  if (codeBlocks.length === 0) {
    // No code blocks found: use body directly (assumed to be pure code)
    return { metadata, code: body.trim() };
  }

  if (codeBlocks.length > 1) {
    log.warn(`Found ${codeBlocks.length} code blocks in script, concatenating all.`);
  }

  const code = codeBlocks.join('\n\n');
  return { metadata, code };
}

/**
 * Generate script file content (frontmatter + code block).
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
 * Core logic for executing script code (MD5: extracted common logic).
 *
 * Timeout behavior (B1):
 * - Timeout only abandons the wait (rejects the Promise); the running script is not terminated.
 * - The script continues running in the background until completion, but the caller receives
 *   a ScriptTimeoutError.
 * - To truly terminate a script, use a Worker or child process.
 *
 * @param code - Code to execute (TypeScript or JavaScript)
 * @param sandbox - Sandbox environment
 * @param timeoutMs - Timeout in milliseconds
 * @param scriptName - Script name for error location reporting
 */
export async function _executeCode(
  code: string,
  sandbox: ScriptSandbox,
  timeoutMs: number,
  scriptName?: string
): Promise<unknown> {
  // Transform TypeScript syntax (pass name for error location, MD1)
  const jsCode = transformTypeScript(code, scriptName);

  // Create sandbox key-value pairs
  const keys = Object.keys(sandbox);
  const values = keys.map(k => sandbox[k as keyof ScriptSandbox]);

  // Use Function constructor for execution
  // Wrap in async IIFE to support await
  // M1: Add "use strict" to prevent this escape to globalThis
  const wrappedCode = `
    "use strict";
    return (async () => {
      ${jsCode}
    })();
  `;

  // Create function
  const fn = new Function(...keys, wrappedCode);

  // Execute with timeout
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ScriptTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    // M1: Use fn.call(undefined, ...) to bind this to undefined (strict mode)
    const executionPromise = fn.call(undefined, ...values);
    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    // B1: Clear timeout timer to avoid memory leaks
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Execute script code (public API).
 *
 * Timeout behavior (B1):
 * - Timeout only abandons the wait, does not terminate the running script.
 * - The script continues running in the background until completion, but the caller
 *   receives a ScriptTimeoutError.
 */
export async function executeScriptCode(
  code: string,
  sandbox: ScriptSandbox,
  timeoutMs: number = 30000
): Promise<unknown> {
  return _executeCode(code, sandbox, timeoutMs);
}

/**
 * Save a script to the virtual file system.
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
 * Load and execute a script from the virtual file system.
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
