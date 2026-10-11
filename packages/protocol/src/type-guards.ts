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
  Update,
  UpdateItem,
  SessionStatus,
  TurnStatus,
  MessageRole,
  MessageStreamingStatus,
  RtcStatus,
  ContentType,
  ToolCall,
  UserMessageContent,
  ErrorContent,
  PromptContent,
  FileAttachment,
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

// ========== ContentData Type Map & Fine-grained Guards ==========

/**
 * Maps each ContentType discriminator to the concrete type of its `data` field.
 *
 * This eliminates the need for unsafe `as` casts when accessing ContentData.data.
 * Use with TypedContentData<T> or the individual type guards below.
 *
 * Type mapping (from OpenAPI spec):
 * - `markdown` → string
 * - `summary` → SummaryContentData (object with optional items/metadata)
 * - `text` → string
 * - `thinking` → string
 * - `toolcall_input` → ToolCall
 * - `toolcall_output` → ToolCall
 * - `user_message` → UserMessageContent
 * - `error` → ErrorContent
 * - `prompt` → PromptContent
 */
export interface ContentDataTypeMap {
  markdown: string;
  summary: unknown;
  text: string;
  thinking: string;
  toolcall_input: ToolCall;
  toolcall_output: ToolCall;
  user_message: UserMessageContent;
  error: ErrorContent;
  prompt: PromptContent;
}

/**
 * A ContentData narrowed to a specific `type` discriminator.
 *
 * Usage:
 * ```typescript
 * const md: TypedContentData<'markdown'> = { type: 'markdown', data: '# Hello' };
 * // md.data is string
 * ```
 */
export type TypedContentData<T extends ContentType> = {
  type: T;
  data: ContentDataTypeMap[T];
};

/**
 * Type guard for string-based ContentData (markdown, text, thinking).
 */
export function isStringContentData(
  c: ContentData,
): c is TypedContentData<'markdown'> | TypedContentData<'text'> | TypedContentData<'thinking'> {
  return (
    (c.type === 'markdown' || c.type === 'text' || c.type === 'thinking') &&
    typeof c.data === 'string'
  );
}

/**
 * Type guard for markdown ContentData.
 */
export function isMarkdownContent(
  c: ContentData,
): c is TypedContentData<'markdown'> {
  return c.type === 'markdown' && typeof c.data === 'string';
}

/**
 * Type guard for text ContentData.
 */
export function isTextContent(c: ContentData): c is TypedContentData<'text'> {
  return c.type === 'text' && typeof c.data === 'string';
}

/**
 * Type guard for thinking ContentData.
 */
export function isThinkingContent(
  c: ContentData,
): c is TypedContentData<'thinking'> {
  return c.type === 'thinking' && typeof c.data === 'string';
}

/**
 * Type guard for toolcall_input ContentData.
 */
export function isToolCallInputContent(
  c: ContentData,
): c is TypedContentData<'toolcall_input'> {
  return c.type === 'toolcall_input' && isNonNullObject(c.data);
}

/**
 * Type guard for toolcall_output ContentData.
 */
export function isToolCallOutputContent(
  c: ContentData,
): c is TypedContentData<'toolcall_output'> {
  return c.type === 'toolcall_output' && isNonNullObject(c.data);
}

/**
 * Type guard for user_message ContentData.
 */
export function isUserMessageContentData(
  c: ContentData,
): c is TypedContentData<'user_message'> {
  return (
    c.type === 'user_message' &&
    isNonNullObject(c.data) &&
    typeof (c.data as Record<string, unknown>).text === 'string'
  );
}

/**
 * Type guard for error ContentData.
 */
export function isErrorContentData(
  c: ContentData,
): c is TypedContentData<'error'> {
  return (
    c.type === 'error' &&
    isNonNullObject(c.data) &&
    typeof (c.data as Record<string, unknown>).category === 'string' &&
    typeof (c.data as Record<string, unknown>).title === 'string' &&
    typeof (c.data as Record<string, unknown>).message === 'string' &&
    typeof (c.data as Record<string, unknown>).retryable === 'boolean'
  );
}

/**
 * Type guard for prompt ContentData.
 */
