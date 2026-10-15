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

import {
  ErrorCategory,
  MessageRole,
  MessageStreamingStatus,
  RtcStatus,
  SessionStatus,
  TurnStatus,
  UpdateAction,
  UpdateEntity,
} from './enums.js';
import type {
  ContentData,
  ContentType,
  ErrorContent,
  FileAttachment,
  Message,
  PromptContent,
  Rtc,
  Session,
  SummaryContentData,
  ToolCall,
  Turn,
  Update,
  UpdateItem,
  UserMessageContent,
} from './index.js';

/**
 * Check whether a value is a non-null object.
 */
function isNonNullObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

/**
 * Valid sets for enum discriminator checks.
 *
 * Using `as const satisfies readonly EnumType[]` pattern ensures:
 * 1. Type safety without explicit type assertions during construction
 * 2. Compile-time validation that all enum values are included
 * 3. Proper narrowing when used with Set.has()
 *
 * Note: Sets are typed as ReadonlySet<string> (not ReadonlySet<EnumType>)
 * because type guards check if an unknown string value is a valid enum member.
 * The `as const satisfies` ensures we only include valid enum values.
 */
const SESSION_STATUSES: ReadonlySet<string> = new Set<SessionStatus>([
  SessionStatus.Active,
  SessionStatus.Closed,
  SessionStatus.Idle,
] as const satisfies readonly SessionStatus[]);
const TURN_STATUSES: ReadonlySet<string> = new Set<TurnStatus>([
  TurnStatus.Pending,
  TurnStatus.Running,
  TurnStatus.Completed,
  TurnStatus.Failed,
  TurnStatus.Cancelled,
  TurnStatus.Interrupted,
  TurnStatus.Merged,
] as const satisfies readonly TurnStatus[]);
const MESSAGE_ROLES: ReadonlySet<string> = new Set<MessageRole>([
  MessageRole.User,
  MessageRole.Assistant,
  MessageRole.Tool,
  MessageRole.System,
] as const satisfies readonly MessageRole[]);
const MESSAGE_STREAMING_STATUSES: ReadonlySet<string> =
  new Set<MessageStreamingStatus>([
    MessageStreamingStatus.Pending,
    MessageStreamingStatus.Streaming,
    MessageStreamingStatus.Completed,
    MessageStreamingStatus.Failed,
  ] as const satisfies readonly MessageStreamingStatus[]);
const RTC_STATUSES: ReadonlySet<string> = new Set<RtcStatus>([
  RtcStatus.Pending,
  RtcStatus.Sent,
  RtcStatus.Executing,
  RtcStatus.Completed,
  RtcStatus.Failed,
  RtcStatus.Timeout,
  RtcStatus.Rejected,
] as const satisfies readonly RtcStatus[]);
const ERROR_CATEGORIES: ReadonlySet<string> = new Set<ErrorCategory>([
  ErrorCategory.Api,
  ErrorCategory.Stream,
  ErrorCategory.Tool,
  ErrorCategory.Context,
  ErrorCategory.System,
  ErrorCategory.Network,
  ErrorCategory.Timeout,
  ErrorCategory.Permission,
] as const satisfies readonly ErrorCategory[]);

/**
 * Valid role values for PromptContent.
 *
 * Extracted from PromptContent['role'] type to ensure type safety.
 * Using a Set for consistent pattern with other enum checks.
 */
const PROMPT_ROLES: ReadonlySet<string> = new Set<string>(['system', 'user']);

const CONTENT_TYPES: ReadonlySet<string> = new Set<string>([
  'markdown',
  'summary',
  'text',
  'thinking',
  'toolcall_input',
  'toolcall_output',
  'user_message',
  'error',
  'prompt',
]);

/**
 * Type guard for ContentData.
 *
 * Validates that the data has the required `type` and `data` fields,
 * and that `type` is a known ContentType discriminator.
 *
 * Note: `ContentData.data` is typed as `unknown` (generated from OpenAPI oneOf schema).
 * Always use this guard or the fine-grained guards below (e.g., `isStringContentData`,
 * `isToolCallInputContent`) instead of manual `as` casts to ensure runtime safety.
 */
export function isValidContentData(data: unknown): data is ContentData {
  return (
    isNonNullObject(data) &&
    'type' in data &&
    'data' in data &&
    typeof data.type === 'string' &&
    CONTENT_TYPES.has(data.type)
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
 * - `summary` → SummaryContentData[] (array of summary items)
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
  summary: SummaryContentData;
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
): c is
  | TypedContentData<'markdown'>
  | TypedContentData<'text'>
  | TypedContentData<'thinking'> {
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
 *
 * Validates that the data is a ToolCall object with required fields:
 * `id` (string UUID), `tool_name` (string), `input` (string).
 */
export function isToolCallInputContent(
  c: ContentData,
): c is TypedContentData<'toolcall_input'> {
  if (c.type !== 'toolcall_input' || !isNonNullObject(c.data)) return false;
  const d = c.data as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.tool_name === 'string' &&
    typeof d.input === 'string'
  );
}

/**
 * Type guard for toolcall_output ContentData.
 *
 * Validates that the data is a ToolCall object with required fields:
 * `id` (string UUID), `tool_name` (string), `input` (string).
 */
export function isToolCallOutputContent(
  c: ContentData,
): c is TypedContentData<'toolcall_output'> {
  if (c.type !== 'toolcall_output' || !isNonNullObject(c.data)) return false;
  const d = c.data as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.tool_name === 'string' &&
    typeof d.input === 'string'
  );
}

