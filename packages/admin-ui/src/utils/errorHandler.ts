/**
 * 业务错误接口
 */
export interface BizError {
  name: string;
  info?: {
    errorCode?: string;
    errorMessage?: string;
    showType?: number;
    data?: Record<string, unknown>;
  };
  response?: {
    data?: {
      errorCode?: string;
      errorMessage?: string;
    };
  };
  message?: string;
}

/**
 * 错误码到友好提示的映射
 * 参考：需求文档 §5.7 错误码定义
 *
 * NOTE: 所有错误码统一使用大写格式存储。
 * 查询时会自动将错误码转换为大写进行匹配，
 * 避免存储大小写重复版本。
 */
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  // 管理员角色相关错误
  CANNOT_DELETE_SYSTEM_ROLE: '系统内置管理员角色不可删除',
  CANNOT_REMOVE_LAST_ADMIN: '不能移除最后一个管理员角色',
  CANNOT_REMOVE_SELF_ADMIN: '不能移除自己的管理员角色',
  ROLE_NAME_EXISTS: '管理员角色名称已存在',
  ROLE_DISABLED: '管理员角色已禁用',
  ROLE_NOT_FOUND: '管理员角色不存在',

  // 权限相关错误
  PERMISSION_EXISTS: '权限策略已存在',
  PERMISSION_NOT_FOUND: '权限策略不存在',
  INVALID_RESOURCE: '无效的资源类型',
  INVALID_ACTION: '无效的操作类型',

  // 管理员相关错误
  ADMIN_USER_NOT_FOUND: '管理员不存在',
  ADMIN_USER_HAS_NO_ROLE: '管理员没有该管理员角色',
  CANNOT_REMOVE_SELF: '不能移除自己的管理员角色',

  // 登录相关错误
  LOGIN_LOCKED: '登录尝试次数过多，请稍后再试',
  INVALID_CREDENTIALS: '管理员邮箱或密码错误',

  // 动态配置相关错误（设计文档 §5.7 定义为大写格式）
  OPTIMISTIC_LOCK_CONFLICT: '配置已被其他管理员修改，请重新加载后重试',
  CONFIG_KEY_NOT_FOUND: '配置项不存在',
  CONFIG_NOT_FOUND: '配置记录不存在',
  USER_NOT_FOUND: '用户不存在',
  INVALID_CONFIG_VALUE: '配置值格式不合法',
  VERSION_NOT_FOUND: '该版本已超出保留期限',
  NO_OP: '无需操作',

  // 验证错误
  VALIDATION_ERROR: '请求参数验证失败，请检查输入',

  // 通用错误
  UNAUTHORIZED: '未授权，请重新登录',
  FORBIDDEN: '无权执行此操作',
  BAD_REQUEST: '请求参数错误',
  INTERNAL_ERROR: '服务器内部错误',
};

/**
 * 获取友好的错误提示信息
 * 内部统一将错误码转换为大写进行匹配，
 * 避免重复存储大小写版本。
 * @param error 错误对象
 * @param defaultMessage 默认错误信息
 * @returns 友好的错误提示
 */
export function getFriendlyErrorMessage(
  error: BizError | unknown,
  defaultMessage = '操作失败',
): string {
  // Narrow unknown to a shape we can safely probe
  const err = (error ?? {}) as Record<string, unknown>;
  const info = (err.info ?? {}) as Record<string, unknown>;
  const response = (err.response ?? {}) as Record<string, unknown>;
  const responseData = (response.data ?? {}) as Record<string, unknown>;

  // 尝试从 BizError 中获取错误码，统一转大写匹配
  const errorCode = (info.errorCode as string) || (err.errorCode as string);
  if (errorCode) {
    const normalizedCode = errorCode.toUpperCase();
    if (ERROR_CODE_MESSAGES[normalizedCode]) {
      return ERROR_CODE_MESSAGES[normalizedCode];
    }
  }

  // 尝试从响应体中获取错误码，统一转大写匹配
  const responseErrorCode = responseData.errorCode as string;
  if (responseErrorCode) {
    const normalizedCode = responseErrorCode.toUpperCase();
    if (ERROR_CODE_MESSAGES[normalizedCode]) {
      return ERROR_CODE_MESSAGES[normalizedCode];
    }
  }

  // 使用错误消息或默认消息
  return (err.message as string) || defaultMessage;
}
