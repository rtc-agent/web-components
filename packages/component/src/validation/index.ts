/**
 * 运行时参数校验模块
 *
 * 提供统一的参数校验入口，支持 Zod schema 和 OpenAPI Schema
 * 校验失败返回友好错误，引导 Agent 读取 /functions/INDEX.md
 */

import { z, type ZodType } from 'zod';
import type { ParameterDef } from '../types/skill.js';
import { openApiToZod } from './openapi-to-zod.js';

// ── 类型定义 ──────────────────────────────────────

/** 校验错误信息 */
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

/** 校验结果 */
export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

// ── 参数校验 ──────────────────────────────────────

/**
 * 用 Zod schema 校验参数
 *
 * @param schema Zod schema
 * @param params 待校验的参数
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
 * 格式化校验错误为 Agent 友好的消息
 */
export function formatValidationError(
  groupName: string,
  functionName: string,
  errors: ValidationError[]
): string {
  const errorDetails = errors
    .map((e) => `  - ${e.field}: ${e.message}`)
    .join('\n');

  return `参数校验失败：${groupName}.${functionName}\n\n错误详情：\n${errorDetails}\n\n请读取 /functions/INDEX.md 获取正确的参数格式和说明。`;
}

/**
 * 构建校验器
 *
 * 优先使用 zodSchema，否则从 parameters 生成
 *
 * @param zodSchema 可选的 Zod schema
 * @param parameters OpenAPI 格式的参数定义
 * @returns Zod schema 用于校验
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

  // 没有 schema 信息，跳过校验
  return null;
}

// ── Handler 包装器 ─────────────────────────────────

/**
 * 带校验的 handler 包装器
 *
 * 用于 FunctionDef.handler 的包装，自动进行参数校验
 */
export function withValidation<TParams extends ZodType, TResult>(
  groupName: string,
  functionName: string,
  schema: TParams,
  handler: (params: z.infer<TParams>) => Promise<TResult> | TResult
): (params: Record<string, unknown>) => Promise<TResult | { error: string }> {
  return async (params: Record<string, unknown>) => {
    // 1. 参数校验
    const validation = validateParams(schema, params);

    if (!validation.success) {
      return {
        error: formatValidationError(groupName, functionName, validation.errors!),
      };
    }

    // 2. 执行 handler
    try {
      const result = await handler(validation.data!);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error: `执行失败：${groupName}.${functionName}\n\n错误：${message}\n\n请检查参数是否正确，或读取 /functions/INDEX.md 获取帮助。`,
      };
    }
  };
}

// ── 导出 ──────────────────────────────────────────

export { z } from 'zod';
export { zodToParams, withMeta } from './zod-to-openapi.js';
export { openApiToZod } from './openapi-to-zod.js';
