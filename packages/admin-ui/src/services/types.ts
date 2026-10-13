/**
 * 服务层通用类型定义
 * 用于在多个服务文件之间共享的类型
 */

/**
 * Standard paginated API response.
 * Used by list endpoints to wrap result arrays with pagination metadata.
 */
export interface PaginatedResponse<T> {
  /** Array of data items for the current page */
  items: T[];
  /** Total number of items across all pages */
  total: number;
  /** Current page number (1-based) */
  page?: number;
  /** Number of items per page */
  page_size?: number;
}

/** Common pagination query parameters for list requests */
export interface PaginatedRequest {
  /** Page number (1-based) */
  page?: number;
  /** Items per page */
  page_size?: number;
  /** Fuzzy search keyword */
  keyword?: string;
}

/**
 * Unified API envelope returned by all backend endpoints.
 * Convention: `success` indicates whether the request was processed;
 * `data` carries the payload on success; `errorCode`/`errorMessage`
 * carry diagnostics on failure.
 */
export interface ApiResponse<T = unknown> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response payload (present when success is true) */
  data?: T;
  /** Machine-readable error code (present when success is false) */
  errorCode?: string;
  /** Human-readable error message (present when success is false) */
  errorMessage?: string;
}

/**
 * Standard error response structure from backend.
 * Used for type-safe error handling in service layer.
 */
export interface ApiErrorResponse {
  /** Always false for error responses */
  success: false;
  /** Machine-readable error code for programmatic handling */
  errorCode: string;
  /** Human-readable error message for display */
  errorMessage: string;
  /** Optional additional error details (validation errors, etc.) */
  details?: Record<string, unknown>;
}

/**
 * Common error codes returned by backend.
 * Use for type-safe error code comparisons.
 */
export const ApiErrorCodes = {
  /** Invalid or missing authentication token */
  UNAUTHORIZED: 'unauthorized',
  /** Insufficient permissions for requested action */
  FORBIDDEN: 'forbidden',
  /** Requested resource not found */
  NOT_FOUND: 'not_found',
  /** Request validation failed */
  VALIDATION_ERROR: 'validation_error',
  /** Internal server error */
  INTERNAL_ERROR: 'internal_error',
  /** Request rate limit exceeded */
  RATE_LIMITED: 'rate_limited',
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];

/**
 * Error display modes, aligned with the enum in requestErrorConfig.
 * Controls how request errors are surfaced to the user.
 */
export enum ErrorShowType {
  /** Suppress all error output */
  SILENT = 0,
  /** Show a toast message */
  WARN_MESSAGE = 1,
  /** Show a modal error dialog */
  ERROR_MESSAGE = 2,
  /** Show an antd notification */
  NOTIFICATION = 3,
  /** Redirect to another page (e.g. login) */
  REDIRECT = 9,
}

/**
 * Admin role definition.
 * Note: This type mirrors the backend Role entity. If backend schema changes,
 * regenerate types via `pnpm run openapi` or update manually to match.
 * Last synced with backend schema: 2026-10-13
 */
export interface RoleInfo {
  /** Unique role identifier */
  id: string;
  /** Internal role name (e.g. "admin") */
  name: string;
  /** Human-readable display name */
  display_name: string;
  /** Role description */
  description?: string;
  /** Whether this is a built-in system role (cannot be deleted) */
  is_system?: boolean;
  /** Whether the role is currently enabled */
  is_enabled?: boolean;
  /** Creation timestamp (ISO 8601) */
  created_at?: string;
  /** Last update timestamp (ISO 8601) */
  updated_at?: string;
}

/**
 * A single permission entry: which resource can perform which action.
 * Example: { resource: "rtc_user", action: "read" }
 */
export interface PermissionInfo {
  /** Resource type being protected (e.g. "rtc_user", "admin_user") */
  resource: string;
  /** Allowed action (e.g. "read", "write", "delete", "ban") */
  action: string;
}

/** Authenticated admin user information */
export interface UserInfo {
  /** Unique user identifier */
  id: string;
  /** Admin email address (used for login) */
  email: string;
  /** Display name */
  name: string;
  /** URL to avatar image */
  avatar_url?: string;
  /**
   * Roles assigned to this admin.
   * Returned by: GET /api/auth/me, GET /api/auth/login (in user field)
   * Not returned by: lightweight endpoints that only need basic user info
   */
  roles?: RoleInfo[];
  /**
   * Aggregated permissions from all assigned roles.
   * Returned by: GET /api/auth/me (after role resolution)
   * Note: This is a computed field based on roles, not stored directly.
   * If roles change, permissions will be recalculated on next auth request.
   */
  permissions?: PermissionInfo[];
}