export function isPromptContentData(
  c: ContentData,
): c is TypedContentData<'prompt'> {
  return (
    c.type === 'prompt' &&
    isNonNullObject(c.data) &&
    typeof (c.data as Record<string, unknown>).name === 'string' &&
    typeof (c.data as Record<string, unknown>).prompt === 'string'
  );
}

/**
 * Type guard for summary ContentData.
 */
export function isSummaryContentData(
  c: ContentData,
): c is TypedContentData<'summary'> {
  return c.type === 'summary' && isNonNullObject(c.data);
}

// ========== Standalone Type Guards for Complex Types ==========

/**
 * Type guard for ErrorContent.
 *
 * Validates required fields: `category` (ErrorCategory enum), `title` (string),
 * `message` (string), `retryable` (boolean).
 */
export function isValidErrorContent(data: unknown): data is ErrorContent {
  const ERROR_CATEGORIES: ReadonlySet<string> = new Set<string>([
    'api',
    'stream',
    'tool',
    'context',
    'system',
    'network',
    'timeout',
    'permission',
  ]);

  return (
    isNonNullObject(data) &&
    typeof data.category === 'string' &&
    ERROR_CATEGORIES.has(data.category) &&
    typeof data.title === 'string' &&
    typeof data.message === 'string' &&
    typeof data.retryable === 'boolean'
  );
}

/**
 * Type guard for PromptContent.
 *
 * Validates required fields: `name` (string), `prompt` (string).
 * Optional `title` and `role` are not validated unless present.
 */
export function isValidPromptContent(data: unknown): data is PromptContent {
  if (!isNonNullObject(data)) return false;
  if (typeof data.name !== 'string') return false;
  if (typeof data.prompt !== 'string') return false;

  // Optional role validation (if present)
  if ('role' in data && data.role !== undefined) {
    if (data.role !== 'system' && data.role !== 'user') return false;
  }

  return true;
}

/**
 * Type guard for FileAttachment.
 *
 * Validates required fields: `mimetype` (string), `fileid` (string).
 * Optional `extra` is validated to be an object if present.
 */
export function isValidFileAttachment(data: unknown): data is FileAttachment {
  if (!isNonNullObject(data)) return false;
  if (typeof data.mimetype !== 'string') return false;
  if (typeof data.fileid !== 'string') return false;

  // Optional extra validation (if present)
  if ('extra' in data && data.extra !== undefined) {
    if (!isNonNullObject(data.extra)) return false;
  }

  return true;
}

// ========== Update Type Guard ==========

/**
 * Valid sets for Update discriminator checks.
 */
const UPDATE_ENTITIES: ReadonlySet<string> = new Set<string>([
  'session',
  'turn',
  'message',
  'rtc',
  'file',
]);
const UPDATE_ACTIONS: ReadonlySet<string> = new Set<string>([
  'created',
  'updated',
  'deleted',
]);

/**
 * Type guard for UpdateItem.
 *
 * Validates required fields: `entity` (UpdateEntity enum), `action` (UpdateAction enum),
 * `entity_id` (string UUID).
 */
export function isValidUpdateItem(data: unknown): data is UpdateItem {
  return (
    isNonNullObject(data) &&
    typeof data.entity === 'string' &&
    UPDATE_ENTITIES.has(data.entity) &&
    typeof data.action === 'string' &&
    UPDATE_ACTIONS.has(data.action) &&
    typeof data.entity_id === 'string'
  );
}

/**
 * Type guard for Update.
 *
 * Validates required fields: `id` (string), `items` (UpdateItem[]), `offset` (number).
 * Optional `data_list` is validated to be an array (if present) with length matching items.
 */
export function isValidUpdate(data: unknown): data is Update {
  if (!isNonNullObject(data)) return false;
  if (typeof data.id !== 'string') return false;
  if (typeof data.offset !== 'number') return false;
  if (!Array.isArray(data.items)) return false;

  // Validate each item in the items array
  for (const item of data.items) {
    if (!isValidUpdateItem(item)) return false;
  }

  // Optional data_list: if present, must be an array with matching length
  if ('data_list' in data && data.data_list !== undefined) {
    if (!Array.isArray(data.data_list)) return false;
    if (
      data.data_list.length !== 0 &&
      data.data_list.length !== data.items.length
    ) {
      return false;
    }
  }

  return true;
}
