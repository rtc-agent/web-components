/**
 * 服务层通用类型定义
 * 用于在多个服务文件之间共享的类型
 */

/** 通用分页响应结构 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

/** 通用分页查询参数 */
export interface PaginatedRequest {
  page?: number;
  page_size?: number;
  keyword?: string;
}

/** 通用 API 响应结构（与后端约定） */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
}

/** 错误显示类型（与 requestErrorConfig 中的枚举对应） */
export enum ErrorShowType {
  SILENT = 0,
  WARN_MESSAGE = 1,
  ERROR_MESSAGE = 2,
  NOTIFICATION = 3,
  REDIRECT = 9,
}

/** 管理员角色信息 */
export interface RoleInfo {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  is_system?: boolean;
  is_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** 权限信息 */
export interface PermissionInfo {
  resource: string;
  action: string;
}

/** 管理员信息 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  roles?: RoleInfo[];
  permissions?: PermissionInfo[];
}
