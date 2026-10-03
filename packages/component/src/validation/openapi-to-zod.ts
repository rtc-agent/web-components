/**
 * OpenAPI Schema to Zod Schema conversion
 *
 * Converts OpenAPI Schema to Zod schema for backward compatibility with existing OpenAPI Schema registration
 */

import { z, type ZodType } from 'zod';
import type { OpenAPISchema, ParameterDef } from '../types/skill.js';

/**
 * Generate ZodObject schema from OpenAPI parameters
 *
 * @param parameters Array of parameter definitions in OpenAPI format
 * @returns ZodObject schema, can be used for runtime validation
 */
export function openApiToZod(parameters: ParameterDef[]): ZodType {
  const shape: Record<string, ZodType> = {};

  for (const param of parameters) {
    let fieldSchema = openApiSchemaToZod(param.schema);

    // Add description
    if (param.description || param.schema.description) {
      fieldSchema = fieldSchema.describe(param.description || param.schema.description || '');
    }

    // Handle optional/required
    if (!param.required && param.schema.required !== true) {
      fieldSchema = fieldSchema.optional();
    }

    shape[param.name] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Single OpenAPI Schema to Zod schema conversion
 */
function openApiSchemaToZod(schema: OpenAPISchema): ZodType {
  const type = schema.type;

  switch (type) {
    case 'string': {
      let stringSchema = z.string();

      // Apply constraints
      if (schema.minLength !== undefined) {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (schema.maxLength !== undefined) {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      if (schema.pattern !== undefined) {
        stringSchema = stringSchema.regex(new RegExp(schema.pattern));
      }

      // Handle enum
      if (schema.enum !== undefined && schema.enum.length > 0) {
        // Safety: ensure all enum values are strings before casting
        const enumValues = schema.enum.filter((v): v is string => typeof v === 'string');
        if (enumValues.length > 0) {
          return z.enum(enumValues as [string, ...string[]]);
        }
      }

      // Handle format (for documentation only, no runtime validation)
      if (schema.format === 'date' || schema.format === 'date-time') {
        // Could add custom validation, but keeping it simple here
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
        // OpenAPI spec: `required` is an array of property names on the parent object.
        // For backward compatibility, also check per-property `required: boolean`.
        const requiredFields = (schema.required as string[] | undefined) ?? [];
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          let fieldSchema = openApiSchemaToZod(propSchema);
          const isRequired = requiredFields.includes(key) || propSchema.required === true;
          if (!isRequired) {
            fieldSchema = fieldSchema.optional();
          }
          shape[key] = fieldSchema;
        }
        return z.object(shape);
      }
      return z.record(z.unknown());
    }

    default:
      // Unknown type, return unknown
      return z.unknown();
  }
}
