/**
 * OpenAPI Schema → Zod Schema 转换
 *
 * 将 OpenAPI Schema 转换为 Zod schema，用于向后兼容现有 OpenAPI Schema 注册方式
 */

import { z, type ZodType } from 'zod';
import type { OpenAPISchema, ParameterDef } from '../types/skill.js';

/**
 * 从 OpenAPI parameters 生成 ZodObject schema
 *
 * @param parameters OpenAPI 格式的参数定义数组
 * @returns ZodObject schema，可用于运行时校验
 */
export function openApiToZod(parameters: ParameterDef[]): ZodType {
  const shape: Record<string, ZodType> = {};

  for (const param of parameters) {
    let fieldSchema = openApiSchemaToZod(param.schema);

    // 添加描述
    if (param.description || param.schema.description) {
      fieldSchema = fieldSchema.describe(param.description || param.schema.description || '');
    }

    // 处理可选/必填
    if (!param.required && param.schema.required !== true) {
      fieldSchema = fieldSchema.optional();
    }

    shape[param.name] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * 单个 OpenAPI Schema 转 Zod schema
 */
function openApiSchemaToZod(schema: OpenAPISchema): ZodType {
  const type = schema.type;

  switch (type) {
    case 'string': {
      let stringSchema = z.string();

      // 应用约束
      if (schema.minLength !== undefined) {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (schema.maxLength !== undefined) {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      if (schema.pattern !== undefined) {
        stringSchema = stringSchema.regex(new RegExp(schema.pattern));
      }

      // 处理枚举
      if (schema.enum !== undefined && schema.enum.length > 0) {
        return z.enum(schema.enum as [string, ...string[]]);
      }

      // 处理格式（仅用于文档，运行时不校验）
      if (schema.format === 'date' || schema.format === 'date-time') {
        // 可以添加自定义校验，但这里保持简单
      }

      return stringSchema;
    }

    case 'number': {
      let numberSchema = z.number();

      if (schema.minimum !== undefined) {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (schema.maximum !== undefined) {
        numberSchema = numberSchema.max(schema.maximum);
      }

      return numberSchema;
    }

    case 'integer': {
      let intSchema = z.number().int();

      if (schema.minimum !== undefined) {
        intSchema = intSchema.min(schema.minimum);
      }
      if (schema.maximum !== undefined) {
        intSchema = intSchema.max(schema.maximum);
      }

      return intSchema;
    }

    case 'boolean':
      return z.boolean();

    case 'array': {
      if (schema.items) {
        const itemsSchema = openApiSchemaToZod(schema.items);
        let arraySchema = z.array(itemsSchema);

        if (schema.minItems !== undefined) {
          arraySchema = arraySchema.min(schema.minItems);
        }
        if (schema.maxItems !== undefined) {
          arraySchema = arraySchema.max(schema.maxItems);
        }

        return arraySchema;
      }
      return z.array(z.unknown());
    }

    case 'object': {
      if (schema.properties) {
        const shape: Record<string, ZodType> = {};
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          let fieldSchema = openApiSchemaToZod(propSchema);
          // 如果字段不是 required，则设为可选
          if (!propSchema.required) {
            fieldSchema = fieldSchema.optional();
          }
          shape[key] = fieldSchema;
        }
        return z.object(shape);
      }
      return z.record(z.unknown());
    }

    default:
      // 未知类型，返回 unknown
      return z.unknown();
  }
}
