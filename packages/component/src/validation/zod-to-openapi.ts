/**
 * Zod Schema to OpenAPI Schema conversion
 *
 * Converts Zod schema to OpenAPI Schema format, used for generating Agent documentation
 *
 * Migrated from peep/src/lib/rtc-agent-validation.ts
 *
 * Supported Zod features:
 * - .describe() → description (parameter description)
 * - .optional() → required: false
 * - .default() → default + required: false
 * - .min()/.max() → minimum/maximum
 * - .minLength()/.maxLength() → minLength/maxLength
 * - .regex() → pattern
 * - .enum() → enum
 * - z.array() → array + items
 *
 * Extended features (via meta method):
 * - .meta({ example: ... }) → example (example value)
 */

import type { ZodType } from 'zod';
import type { OpenAPISchema, ParameterDef } from '../types/skill.js';

/**
 * Zod metadata extension interface
 *
 * Used to store example values and other OpenAPI-specific information
 */
interface ZodMeta {
  example?: unknown;
  examples?: unknown[];
  format?: string;
}

/**
 * Generate OpenAPI parameters from Zod schema
 *
 * @param shape ZodObject schema
 * @param descriptions Optional parameter description overrides
 */
export function zodToParams<T extends ZodType>(
  shape: T,
  descriptions?: Record<string, string>
): ParameterDef[] {
  const params: ParameterDef[] = [];
  let obj = shape as any;

  // Unwrap ZodOptional/ZodDefault to get the inner ZodObject
  // Handles z.object({...}).optional() case
  while (obj?._def) {
    const typeIdentifier = obj._def.typeName || obj._def.type;
    if (typeIdentifier === 'ZodOptional' || typeIdentifier === 'optional' ||
        typeIdentifier === 'ZodDefault' || typeIdentifier === 'default') {
      obj = obj._def.innerType;
    } else {
      break;
    }
  }

  // Compatibility with Zod v3 and v4 structural differences
  // Zod v3: _def.typeName === 'ZodObject', _def.shape is a function
  // Zod v4: _def.typeName is undefined, _def.shape is an object
  const isZodObject = obj?._def && (
    obj._def.typeName === 'ZodObject' ||  // v3
    (obj._def.shape !== undefined && typeof obj._def.shape === 'object' && !Array.isArray(obj._def.shape))  // v4
  );

  if (!obj || !obj._def || !isZodObject) {
    throw new Error('zodToParams expects a ZodObject schema (got: ' + (obj?._def?.typeName || obj?._def?.type || 'unknown') + ')');
  }

  // Get shape: v3 is a function call, v4 is a direct object
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
 * Extract field metadata (optionality, description, example)
 * Compatible with Zod v3 and v4
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

  // Get type identifier (compatible with v3's typeName and v4's type)
  const typeIdentifier = def.typeName || def.type;

  // Recursively handle wrapper types (optional/default)
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

  // Read description
  // v3: def.description
  // v4: schema.description (top-level property, not in _def)
  if (def.description) {
    description = def.description;
  } else if ((schema as any).description) {
    description = (schema as any).description;
  }

  // Read metadata (example values) - v3 uses def.meta
  const meta = def.meta as ZodMeta | undefined;
  if (meta?.example !== undefined) {
    example = meta.example;
  } else if (meta?.examples && meta.examples.length > 0) {
    example = meta.examples[0];
  }

  // v4: Check _zod.bag (zod v4's metadata storage location)
  const zodBag = (schema as any)._zod?.bag as ZodMeta | undefined;
  if (example === undefined && zodBag?.example !== undefined) {
    example = zodBag.example;
  } else if (example === undefined && zodBag?.examples && zodBag.examples.length > 0) {
    example = zodBag.examples[0];
  }

  // Auto-generate example from enum
  // v3: typeName === 'ZodEnum', values
  // v4: type === 'enum', values
  if (example === undefined && (typeIdentifier === 'ZodEnum' || typeIdentifier === 'enum') && def.values?.length > 0) {
    example = def.values[0];
  }

  // Auto-generate example from default
  if (example === undefined && (typeIdentifier === 'ZodDefault' || typeIdentifier === 'default') && typeof def.defaultValue === 'function') {
    try {
      example = def.defaultValue();
    } catch {
      // Ignore
    }
  }

  return { isOptional, description, example };
}

/**
 * Convert Zod schema to OpenAPI Schema
 *
 * Supports all Zod types including nested objects and arrays.
 * Compatible with Zod v3 and v4.
 *
 * @param schema Zod schema
 * @returns OpenAPI Schema
 */
