/**
 * Zod Schema → OpenAPI Schema 转换
 *
 * 将 Zod schema 转换为 OpenAPI Schema 格式，用于生成 Agent 文档
 *
 * 迁移自 peep/src/lib/rtc-agent-validation.ts
 *
 * 支持的 Zod 功能：
 * - .describe() → description（参数描述）
 * - .optional() → required: false
 * - .default() → default + required: false
 * - .min()/.max() → minimum/maximum
 * - .minLength()/.maxLength() → minLength/maxLength
 * - .regex() → pattern
 * - .enum() → enum
 * - z.array() → array + items
 *
 * 扩展功能（通过 meta 方法）：
 * - .meta({ example: ... }) → example（示例值）
 */

import type { ZodType } from 'zod';
import type { OpenAPISchema, ParameterDef } from '../types/skill.js';

/**
 * Zod metadata 扩展接口
 *
 * 用于存储示例值等 OpenAPI 特有信息
 */
interface ZodMeta {
  example?: unknown;
  examples?: unknown[];
  format?: string;
}

/**
 * 从 Zod schema 生成 OpenAPI parameters
 *
 * @param shape ZodObject schema
 * @param descriptions 可选的参数描述覆盖
 */
export function zodToParams<T extends ZodType>(
  shape: T,
  descriptions?: Record<string, string>
): ParameterDef[] {
  const params: ParameterDef[] = [];
  let obj = shape as any;

  // 解包 ZodOptional/ZodDefault，获取内部的 ZodObject
  // 处理 z.object({...}).optional() 的情况
  while (obj?._def) {
    const typeIdentifier = obj._def.typeName || obj._def.type;
    if (typeIdentifier === 'ZodOptional' || typeIdentifier === 'optional' ||
        typeIdentifier === 'ZodDefault' || typeIdentifier === 'default') {
      obj = obj._def.innerType;
    } else {
      break;
    }
  }

  // 兼容 Zod v3 和 v4 的结构差异
  // Zod v3: _def.typeName === 'ZodObject', _def.shape 是函数
  // Zod v4: _def.typeName 是 undefined, _def.shape 是对象
  const isZodObject = obj?._def && (
    obj._def.typeName === 'ZodObject' ||  // v3
    (obj._def.shape !== undefined && typeof obj._def.shape === 'object' && !Array.isArray(obj._def.shape))  // v4
  );

  if (!obj || !obj._def || !isZodObject) {
    throw new Error('zodToParams expects a ZodObject schema (got: ' + (obj?._def?.typeName || obj?._def?.type || 'unknown') + ')');
  }

  // 获取 shape：v3 是函数调用，v4 是直接对象
  const shapeEntries = typeof obj._def.shape === 'function'
    ? obj._def.shape()
    : obj._def.shape;

  for (const [name, fieldSchema] of Object.entries(shapeEntries)) {
    const openAPISchema = zodFieldToOpenAPI(fieldSchema as ZodType);
    const { isOptional, description, example } = extractFieldInfo(fieldSchema as ZodType);

    params.push({
      name,
      schema: {
        ...openAPISchema,
        description: descriptions?.[name] || description || openAPISchema.description,
        ...(example !== undefined ? { example } : {}),
      },
      required: !isOptional,
      description: descriptions?.[name] || description,
    });
  }

  return params;
}

/**
 * 提取字段的元信息（可选性、描述、示例）
 * 兼容 Zod v3 和 v4
 */
