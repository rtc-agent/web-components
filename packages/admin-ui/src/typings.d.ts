declare module '*.css';
declare module '*.less';
declare module '*.scss';
declare module '*.sass';
declare module '*.svg';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.bmp';
declare module '*.tiff';
declare module '*.md' {
  const content: string;
  export default content;
}
declare module 'mockjs';

declare const __APP_VERSION__: string;
declare const __UMI_VERSION__: string;
declare const __UTOO_VERSION__: string;

// RBAC 权限系统类型定义
declare namespace API {
  /** 管理员角色信息 */
  interface Role {
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
  interface Permission {
    resource: string;
    action: string;
  }

  /** 当前管理员信息（登录后返回） */
  interface CurrentUser {
    userid?: string;
    name?: string;
    email?: string;
    avatar?: string;
    access?: 'admin' | 'user';
    roles?: Role[];
    permissions?: Set<string>;
  }

  /** 管理员-管理员角色关联 */
  interface UserRole {
    user_id: string;
    role_id: string;
    assigned_at: string;
  }

  /** 审计日志 */
  interface AuditLog {
    id: string;
    operator_id: string;
    operator_name?: string;
    operator_ip?: string;
    event_type: string;
    resource_type: string;
    resource_id?: string;
    details?: Record<string, any>;
    created_at: string;
  }

  /** 分页响应 */
  interface PaginatedResponse<T> {
    items: T[];
    total: number;
  }

  /** 通用响应结构 */
  interface Response<T = any> {
    success: boolean;
    data?: T;
    error_code?: string;
    error_message?: string;
  }

  /** 管理员用户信息 */
  interface AdminUser {
    id: string;
    email: string;
    name: string;
    avatar_url?: string;
    created_at: string;
    updated_at: string;
    roles?: Array<{
      id: string;
      name: string;
      display_name: string;
    }>;
  }
}