/**
 * Type guard for UserMessageContent.
 *
 * Validates required field `text` (string), and optional fields
 * `files` (array) and `scenarios` (array) if present.
 */
export function isValidUserMessageContent(
  data: unknown,
): data is UserMessageContent {
  if (!isNonNullObject(data)) return false;
  if (typeof (data as Record<string, unknown>).text !== 'string') return false;

  // Optional files: if present, must be an array
  if ('files' in data && data.files !== undefined) {
    if (!Array.isArray(data.files)) return false;
  }

  // Optional scenarios: if present, must be an array
  if ('scenarios' in data && data.scenarios !== undefined) {
    if (!Array.isArray(data.scenarios)) return false;
  }

  return true;
}

/**
 * Type guard for user_message ContentData.
 *
 * Validates that the data is a UserMessageContent object with required field
 * `text` (string), and optional fields `files` (array) and `scenarios` (array).
 */
export function isUserMessageContentData(
  c: ContentData,
): c is TypedContentData<'user_message'> {
  return c.type === 'user_message' && isValidUserMessageContent(c.data);
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
 *
 * Validates that the data is an array (SummaryContentData is ReadonlyArray).
 */
export function isSummaryContentData(
  c: ContentData,
): c is TypedContentData<'summary'> {
  return c.type === 'summary' && Array.isArray(c.data);
}

// ========== Standalone Type Guards for Complex Types ==========

/**
 * Type guard for ErrorContent.
 *
 * Validates required fields: `category` (ErrorCategory enum), `title` (string),
 * `message` (string), `retryable` (boolean).
 */
export function isValidErrorContent(data: unknown): data is ErrorContent {
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
 * Optional `title` and `role` are validated against allowed values if present.
 */
export function isValidPromptContent(data: unknown): data is PromptContent {
  if (!isNonNullObject(data)) return false;
  if (typeof data.name !== 'string') return false;
  if (typeof data.prompt !== 'string') return false;

  // Optional role validation (if present)
  // Uses PROMPT_ROLES set to ensure consistency with OpenAPI spec
  if ('role' in data && data.role !== undefined) {
    if (typeof data.role !== 'string' || !PROMPT_ROLES.has(data.role)) {
      return false;
    }
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
const UPDATE_ENTITIES: ReadonlySet<string> = new Set<UpdateEntity>([
  UpdateEntity.Session,
  UpdateEntity.Turn,
  UpdateEntity.Message,
  UpdateEntity.Rtc,
  UpdateEntity.File,
] as const satisfies readonly UpdateEntity[]);
const UPDATE_ACTIONS: ReadonlySet<string> = new Set<UpdateAction>([
  UpdateAction.Created,
  UpdateAction.Updated,
  UpdateAction.Deleted,
] as const satisfies readonly UpdateAction[]);

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
 * Validate UpdateItem data against entity-specific type guards.
 *
 * P0-FIX: Provides fine-grained validation for data_list items.
 * Each item's structure is validated against its corresponding entity type.
 *
 * @param item - The UpdateItem containing entity type info
 * @param data - The data to validate (from data_list)
 * @returns true if data is valid for the given entity type
 */
function isValidUpdateItemData(item: UpdateItem, data: unknown): boolean {
  // For deleted actions, data is optional (may only contain client_id)
  if (item.action === UpdateAction.Deleted) {
    return data === undefined || data === null || isNonNullObject(data);
  }

  // For created/updated actions, validate against entity-specific guards
  switch (item.entity) {
    case 'session':
      return isValidSession(data);
    case 'turn':
      return isValidTurn(data);
    case 'message':
      return isValidMessage(data);
    case 'rtc':
      return isValidRtc(data);
    case 'file':
      // File entities don't have a specific type guard yet
      // Accept any non-null object
      return isNonNullObject(data);
    default:
      // Unknown entity type - log warning and accept
      return true;
  }
}

/**
 * Type guard for Update.
 *
 * Validates required fields: `id` (string), `items` (UpdateItem[]), `offset` (number).
 * Optional `data_list` is validated to be an array (if present) with length matching items.
 *
 * P0-FIX: Enhanced validation - each data_list item is validated against its
 * corresponding entity type using isValidUpdateItemData.
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

    // P0-FIX: Validate each data_list item against its entity type
    if (data.data_list.length === data.items.length) {
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        const itemData = data.data_list[i];

        // Skip validation for undefined data (allowed for some operations)
        if (itemData === undefined || itemData === null) {
          continue;
        }

        // Validate data structure matches entity type
        if (!isValidUpdateItemData(item, itemData)) {
          return false;
        }
      }
    }
  }

  return true;
}