function extractFieldInfo(schema: ZodType): {
  isOptional: boolean;
  description?: string;
  example?: unknown;
} {
  const def = (schema as any)._def;
  if (!def) return { isOptional: false };

  let isOptional = false;
  let description: string | undefined;
  let example: unknown;

  // 获取类型标识（兼容 v3 的 typeName 和 v4 的 type）
  const typeIdentifier = def.typeName || def.type;

  // 递归处理包装类型（optional/default）
  // v3: typeName === 'ZodOptional'/'ZodDefault', innerType
  // v4: type === 'optional'/'default', innerType
  if (typeIdentifier === 'ZodOptional' || typeIdentifier === 'optional' ||
      typeIdentifier === 'ZodDefault' || typeIdentifier === 'default') {
    isOptional = true;
    if (def.innerType) {
      const inner = extractFieldInfo(def.innerType);
      description = inner.description;
      example = inner.example;
    }
  }

  // 读取描述
  // v3: def.description
  // v4: schema.description (顶层属性，不在 _def 里)
  if (def.description) {
    description = def.description;
  } else if ((schema as any).description) {
    description = (schema as any).description;
  }

  // 读取 metadata（示例值）- v3 使用 def.meta
  const meta = def.meta as ZodMeta | undefined;
  if (meta?.example !== undefined) {
    example = meta.example;
  } else if (meta?.examples && meta.examples.length > 0) {
    example = meta.examples[0];
  }

  // v4: 检查 _zod.bag（zod v4 的 metadata 存储位置）
  const zodBag = (schema as any)._zod?.bag as ZodMeta | undefined;
  if (example === undefined && zodBag?.example !== undefined) {
    example = zodBag.example;
  } else if (example === undefined && zodBag?.examples && zodBag.examples.length > 0) {
    example = zodBag.examples[0];
  }

  // 从 enum 自动生成示例
  // v3: typeName === 'ZodEnum', values
  // v4: type === 'enum', values
  if (example === undefined && (typeIdentifier === 'ZodEnum' || typeIdentifier === 'enum') && def.values?.length > 0) {
    example = def.values[0];
  }

  // 从 default 生成示例
  if (example === undefined && (typeIdentifier === 'ZodDefault' || typeIdentifier === 'default') && typeof def.defaultValue === 'function') {
    try {
      example = def.defaultValue();
    } catch {
      // 忽略
    }
  }

  return { isOptional, description, example };
}

/**
 * 单个 Zod 字段转 OpenAPI schema
 * 兼容 Zod v3 和 v4
 */
function zodFieldToOpenAPI(schema: ZodType): OpenAPISchema {
  const def = (schema as any)._def;

  if (!def) return {};

  // 读取 metadata 中的 format
  const meta = def.meta as ZodMeta | undefined;
  const format = meta?.format;

  // 获取类型标识（兼容 v3 的 typeName 和 v4 的 type）
  const typeIdentifier = def.typeName || def.type;

  switch (typeIdentifier) {
    case 'ZodString':
    case 'string': {
      const result: OpenAPISchema = { type: 'string' };
      if (def.checks) {
        for (const check of def.checks) {
          // v3: check.kind, check.value
          // v4: check.def.check, check.def.value
          const checkDef = check.def || check;
          const kind = check.kind || checkDef.check;
          const value = check.value ?? checkDef.value;

          if (kind === 'min' || kind === 'minLength') result.minLength = value;
          if (kind === 'max' || kind === 'maxLength') result.maxLength = value;
          if (kind === 'regex') {
            const regex = check.regex || checkDef.regex;
            if (regex) result.pattern = regex.source || regex;
          }
        }
      }
      if (format) result.format = format;
      return result;
    }

    case 'ZodNumber':
    case 'number': {
      const result: OpenAPISchema = { type: 'number' };
      let isInteger = false;
      if (def.checks) {
        for (const check of def.checks) {
          const checkDef = check.def || check;
          const kind = check.kind || checkDef.check;
          const value = check.value ?? checkDef.value;

          if (kind === 'min') result.minimum = value;
          if (kind === 'max') result.maximum = value;
          if (kind === 'int' || checkDef.type === 'number' && checkDef.format === 'safeint') {
            isInteger = true;
          }
        }
      }
      if (isInteger) result.type = 'integer';
      if (format) result.format = format;
      return result;
    }

    case 'ZodBoolean':
    case 'boolean':
      return { type: 'boolean' };

    case 'ZodEnum':
    case 'enum':
      return { type: 'string', enum: def.values };

    case 'ZodArray':
    case 'array':
      return {
        type: 'array',
        items: zodFieldToOpenAPI(def.element || def.type),
      };

    case 'ZodOptional':
    case 'optional':
      return zodFieldToOpenAPI(def.innerType);

    case 'ZodDefault':
    case 'default':
      return {
        ...zodFieldToOpenAPI(def.innerType),
        default: typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue,
      };

    default:
      return {};
  }
}

/**
 * 为 Zod schema 添加 metadata（示例值等）
 *
 * 用法：
 * ```ts
 * import { z } from 'zod';
 * import { withMeta } from '@rtc-agent/component';
 *
 * const schema = z.object({
 *   name: withMeta(z.string(), { example: 'John Doe' }),
 *   age: withMeta(z.number().int(), { example: 30 }),
 * });
 * ```
 */
export function withMeta<T extends ZodType>(schema: T, meta: ZodMeta): T {
  const def = (schema as any)._def;
  if (def) {
    def.meta = { ...def.meta, ...meta };
  }
  return schema;
}
