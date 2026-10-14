/**
 * HTTP Types - Standard API Envelope Types
 *
 * These types define the standard response envelope used by backend APIs.
 * They provide a consistent structure for success and error responses.
 *
 * Note: These are generic HTTP envelope types. Protocol-specific request/response
 * types (e.g., ListSessionsResponse) are defined in models.gen.ts.
 */

/**
 * ApiResponse - Standard API envelope for all backend endpoints
 *
 * Backend APIs return responses in this unified format:
 * - `success`: indicates whether the request was processed successfully
 * - `data`: carries the payload on success
 * - `errorCode`/`errorMessage`: carry diagnostics on failure
 *
 * @example
 * ```typescript
 * // Success response
 * const response: ApiResponse<User> = {
 *   success: true,
 *   data: { id: '123', name: 'Alice' }
 * };
 *
 * // Error response
 * const errorResponse: ApiResponse<never> = {
 *   success: false,
 *   errorCode: 'unauthorized',
 *   errorMessage: 'Invalid credentials'
 * };
 * ```
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
 * ApiErrorResponse - Typed error response structure
 *
 * Use this type when you know the response is an error (success: false).
 * Provides stronger type guarantees than ApiResponse for error handling.
 *
 * @example
 * ```typescript
 * function handleError(response: ApiErrorResponse) {
 *   console.error(`Error ${response.errorCode}: ${response.errorMessage}`);
 * }
 * ```
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
 * PaginatedResponse - Cursor-based pagination response
 *
 * Standard response format for list endpoints with cursor-based pagination.
 * Matches the backend's cursor pagination pattern (e.g., ListSessionsResponse).
 *
 * @example
 * ```typescript
 * interface Session { id: string; title: string }
 * const response: PaginatedResponse<Session> = {
 *   items: [{ id: '1', title: 'Session 1' }],
 *   next_cursor: 'eyJpZCI6IjEifQ=='
 * };
 * ```
 */
export interface PaginatedResponse<T> {
  /** Array of data items for the current page */
  items: T[];
  /** Cursor for the next page (undefined if no more pages) */
  next_cursor?: string;
}

/**
 * PageBasedPaginatedResponse - Page-based pagination response
 *
 * Alternative pagination format using page numbers.
 * Note: The backend primarily uses cursor-based pagination (PaginatedResponse).
 * This type is provided for compatibility with page-based APIs.
 *
 * @example
 * ```typescript
 * interface User { id: string; name: string }
 * const response: PageBasedPaginatedResponse<User> = {
 *   items: [{ id: '1', name: 'Alice' }],
 *   total: 100,
 *   page: 1,
 *   page_size: 20
 * };
 * ```
 */
export interface PageBasedPaginatedResponse<T> {
  /** Array of data items for the current page */
  items: T[];
  /** Total number of items across all pages */
  total: number;
  /** Current page number (1-based) */
  page?: number;
  /** Number of items per page */
  page_size?: number;
}

/**
 * Common pagination query parameters
 *
 * Base interface for list request parameters.
 * Specific request types extend this with additional filters.
 */
export interface PaginationParams {
  /** Cursor for pagination (opaque string from previous response) */
  cursor?: string;
  /** Maximum number of items to return (default: 20, max varies by endpoint) */
  limit?: number;
}

/**
 * Page-based pagination query parameters
 *
 * Alternative to cursor-based pagination for endpoints that support it.
 */
export interface PageBasedPaginationParams {
  /** Page number (1-based) */
  page?: number;
  /** Number of items per page (default: 20) */
  page_size?: number;
}
