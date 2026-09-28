/**
 * Built-in system tool group
 *
 * Registered by default to every FunctionRegistry, providing commonly used system-level utility functions for scripts.
 * These functions wrap gray-area APIs blocked by the sandbox (setTimeout, crypto.randomUUID, etc.),
 * exposing them to scripts via rtcAgent.system.* so the LLM doesn't need direct access to platform APIs.
 *
 * Registration: follows the standard FunctionDef specification and auto-generates virtual docs (/functions/system/*.md)
 * The LLM discovers these functions via /AGENT.md -> /functions/INDEX.md.
 *
 * Note: This file demonstrates Zod schema registration (recommended), while remaining compatible with OpenAPI Schema.
 */

import type { FunctionDef } from '../types/skill.js';
import type { FunctionRegistry } from './function-registry.js';
import { z, withMeta } from '../validation/index.js';

/**
 * system group definition
 */
export const SYSTEM_GROUP_DEF = {
  name: 'system',
  description: 'System utilities — delay, UUID, timestamp, random, formatted time. These wrap platform APIs that are blocked in the script sandbox.',
};

/**
 * Register the built-in system tool group to the registry
 *
 * Uses the standard createGroup + group.register flow to auto-generate virtual docs.
 * Should be called automatically in defineRegistry() so all registries have the system group by default.
 */
export function registerBuiltinSystemGroup(registry: FunctionRegistry): void {
  // If system group already exists (e.g. duplicate call), skip
  if (registry.listGroups().some(g => g.name === 'system')) return;

  const group = registry.createGroup(SYSTEM_GROUP_DEF);
  for (const fn of SYSTEM_FUNCTIONS) {
    group.register(fn);
  }
}

/**
 * system.delay(ms) — Promise-based sleep
 *
 * Wraps setTimeout, subject to script timeout control (Promise.race rejects on script timeout).
 *
 * Uses Zod schema for parameter definition (recommended)
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
 * Uses crypto.randomUUID() (supported by all modern browsers).
 *
 * Uses Zod schema for parameter definition (recommended)
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
 * Uses Zod schema for parameter definition (recommended)
 * Uses withMeta to add example values
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
 * Uses Zod schema for parameter definition (recommended)
 */
export const TIME_DEF: FunctionDef = {
  name: 'time',
  description: 'Get the current time as a formatted string.',
  zodSchema: z.object({
    format: z.enum(['iso', 'locale', 'timestamp']).default('locale').describe('Output format'),
  }),
  returns: {
    schema: { type: 'string', description: 'Formatted time string' },
    description: 'Current time as a string',
  },
  handler: (params) => {
    const format = (params.format as string) || 'locale';
    const now = new Date();
    switch (format) {
      case 'iso':
        return now.toISOString();
      case 'timestamp':
        return String(Date.now());
      case 'locale':
      default:
        return now.toLocaleString();
    }
  },
};

/**
 * system.timezone() — Get local timezone information
 *
 * Returns the local timezone's IANA name (e.g. 'Asia/Shanghai') and current UTC offset.
 * Uses Intl.DateTimeFormat API, no third-party library needed.
 */
export const TIMEZONE_DEF: FunctionDef = {
  name: 'timezone',
  description: 'Get the local timezone information, including the IANA timezone name and current UTC offset.',
  returns: {
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'IANA timezone name, e.g. "Asia/Shanghai"' },
        offset: { type: 'string', description: 'UTC offset string, e.g. "+08:00"' },
      },
    },
    description: 'Timezone name and UTC offset',
  },
  handler: () => {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMinutes = -(new Date().getTimezoneOffset());
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const pad = (n: number) => String(n).padStart(2, '0');
    const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    return { name, offset };
  },
};

/**
 * All built-in system function definitions
 */
export const SYSTEM_FUNCTIONS: FunctionDef[] = [
  DELAY_DEF,
  UUID_DEF,
  NOW_DEF,
  RANDOM_DEF,
  TIME_DEF,
  TIMEZONE_DEF,
];
