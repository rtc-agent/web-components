/**
 * 内置 system 工具组
 *
 * 默认注册到每个 FunctionRegistry，提供脚本常用的系统级工具函数。
 * 这些函数包装了被沙箱阻断的灰色 API（setTimeout、crypto.randomUUID 等），
 * 通过 rtcAgent.system.* 暴露给脚本，使 LLM 无需直接访问平台 API。
 *
 * 注册方式：遵循标准 FunctionDef 规范，自动生成虚拟文档（/functions/system/*.md）
 * LLM 通过 /AGENT.md → /functions/INDEX.md 发现这些函数。
 *
 * 注意：此文件演示了 Zod schema 注册方式（推荐），同时也兼容 OpenAPI Schema 方式。
 */

import type { FunctionDef } from '../types/skill.js';
import type { FunctionRegistry } from './function-registry.js';
import { z, withMeta } from '../validation/index.js';

/**
 * system 组定义
 */
export const SYSTEM_GROUP_DEF = {
  name: 'system',
  description: 'System utilities — delay, UUID, timestamp, random, formatted time. These wrap platform APIs that are blocked in the script sandbox.',
};

/**
 * 注册内置 system 工具组到 registry
 *
 * 使用标准 createGroup + group.register 流程，自动生成虚拟文档。
 * 应在 defineRegistry() 中自动调用，使所有 registry 默认拥有 system 组。
 */
export function registerBuiltinSystemGroup(registry: FunctionRegistry): void {
  // 如果 system 组已存在（如重复调用），跳过
  if (registry.listGroups().some(g => g.name === 'system')) return;

  const group = registry.createGroup(SYSTEM_GROUP_DEF);
  for (const fn of SYSTEM_FUNCTIONS) {
    group.register(fn);
  }
}

/**
 * system.delay(ms) — Promise-based sleep
 *
 * 包装 setTimeout，受脚本超时控制（Promise.race 会在脚本超时时 reject）。
 *
 * 使用 Zod schema 定义参数（推荐方式）
 */
export const DELAY_DEF: FunctionDef = {
  name: 'delay',
  description: 'Pause execution for a specified duration. Returns a promise that resolves after the delay.',
  zodSchema: z.object({
    ms: z.number().int().min(0).max(60000).describe('Delay duration in milliseconds (0–60000)'),
  }),
  returns: {
    schema: {
      type: 'object',
      properties: {
        completed: { type: 'boolean', description: 'Always true when delay finishes' },
        elapsed: { type: 'integer', description: 'Actual elapsed time in milliseconds' },
      },
    },
    description: 'Object with completion status and actual elapsed time',
  },
  handler: (params) => {
    const ms = Math.min(Math.max(Number(params.ms) || 0, 0), 60000);
    const start = Date.now();
    return new Promise<{ completed: boolean; elapsed: number }>((resolve) => {
      setTimeout(() => {
        resolve({ completed: true, elapsed: Date.now() - start });
      }, ms);
    });
  },
};

/**
 * system.uuid() — Generate UUID v4
 *
 * 使用 crypto.randomUUID()（现代浏览器均支持）。
 *
 * 使用 Zod schema 定义参数（推荐方式）
 */
export const UUID_DEF: FunctionDef = {
  name: 'uuid',
  description: 'Generate a random UUID v4 string.',
  zodSchema: z.object({
    count: z.number().int().min(1).max(100).default(1).describe('Number of UUIDs to generate (1–100). If omitted, returns a single string.'),
  }),
  returns: {
    schema: {
      type: 'string',
      format: 'uuid',
      description: 'A single UUID v4 string. If count > 1, returns an array of UUID strings instead.',
    },
    description: 'UUID v4 string (or array of strings when count > 1)',
  },
  handler: (params) => {
    const count = Math.min(Math.max(Number(params.count) || 1, 1), 100);
    if (count === 1) {
      return crypto.randomUUID();
    }
    return Array.from({ length: count }, () => crypto.randomUUID());
  },
};

/**
 * system.now() — Current timestamp
 */
export const NOW_DEF: FunctionDef = {
  name: 'now',
  description: 'Get the current timestamp in milliseconds since Unix epoch.',
  returns: {
    schema: {
      type: 'integer',
      description: 'Milliseconds since 1970-01-01T00:00:00Z',
    },
    description: 'Current timestamp in milliseconds',
  },
  handler: () => Date.now(),
};

/**
 * system.random(options?) — Random number generation
 *
 * 使用 Zod schema 定义参数（推荐方式）
 * 使用 withMeta 添加示例值
 */
export const RANDOM_DEF: FunctionDef = {
  name: 'random',
  description: 'Generate a random number within a range. Can produce integers or floating-point values.',
  zodSchema: z.object({
    min: withMeta(z.number().default(0), { example: 1 }).describe('Minimum value (inclusive)'),
    max: withMeta(z.number().default(1), { example: 100 }).describe('Maximum value (inclusive for integers, exclusive for floats)'),
    integer: withMeta(z.boolean().default(false), { example: true }).describe('If true, generate an integer; otherwise generate a float'),
  }),
  returns: {
    schema: { type: 'number', description: 'Random number in [min, max]' },
    description: 'Random number',
  },
  handler: (params) => {
    const min = Number(params.min) ?? 0;
    const max = Number(params.max) ?? 1;
    const integer = Boolean(params.integer);

    if (integer) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }
    return Math.random() * (max - min) + min;
  },
};

/**
 * system.time(format?) — Formatted current time
 *
 * 使用 Zod schema 定义参数（推荐方式）
 */
export const TIME_DEF: FunctionDef = {
  name: 'time',
  description: 'Get the current time as a formatted string.',
  zodSchema: z.object({
    format: z.enum(['iso', 'locale', 'timestamp']).default('iso').describe('Output format'),
  }),
  returns: {
    schema: { type: 'string', description: 'Formatted time string' },
    description: 'Current time as a string',
  },
  handler: (params) => {
    const format = (params.format as string) || 'iso';
    const now = new Date();
    switch (format) {
      case 'locale':
        return now.toLocaleString();
      case 'timestamp':
        return String(Date.now());
      case 'iso':
      default:
        return now.toISOString();
    }
  },
};

/**
 * 所有内置 system 函数定义
 */
export const SYSTEM_FUNCTIONS: FunctionDef[] = [
  DELAY_DEF,
  UUID_DEF,
  NOW_DEF,
  RANDOM_DEF,
  TIME_DEF,
];
