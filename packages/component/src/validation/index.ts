/**
 * Runtime parameter validation module
 *
 * Provides a unified parameter validation entry point, supporting Zod schema and OpenAPI Schema
 * Validation failures return friendly errors, guiding Agent to read /functions/INDEX.md
 */

import { z, type ZodType } from 'zod';
import type { ParameterDef } from '../types/skill.js';
import { openApiToZod } from './openapi-to-zod.js';

// ── Type definitions ──────────────────────────────────────

/** Validation error info */
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

/** Validation result */
export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

// ── Parameter validation ──────────────────────────────────────

/**
 * Validate parameters with Zod schema
 *
 * @param schema Zod schema
 * @param params Parameters to validate
 */
export function validateParams<T extends ZodType>(
  schema: T,
  params: Record<string, unknown>
): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(params);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));

  return { success: false, errors };
}

/**
 * Format validation error into Agent-friendly message
 */
export function formatValidationError(
  groupName: string,
  functionName: string,
  errors: ValidationError[]
): string {
  const errorDetails = errors
    .map((e) => `  - ${e.field}: ${e.message}`)
    .join('\n');

  return `Parameter validation failed: ${groupName}.${functionName}\n\nError details:\n${errorDetails}\n\nPlease refer to \`/functions/INDEX.md\` for the correct parameter format and instructions.`;
}

/**
 * Build validator
 *
 * Prefers zodSchema, otherwise generates from parameters
 *
 * @param zodSchema Optional Zod schema
 * @param parameters Parameter definitions in OpenAPI format
 * @returns Zod schema for validation
 */
export function buildValidator(
  zodSchema: ZodType | undefined,
  parameters: ParameterDef[] | undefined
): ZodType | null {
  if (zodSchema) {
    return zodSchema;
  }

  if (parameters && parameters.length > 0) {
    return openApiToZod(parameters);
  }

  // No schema info, skip validation
  return null;
}

// ── Handler wrapper ─────────────────────────────────

/**
 * Handler wrapper with validation
 *
 * Used for wrapping FunctionDef.handler, automatically validates parameters
 */
export function withValidation<TParams extends ZodType, TResult>(
  groupName: string,
  functionName: string,
  schema: TParams,
  handler: (params: z.infer<TParams>) => Promise<TResult> | TResult
): (params: Record<string, unknown>) => Promise<TResult | { error: string }> {
  return async (params: Record<string, unknown>) => {
    // 1. Parameter validation
    const validation = validateParams(schema, params);

    if (!validation.success) {
      return {
        error: formatValidationError(groupName, functionName, validation.errors!),
      };
    }

    // 2. Execute handler
    try {
      const result = await handler(validation.data!);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error: `Execution failed: ${groupName}.${functionName}\n\nError: ${message}\n\nPlease check if the parameters are correct, or read \`/functions/INDEX.md\` for help.`,
      };
    }
  };
}

// ── Exports ──────────────────────────────────────────

export { z } from 'zod';
export { zodToParams, zodToOpenAPISchema, withMeta } from './zod-to-openapi.js';
export { openApiToZod } from './openapi-to-zod.js';
