/**
 * Enum-like constants for RTC Agent Protocol
 *
 * These const objects provide type-safe constants for status fields and other categorical values.
 * They are derived from the OpenAPI specification and exported for use across the codebase.
 *
 * Using const objects with `as const` instead of TypeScript enums ensures:
 * 1. String literal compatibility (values can be used where string literals are expected)
 * 2. Tree-shaking support (unused values are eliminated)
 * 3. Simpler type definitions (no enum nominal type issues)
 */

/** Session lifecycle status */
export const SessionStatus = {
  Active: 'active',
  Closed: 'closed',
  Idle: 'idle',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** Turn execution status */
export const TurnStatus = {
  Pending: 'pending',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Interrupted: 'interrupted',
  Merged: 'merged',
} as const;
export type TurnStatus = (typeof TurnStatus)[keyof typeof TurnStatus];

/** Message author role */
export const MessageRole = {
  User: 'user',
  Assistant: 'assistant',
  Tool: 'tool',
  System: 'system',
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

/** Message streaming lifecycle status */
export const MessageStreamingStatus = {
  Pending: 'pending',
  Streaming: 'streaming',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type MessageStreamingStatus =
  (typeof MessageStreamingStatus)[keyof typeof MessageStreamingStatus];

/** Content type for message data */
export const ContentType = {
  Markdown: 'markdown',
  Summary: 'summary',
  Text: 'text',
  Thinking: 'thinking',
  ToolCallInput: 'toolcall_input',
  ToolCallOutput: 'toolcall_output',
  UserMessage: 'user_message',
  Error: 'error',
  Prompt: 'prompt',
} as const;
export type ContentType = (typeof ContentType)[keyof typeof ContentType];

/** Error classification category */
export const ErrorCategory = {
  Api: 'api',
  Stream: 'stream',
  Tool: 'tool',
  Context: 'context',
  System: 'system',
  Network: 'network',
  Timeout: 'timeout',
  Permission: 'permission',
} as const;
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

/** Remote tool call execution status */
export const RtcStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Executing: 'executing',
  Completed: 'completed',
  Failed: 'failed',
  Timeout: 'timeout',
  Rejected: 'rejected',
} as const;
export type RtcStatus = (typeof RtcStatus)[keyof typeof RtcStatus];

/** Entity type for update events */
export const UpdateEntity = {
  Session: 'session',
  Turn: 'turn',
  Message: 'message',
  Rtc: 'rtc',
  File: 'file',
} as const;
export type UpdateEntity = (typeof UpdateEntity)[keyof typeof UpdateEntity];

/** Action type for update events */
export const UpdateAction = {
  Created: 'created',
  Updated: 'updated',
  Deleted: 'deleted',
} as const;
export type UpdateAction = (typeof UpdateAction)[keyof typeof UpdateAction];

/** Update type (reserved for future use) */
export const UpdateType = {
  Gap: 'gap',
} as const;
export type UpdateType = (typeof UpdateType)[keyof typeof UpdateType];

/** Task item status (aligned with Claude Code TodoItem) */
export const TodoStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
} as const;
export type TodoStatus = (typeof TodoStatus)[keyof typeof TodoStatus];

/** Entity sync status for local persistence (Session/Turn/Message/Rtc) */
export const SyncStatus = {
  Pending: 'pending',
  Synced: 'synced',
  Failed: 'failed',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

/** File sync status lifecycle: pending -> syncing -> synced | failed */
export const FileSyncStatus = {
  Pending: 'pending',
  Syncing: 'syncing',
  Synced: 'synced',
  Failed: 'failed',
} as const;
export type FileSyncStatus =
  (typeof FileSyncStatus)[keyof typeof FileSyncStatus];
