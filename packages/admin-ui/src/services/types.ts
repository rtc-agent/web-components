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
  /** Error display mode (controls how errors are surfaced to user) */
  showType?: ErrorShowType;
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
  /** Optimistic lock conflict (version mismatch) */
  CONFLICT: 'conflict',
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];

/**
 * Single field validation error detail.
 * Returned when errorCode is VALIDATION_ERROR.
 */
export interface ValidationErrorItem {
  /** The field that failed validation (e.g. "name", "email") */
  field: string;
  /** Machine-readable rule identifier (e.g. "required", "pattern", "max") */
  rule: string;
  /** Human-readable error message for display */
  message: string;
  /** The rejected value, if available */
  rejected_value?: unknown;
}

/**
 * Validation error response shape.
 * Returned when request data fails server-side validation.
 */
export interface ApiValidationError extends ApiErrorResponse {
  errorCode: typeof ApiErrorCodes.VALIDATION_ERROR;
  /** Array of per-field validation failures */
  details: {
    errors: ValidationErrorItem[];
  };
}

/**
 * Optimistic lock conflict response shape.
 * Returned when an update is attempted with a stale version.
 * The caller should re-fetch the latest version and retry or surface
 * the conflict to the user for explicit resolution.
 */
export interface ApiConflictError extends ApiErrorResponse {
  errorCode: typeof ApiErrorCodes.CONFLICT;
  /** Additional context about the conflict */
  details: {
    /** The key/identifier of the conflicting resource */
    key: string;
    /** The version the client submitted (stale) */
    client_version: number;
    /** The current version on the server */
    server_version: number;
  };
}

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
