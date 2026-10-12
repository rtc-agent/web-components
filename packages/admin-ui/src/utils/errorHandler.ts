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
 * 错误码到i18n key的映射
 * 参考：需求文档 §5.7 错误码定义
 *
 * NOTE: 所有错误码统一使用大写格式存储。
 * 查询时会自动将错误码转换为大写进行匹配，
 * 避免存储大小写重复版本。
 */
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  // 管理员角色相关错误
  CANNOT_DELETE_SYSTEM_ROLE: 'error.cannotDeleteSystemRole',
  CANNOT_REMOVE_LAST_ADMIN: 'error.cannotRemoveLastAdmin',
  CANNOT_REMOVE_SELF_ADMIN: 'error.cannotRemoveSelfAdmin',
  ROLE_NAME_EXISTS: 'error.roleNameExists',
  ROLE_DISABLED: 'error.roleDisabled',
  ROLE_NOT_FOUND: 'error.roleNotFound',

  // 权限相关错误
  PERMISSION_EXISTS: 'error.permissionExists',
  PERMISSION_NOT_FOUND: 'error.permissionNotFound',
  INVALID_RESOURCE: 'error.invalidResource',
  INVALID_ACTION: 'error.invalidAction',

  // 管理员相关错误
  ADMIN_USER_NOT_FOUND: 'error.adminUserNotFound',
  ADMIN_USER_HAS_NO_ROLE: 'error.adminUserHasNoRole',
  CANNOT_REMOVE_SELF: 'error.cannotRemoveSelf',

  // 登录相关错误
  LOGIN_LOCKED: 'error.loginLocked',
  INVALID_CREDENTIALS: 'error.invalidCredentials',

  // 动态配置相关错误（设计文档 §5.7 定义为大写格式）
  OPTIMISTIC_LOCK_CONFLICT: 'error.optimisticLockConflict',
  CONFIG_KEY_NOT_FOUND: 'error.configKeyNotFound',
  CONFIG_NOT_FOUND: 'error.configNotFound',
  USER_NOT_FOUND: 'error.userNotFound',
  INVALID_CONFIG_VALUE: 'error.invalidConfigValue',
  VERSION_NOT_FOUND: 'error.versionNotFound',
  NO_OP: 'error.noOp',

  // 验证错误
  VALIDATION_ERROR: 'error.validationError',

  // 通用错误
  UNAUTHORIZED: 'error.unauthorized',
  FORBIDDEN: 'error.forbidden',
  BAD_REQUEST: 'error.badRequest',
  INTERNAL_ERROR: 'error.internalError',
};

/**
 * 获取友好的错误提示信息
 * 内部统一将错误码转换为大写进行匹配，
 * 避免重复存储大小写版本。
 * @param error 错误对象
 * @param intl 国际化实例（可选，如果不提供则返回i18n key）
 * @param defaultMessage 默认错误信息
 * @returns 友好的错误提示
 */
export function getFriendlyErrorMessage(
  error: BizError | unknown,
  intl?: { formatMessage: (descriptor: { id: string; defaultMessage?: string }) => string },
  defaultMessage = 'Operation failed',
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
      const i18nKey = ERROR_CODE_MESSAGES[normalizedCode];
      if (intl) {
        return intl.formatMessage({ id: i18nKey, defaultMessage: i18nKey });
      }
      return i18nKey;
    }
  }

  // 尝试从响应体中获取错误码，统一转大写匹配
  const responseErrorCode = responseData.errorCode as string;
  if (responseErrorCode) {
    const normalizedCode = responseErrorCode.toUpperCase();
    if (ERROR_CODE_MESSAGES[normalizedCode]) {
      const i18nKey = ERROR_CODE_MESSAGES[normalizedCode];
      if (intl) {
        return intl.formatMessage({ id: i18nKey, defaultMessage: i18nKey });
      }
      return i18nKey;
    }
  }

  // 使用错误消息或默认消息
  return (err.message as string) || defaultMessage;
}
