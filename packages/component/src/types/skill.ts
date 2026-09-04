/**
 * Skill System Types
 *
 * 定义 Function、FunctionGroup、VisualHooks 等核心类型
 */

/**
 * CancelledError - 用户取消操作
 *
 * 用于区分"用户取消"和"真正的错误"
 *
 * M13: 添加 isCancelled brand 属性，解决跨 realm 时 instanceof 不可靠的问题。
 * 使用 `CancelledError.isCancelledError(err)` 进行类型守卫判断。
 */
export class CancelledError extends Error {
  /** M13: brand 属性，用于跨 realm 可靠判断 */
  readonly isCancelled = true;

  constructor(message = 'Operation cancelled by user') {
    super(message);
    this.name = 'CancelledError';
  }

  /**
   * M13: 跨 realm 安全的类型守卫
   * 比 instanceof 更可靠（iframe、Worker、不同 bundle 等场景）
   */
  static isCancelledError(error: unknown): error is CancelledError {
    return (
      (error instanceof CancelledError) ||
      (error instanceof Error && (error as CancelledError).isCancelled === true)
    );
  }
}

/**
 * OpenAPI Schema 格式的参数定义
 *
 * 使用标准 OpenAPI 3.0 Schema 格式，支持：
 * - 基础类型：string, number, integer, boolean
 * - 复杂类型：object, array
 * - 格式：date, date-time, email, uri, uuid 等
 * - 嵌套对象和数组
 * - 枚举值
 */
export interface OpenAPISchema {
  /** 数据类型 */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  /** 数据格式（如 date, date-time, email, uri, uuid, int32, int64, float, double 等） */
  format?: string;
  /** 描述 */
  description?: string;
  /** 是否必需（在 object 的 properties 中使用） */
  required?: boolean;
  /** 默认值 */
  default?: unknown;
  /** 枚举值 */
  enum?: unknown[];
  /** 对象属性定义 */
  properties?: Record<string, OpenAPISchema>;
  /** 数组项定义 */
  items?: OpenAPISchema;
  /** 引用其他 schema（如 '#/components/schemas/User'） */
  $ref?: string;
  /** 最小值（number/integer） */
  minimum?: number;
  /** 最大值（number/integer） */
  maximum?: number;
  /** 最小长度（string） */
  minLength?: number;
  /** 最大长度（string） */
  maxLength?: number;
  /** 正则模式（string） */
  pattern?: string;
  /** 最小项数（array） */
  minItems?: number;
  /** 最大项数（array） */
  maxItems?: number;
  /** 是否允许重复项（array） */
  uniqueItems?: boolean;
}

/**
 * 参数定义（OpenAPI 格式）
 *
 * 使用 OpenAPI Schema 定义参数类型，支持复杂的嵌套结构
 */
export interface ParameterDef {
  /** 参数名称 */
  name: string;
  /** OpenAPI Schema 定义 */
  schema: OpenAPISchema;
  /** 是否必需 */
  required?: boolean;
  /** 参数描述（可选，如果 schema 中没有 description） */
  description?: string;
}

/**
 * 返回值定义（OpenAPI 格式）
 */
export interface ReturnDef {
  /** OpenAPI Schema 定义 */
  schema: OpenAPISchema;
  /** 返回值描述（可选，如果 schema 中没有 description） */
  description?: string;
}

/**
 * Visual Hooks - UI 钩子函数
 */
export interface VisualHooks {
  /** 执行开始 */
  onStart?: (params: Record<string, unknown>) => void | Promise<void>;
  /** 执行成功 */
  onSuccess?: (result: unknown) => void | Promise<void>;
  /** 执行失败 */
  onError?: (error: Error) => void | Promise<void>;
  /** 执行进度 */
  onProgress?: (progress: number) => void | Promise<void>;
}

/**
 * Function 定义
 */
export interface FunctionDef {
  /** Function 名称（如 'user.register'） */
  name: string;
  /** Function 描述 */
  description: string;
  /** 参数列表 */
  parameters?: ParameterDef[];
  /** 返回值定义 */
  returns?: ReturnDef;
  /** Visual Hooks */
  hooks?: VisualHooks;
  /**
   * 执行函数（第二个参数是进度回调，可选）
   *
   * MD13: 返回值类型为 unknown（不再使用 unknown | Promise<unknown>）。
   * 注释说明：handler 可以是同步或异步函数。FunctionRegistry.execute 内部会 await 返回值，
   * 因此异步函数返回的 Promise 会被自动解析。同步函数的返回值会被包装为 resolved Promise。
   */
  handler: (
    params: Record<string, unknown>,
    onProgress?: (progress: number) => void | Promise<void>
  ) => unknown;
}

/**
 * FunctionGroup 定义
 */
export interface FunctionGroupDef {
  /** Group 名称（如 'user'） */
  name: string;
  /** Group 描述 */
  description: string;
}

/**
 * Registry 配置
 */
export interface RegistryConfig {
  /** 应用名称 */
  name: string;
  /** 应用描述 */
  description: string;
  /** AI 人设 */
  persona?: string;
  /** 异步操作错误回调（如文档生成失败） */
  onError?: (error: Error, context: string) => void;
}

/**
 * Scenario 定义
 */
export interface ScenarioDef {
  /** Scenario 唯一标识（可选，默认从 title 生成） */
  id?: string;
  /** Scenario 标题 */
  title: string;
  /** Scenario 简短描述（用于 INDEX.md） */
  description?: string;
  /** Scenario 内容（Markdown） */
  content: string;
  /** 标签 */
  tags?: string[];
  /** 作者 */
  author?: string;
  /** 创建时间（ISO 8601） */
  createdAt?: string;
}

/**
 * Scenario Manifest
 *
 * m10: 此类型在 scenario-loader.ts 中使用（解析 manifest.json），
 * 并通过 types/index.ts 和 package index.ts 导出。
 */
export interface ScenarioManifest {
  scenarios: Array<{
    /** 文件名 */
    file: string;
    /** 唯一标识（可选） */
    id?: string;
    /** 名称（可选） */
    name?: string;
    /** 描述（可选） */
    description?: string;
  }>;
}