export function zodToOpenAPISchema(schema: ZodType): OpenAPISchema {
  return zodFieldToOpenAPI(schema);
}

/**
 * Single Zod field to OpenAPI schema
 * Compatible with Zod v3 and v4
 */
function zodFieldToOpenAPI(schema: ZodType): OpenAPISchema {
  const def = (schema as any)._def;

  if (!def) return {};

  // Read format from metadata
  const meta = def.meta as ZodMeta | undefined;
  const format = meta?.format;

  // Get type identifier (compatible with v3's typeName and v4's type)
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

    case 'ZodObject':
    case 'object': {
      // Get shape: v3 is a function call, v4 is a direct object
      const shapeEntries = typeof def.shape === 'function' ? def.shape() : def.shape;
      if (!shapeEntries) return { type: 'object' };

      const properties: Record<string, OpenAPISchema> = {};
      const required: string[] = [];

      for (const [key, fieldSchema] of Object.entries(shapeEntries)) {
        const fieldOpenAPI = zodFieldToOpenAPI(fieldSchema as ZodType);
        const fieldInfo = extractFieldInfo(fieldSchema as ZodType);

        // Add description if available
        if (fieldInfo.description && !fieldOpenAPI.description) {
          fieldOpenAPI.description = fieldInfo.description;
        }

        properties[key] = fieldOpenAPI;

        // Track required fields (not optional and no default)
        if (!fieldInfo.isOptional) {
          required.push(key);
        }
      }

      const result: OpenAPISchema = {
        type: 'object',
        properties,
      };

      if (required.length > 0) {
        result.required = required;
      }

      // Add description from .describe() if available
      const description = def.description || (schema as any).description;
      if (description) {
        result.description = description;
      }

      return result;
    }

    case 'ZodVoid':
    case 'void':
      return { type: 'null' };

    case 'ZodNull':
    case 'null':
      return { type: 'null' };

    case 'ZodNullable':
    case 'nullable': {
      const innerSchema = zodFieldToOpenAPI(def.innerType);
      // In OpenAPI 3.0, nullable is a property; in 3.1, use type array
      // For compatibility, we'll use a simple approach
      return { ...innerSchema, nullable: true };
    }

    case 'ZodRecord':
    case 'record': {
      // z.record(keyType, valueType) or z.record(valueType)
      const valueType = def.valueType || def.type;
      return {
        type: 'object',
        additionalProperties: valueType ? zodFieldToOpenAPI(valueType) : {},
      };
    }

    case 'ZodAny':
    case 'any':
      return {};

    case 'ZodUnknown':
    case 'unknown':
      return {};

    case 'ZodLiteral':
    case 'literal': {
      const value = def.value;
      const type = typeof value;
      if (type === 'string') return { type: 'string', enum: [value] };
      if (type === 'number') return { type: 'number', enum: [value] };
      if (type === 'boolean') return { type: 'boolean', enum: [value] };
      return { enum: [value] };
    }

    case 'ZodUnion':
    case 'union':
    case 'ZodDiscriminatedUnion':
    case 'discriminatedUnion': {
      // Convert union options to oneOf
      const options = def.options || [];
      if (options.length === 0) return {};
      const oneOf = options.map((opt: ZodType) => zodFieldToOpenAPI(opt));
      return { oneOf };
    }

    case 'ZodIntersection':
    case 'intersection': {
      // Convert intersection to allOf
      const left = zodFieldToOpenAPI(def.left);
      const right = zodFieldToOpenAPI(def.right);
      return { allOf: [left, right] };
    }

    case 'ZodTuple':
    case 'tuple': {
      // Convert tuple to array with prefixItems (OpenAPI 3.1) or items (simplified)
      const items = (def.items || []).map((item: ZodType) => zodFieldToOpenAPI(item));
      return {
        type: 'array',
        items: items.length > 0 ? { oneOf: items } : {},
        minItems: items.length,
        maxItems: items.length,
      };
    }

    default:
      return {};
  }
}

/**
 * Add metadata to Zod schema (example values, etc.)
 *
 * **Implementation note**: This mutates the schema's internal `_def.meta` property,
 * which is not part of Zod's public API. This approach is compatible with Zod v3 and v4,
 * but may break if Zod changes its internal structure in a future major version.
 * If that happens, consider migrating to `zod-to-json-schema` or a dedicated metadata library.
 *
 * Usage:
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
