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

// Page API registry — each page registers its API on mount
// Individual page-api.ts files extend PagesRegistry via declaration merging
/** Registry of all page APIs - extend via interface merging */
// biome-ignore lint/suspicious/noEmptyInterface: Interface merging is required for page-api.ts extensions
interface PagesRegistry {}
interface Window {
  __pages__?: PagesRegistry;
}

// RBAC Permission System Type Definitions
declare namespace API {
  /** Admin role information */
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

  /** Permission information */
  interface Permission {
    resource: string;
    action: string;
  }

  /** Current admin information (returned after login) */
  interface CurrentUser {
    userid?: string;
    name?: string;
    email?: string;
    avatar?: string;
    access?: 'admin' | 'user';
    roles?: Role[];
    permissions?: Set<string>;
  }

  /** Admin-to-admin role association */
  interface UserRole {
    user_id: string;
    role_id: string;
    assigned_at: string;
  }

  /** Audit log */
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

  /** Paginated response */
  interface PaginatedResponse<T> {
    items: T[];
    total: number;
  }

  /** Generic response structure */
  interface Response<T = any> {
    success: boolean;
    data?: T;
    error_code?: string;
    error_message?: string;
  }

  /** Admin user information */
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
