/**
 * 业务错误接口
 */
export interface BizError {
  name: string;
  info?: {
    errorCode?: string;
    errorMessage?: string;
    showType?: number;
    data?: any;
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
 */
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  // 管理员角色相关错误
  cannot_delete_system_role: '系统内置管理员角色不可删除',
  cannot_remove_last_admin: '不能移除最后一个管理员角色',
  cannot_remove_self_admin: '不能移除自己的管理员角色',
  role_name_exists: '管理员角色名称已存在',
  role_disabled: '管理员角色已禁用',
  role_not_found: '管理员角色不存在',

  // 权限相关错误
  permission_exists: '权限策略已存在',
  permission_not_found: '权限策略不存在',
  invalid_resource: '无效的资源类型',
  invalid_action: '无效的操作类型',

  // 管理员相关错误
  admin_user_not_found: '管理员不存在',
  admin_user_has_no_role: '管理员没有该管理员角色',
  cannot_remove_self: '不能移除自己的管理员角色',

  // 登录相关错误
  login_locked: '登录尝试次数过多，请稍后再试',
  invalid_credentials: '管理员邮箱或密码错误',

  // 验证错误
  validation_error: '请求参数验证失败，请检查输入',

  // 通用错误
  unauthorized: '未授权，请重新登录',
  forbidden: '无权执行此操作',
  bad_request: '请求参数错误',
  internal_error: '服务器内部错误',
};

/**
 * 获取友好的错误提示信息
 * @param error 错误对象
 * @param defaultMessage 默认错误信息
 * @returns 友好的错误提示
 */
export function getFriendlyErrorMessage(
  error: BizError | any,
  defaultMessage = '操作失败',
): string {
  // 尝试从 BizError 中获取错误码
  const errorCode = error?.info?.errorCode || error?.errorCode;
  if (errorCode && ERROR_CODE_MESSAGES[errorCode]) {
    return ERROR_CODE_MESSAGES[errorCode];
  }

  // 尝试从响应体中获取错误码
  const responseErrorCode = error?.response?.data?.errorCode;
  if (responseErrorCode && ERROR_CODE_MESSAGES[responseErrorCode]) {
    return ERROR_CODE_MESSAGES[responseErrorCode];
  }

  // 使用错误消息或默认消息
  return error?.message || defaultMessage;
}
