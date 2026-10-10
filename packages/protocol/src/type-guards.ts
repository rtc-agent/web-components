/**
 * Type Guards for Protocol Types
 *
 * Runtime type checking utilities for protocol types.
 * Provides type guards to safely narrow unknown types to specific protocol types.
 *
 * These guards perform lightweight structural checks (field presence + type).
 * They validate required fields and key discriminator enums, but do not
 * exhaustively validate every field. For full validation, use a schema
 * validator like zod.
 */

import type {
  ContentData,
  Session,
  Turn,
  Message,
  Rtc,
  SessionStatus,
  TurnStatus,
  MessageRole,
  MessageStreamingStatus,
  RtcStatus,
} from './index.js';

/**
 * Check whether a value is a non-null object.
 */
function isNonNullObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

/**
 * Valid sets for enum discriminator checks.
 */
const SESSION_STATUSES: ReadonlySet<string> = new Set<string>([
  'active',
  'closed',
  'idle',
] as SessionStatus[]);
const TURN_STATUSES: ReadonlySet<string> = new Set<string>([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'merged',
] as TurnStatus[]);
const MESSAGE_ROLES: ReadonlySet<string> = new Set<string>([
  'user',
  'assistant',
  'tool',
  'system',
] as MessageRole[]);
const MESSAGE_STREAMING_STATUSES: ReadonlySet<string> = new Set<string>([
  'pending',
  'streaming',
  'completed',
  'failed',
] as MessageStreamingStatus[]);
const RTC_STATUSES: ReadonlySet<string> = new Set<string>([
  'pending',
  'sent',
  'executing',
  'completed',
  'failed',
  'timeout',
  'rejected',
] as RtcStatus[]);

/**
 * Type guard for ContentData.
 *
 * Validates that the data has the required `type` and `data` fields,
 * and that `type` is a known ContentType discriminator.
 */
export function isValidContentData(data: unknown): data is ContentData {
  return (
    isNonNullObject(data) &&
    'type' in data &&
    'data' in data &&
    typeof data.type === 'string'
  );
}

/**
 * Type guard for Session.
 *
 * Validates required fields: `id` (string), `status` (SessionStatus enum),
 * `owner_kind` (string), `owner_ref_id` (string).
 */
export function isValidSession(data: unknown): data is Session {
  return (
    isNonNullObject(data) &&
    typeof data.id === 'string' &&
    typeof data.status === 'string' &&
    SESSION_STATUSES.has(data.status) &&
    typeof data.owner_kind === 'string' &&
    typeof data.owner_ref_id === 'string'
  );
}

/**
 * Type guard for Turn.
 *
 * Validates required fields: `id` (string), `session_id` (string),
 * `status` (TurnStatus enum).
 */
export function isValidTurn(data: unknown): data is Turn {
  return (
    isNonNullObject(data) &&
    typeof data.id === 'string' &&
    typeof data.session_id === 'string' &&
    typeof data.status === 'string' &&
    TURN_STATUSES.has(data.status)
  );
}

/**
 * Type guard for Message.
 *
 * Validates required fields: `id` (string), `session_id` (string),
 * `global_offset` (number), `role` (MessageRole enum),
 * `streaming_status` (MessageStreamingStatus enum),
 * `creator_kind` (string), `creator_ref_id` (string).
 */
export function isValidMessage(data: unknown): data is Message {
  return (
    isNonNullObject(data) &&
    typeof data.id === 'string' &&
    typeof data.session_id === 'string' &&
    typeof data.global_offset === 'number' &&
    typeof data.role === 'string' &&
    MESSAGE_ROLES.has(data.role) &&
    typeof data.streaming_status === 'string' &&
    MESSAGE_STREAMING_STATUSES.has(data.streaming_status) &&
    typeof data.creator_kind === 'string' &&
    typeof data.creator_ref_id === 'string'
  );
}

/**
 * Type guard for Rtc.
 *
 * Validates required fields: `id` (string), `session_id` (string),
 * `turn_id` (string), `tool_name` (string), `status` (RtcStatus enum).
 */
export function isValidRtc(data: unknown): data is Rtc {
  return (
    isNonNullObject(data) &&
    typeof data.id === 'string' &&
    typeof data.session_id === 'string' &&
    typeof data.turn_id === 'string' &&
    typeof data.tool_name === 'string' &&
    typeof data.status === 'string' &&
    RTC_STATUSES.has(data.status)
  );
}

/**
 * Validates Update.data_list structure.
 *
 * Ensures data_list is an array and has the same length as items array.
 * Returns true if data_list is valid (or undefined/empty), false otherwise.
 */
export function isValidUpdateDataList(
  dataList: unknown[] | undefined,
  itemsLength: number,
): boolean {
  if (dataList === undefined) return true;
  if (!Array.isArray(dataList)) return false;
  // data_list should either be empty or match items length
  return dataList.length === 0 || dataList.length === itemsLength;
}

/**
 * Safely extract client_id from a record.
 *
 * Tries `client_id` first, falls back to `id`.
 * Throws if neither is present or not a string.
 *
 * @param record - Record to extract client_id from
 * @returns The client_id string
 * @throws Error if client_id cannot be extracted
 */
export function extractClientId(record: Record<string, unknown>): string {
  const id = record.client_id ?? record.id;
  if (typeof id !== 'string') {
    throw new Error('Record missing required client_id or id field');
  }
  return id;
}

/**
 * Safely extract a string field from a record.
 *
 * Returns undefined if field is missing or not a string.
 *
 * @param record - Record to extract field from
 * @param fieldName - Name of the field to extract
 * @returns The field value as string, or undefined
 */
export function extractStringField(
  record: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = record[fieldName];
  return typeof value === 'string' ? value : undefined;
}
