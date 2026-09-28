/**
 * Skill System Types
 *
 * Defines core types for Function, FunctionGroup, VisualHooks, etc.
 */

import type { ZodType } from 'zod';

/**
 * CancelledError - User cancelled operation
 *
 * Used to distinguish "user cancellation" from "real errors"
 *
 * M13: Added isCancelled brand property to solve the unreliability of instanceof across realms.
 * Use `CancelledError.isCancelledError(err)` for type guard checks.
 */
export class CancelledError extends Error {
  /** M13: brand property for reliable cross-realm type checking */
  readonly isCancelled = true;

  constructor(message = 'Operation cancelled by user') {
    super(message);
    this.name = 'CancelledError';
  }

  /**
   * M13: Cross-realm safe type guard
   * More reliable than instanceof (for iframe, Worker, different bundle scenarios, etc.)
   */
  static isCancelledError(error: unknown): error is CancelledError {
    return (
      (error instanceof CancelledError) ||
      (error instanceof Error && (error as CancelledError).isCancelled === true)
    );
  }
}

/**
 * Parameter definition in OpenAPI Schema format
 *
 * Uses standard OpenAPI 3.0 Schema format, supporting:
 * - Basic types: string, number, integer, boolean
 * - Complex types: object, array
 * - Formats: date, date-time, email, uri, uuid, etc.
 * - Nested objects and arrays
 * - Enum values
 * - Example values (example)
 */
export interface OpenAPISchema {
  /** Data type */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  /** Data format (e.g. date, date-time, email, uri, uuid, int32, int64, float, double, etc.) */
  format?: string;
  /** Description */
  description?: string;
  /** Whether required (used within object properties) */
  required?: boolean | string[];
  /** Default value */
  default?: unknown;
  /** Example value */
  example?: unknown;
  /** Enum values */
  enum?: unknown[];
  /** Object property definitions */
  properties?: Record<string, OpenAPISchema>;
  /** Array item definition */
  items?: OpenAPISchema;
  /** Additional properties for record/map types */
  additionalProperties?: OpenAPISchema | boolean;
  /** Reference to another schema (e.g. '#/components/schemas/User') */
  $ref?: string;
  /** Minimum value (number/integer) */
  minimum?: number;
  /** Maximum value (number/integer) */
  maximum?: number;
  /** Minimum length (string) */
  minLength?: number;
  /** Maximum length (string) */
  maxLength?: number;
  /** Regex pattern (string) */
  pattern?: string;
  /** Minimum item count (array) */
  minItems?: number;
  /** Maximum item count (array) */
  maxItems?: number;
  /** Whether duplicate items are allowed (array) */
  uniqueItems?: boolean;
  /** Whether value can be null (OpenAPI 3.0) */
  nullable?: boolean;
  /** One of these schemas (for unions) */
  oneOf?: OpenAPISchema[];
  /** All of these schemas (for intersections) */
  allOf?: OpenAPISchema[];
  /** Any of these schemas */
  anyOf?: OpenAPISchema[];
}

/**
 * Parameter definition (OpenAPI format)
 *
 * Uses OpenAPI Schema to define parameter types, supporting complex nested structures.
 */
export interface ParameterDef {
  /** Parameter name */
  name: string;
  /** OpenAPI Schema definition */
  schema: OpenAPISchema;
  /** Whether required */
  required?: boolean;
  /** Parameter description (optional, fallback if schema has no description) */
  description?: string;
}

/**
 * Return value definition (OpenAPI format)
 */
export interface ReturnDef {
  /** OpenAPI Schema definition */
  schema?: OpenAPISchema;
  /** Zod schema (for runtime validation, takes precedence over schema) */
  zodSchema?: ZodType;
  /** Return value description (optional, fallback if schema has no description) */
  description?: string;
}

/**
 * Visual Hooks - UI hook functions
 */
export interface VisualHooks {
  /** Execution started */
  onStart?: (params: Record<string, unknown>) => void | Promise<void>;
  /** Execution succeeded */
  onSuccess?: (result: unknown) => void | Promise<void>;
  /** Execution failed */
  onError?: (error: Error) => void | Promise<void>;
  /** Execution progress */
  onProgress?: (progress: number) => void | Promise<void>;
}

/**
 * Function definition
 */
export interface FunctionDef {
  /** Function name (e.g. 'user.register') */
  name: string;
  /** Function description */
  description: string;
  /** Parameter list (OpenAPI format, backward compatible) */
  parameters?: ParameterDef[];
  /** Zod schema (for runtime validation, takes precedence over parameters) */
  zodSchema?: ZodType;
  /** Return value definition */
  returns?: ReturnDef;
  /** Visual Hooks */
  hooks?: VisualHooks;
  /**
   * Execution function (second parameter is a progress callback, optional)
   *
   * MD13: Return type is unknown (no longer uses unknown | Promise<unknown>).
   * Note: handler can be a sync or async function. FunctionRegistry.execute internally awaits the return value,
   * so Promises returned by async functions are automatically resolved. Sync function returns are wrapped in a resolved Promise.
   */
  handler: (
    params: Record<string, unknown>,
    onProgress?: (progress: number) => void | Promise<void>
  ) => unknown;
}

/**
 * FunctionGroup definition
 */
export interface FunctionGroupDef {
  /** Group name (e.g. 'user') */
  name: string;
  /** Group description */
  description: string;
}

/**
 * Registry configuration
 */
export interface RegistryConfig {
  /** Application name */
  name: string;
  /** Application description */
  description: string;
  /** AI persona */
  persona?: string;
  /** Async operation error callback (e.g. document generation failure) */
  onError?: (error: Error, context: string) => void;
}

/**
 * Scenario definition
 */
export interface ScenarioDef {
  /** Scenario unique identifier (optional, auto-generated from title by default) */
  id?: string;
  /** Scenario title */
  title: string;
  /** Scenario short description (used for INDEX.md) */
  description?: string;
  /** Scenario content (Markdown) */
  content: string;
  /** Tags */
  tags?: string[];
  /** Author */
  author?: string;
  /** Creation time (ISO 8601) */
  createdAt?: string;
}

/**
 * Scenario Manifest
 *
 * m10: This type is used in scenario-loader.ts (for parsing manifest.json),
 * and exported via types/index.ts and the package index.ts.
 */
export interface ScenarioManifest {
  scenarios: Array<{
    /** Filename */
    file: string;
    /** Unique identifier (optional) */
    id?: string;
    /** Name (optional) */
    name?: string;
    /** Description (optional) */
    description?: string;
  }>;
}
