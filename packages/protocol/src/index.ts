// RTC Agent Protocol
// 后端与前端共享的协议类型定义（TypeScript 侧）

// openapi-typescript 生成的 OpenAPI 规范类型（paths / components / operations）
export * from './models.gen.js';

import type { components } from './models.gen.js';

// ---------- 手动扩展类型（非自动生成） ----------

export * from './extensions.js';

// ---------- 枚举类型 ----------

export * from './enums.js';

// ---------- 基础类型 ----------

export type UUID = components['schemas']['UUID'];

// ---------- 枚举类型别名（向后兼容） ----------

// 枚举类型已通过 enums.ts 导出，此处保留类型别名以确保向后兼容
// 新代码应直接使用枚举类型，如：import { SessionStatus } from '@rtc-agent/protocol'

/** Error content structure (not an enum, but a composite type) */
export type ErrorContent = components['schemas']['ErrorContent'];

/** RPC method type (string literal union from OpenAPI) */
export type RpcMethod = components['schemas']['RpcMethod'];

/**
 * Runtime RPC method name constants.
 *
 * Provides convenient access to RPC method names as string constants.
 * Use with dot notation: `RPC_METHODS.SessionList`
 *
 * ## Type Safety
 *
 * This uses `as const satisfies Record<string, RpcMethod>` pattern:
 * - `as const` preserves literal types for each property
 * - `satisfies` validates that all values are valid RpcMethod strings
 * - The resulting type is a const object with literal string values
 *
 * This pattern is consistent with the enum definitions in enums.ts.
 *
 * @example
 * ```typescript
 * // Access method name
 * const method = RPC_METHODS.SessionList; // 'v1.session.list'
 *
 * // Use in type-safe context
 * function callRpc(method: RpcMethod) { ... }
 * callRpc(RPC_METHODS.SessionList); // OK
 * ```
 *
 * @remarks
 * This is the runtime value export. For the type definition, see {@link RpcMethod}.
 */
export const RPC_METHODS = {
  // Session
  SessionList: 'v1.session.list',
  SessionGet: 'v1.session.get',
  SessionClose: 'v1.session.close',
  SessionOpen: 'v1.session.open',
  SessionUpdate: 'v1.session.update',
  SessionFork: 'v1.session.fork',
  SessionCompact: 'v1.session.compact',
  // Message
  MessageSend: 'v1.message.send',
  MessageList: 'v1.message.list',
  MessageGet: 'v1.message.get',
  // Turn
  TurnList: 'v1.turn.list',
  TurnGet: 'v1.turn.get',
  TurnStop: 'v1.turn.stop',
  // RTC
  RtcList: 'v1.rtc.list',
  RtcGet: 'v1.rtc.get',
  RtcUpdateStatus: 'v1.rtc.update_status',
  RtcSubmitResult: 'v1.rtc.submit_result',
} as const satisfies Record<string, components['schemas']['RpcMethod']>;

// 域模型
export type Session = components['schemas']['Session'];
export type Turn = components['schemas']['Turn'];
export type Message = components['schemas']['Message'];
export type ContentData = components['schemas']['ContentData'];
export type ToolCall = components['schemas']['ToolCall'];
export type Rtc = components['schemas']['Rtc'];
export type TodoItem = components['schemas']['TodoItem'];
export type UserMessageContent = components['schemas']['UserMessageContent'];
// FileAttachment is exported from extensions.ts with typed FileAttachmentExtra
export type ScenarioRef = components['schemas']['ScenarioRef'];
export type PromptContent = components['schemas']['PromptContent'];

// Update
export type UpdateItem = components['schemas']['UpdateItem'];
export type Update = components['schemas']['Update'];
export type UpdateDataGap = components['schemas']['UpdateDataGap'];

// RPC Action：请求 / 结果 / 响应
// 操作类 RPC 统一响应结构（泛型便利类型）
export interface RpcActionResponse<T> {
  result: T;
  updates?: Update[];
}

export type CloseSessionRequest = components['schemas']['CloseSessionRequest'];
export type CloseSessionResult = components['schemas']['CloseSessionResult'];
export type CloseSessionResponse =
  components['schemas']['CloseSessionResponse'];

export type OpenSessionRequest = components['schemas']['OpenSessionRequest'];
export type OpenSessionResult = components['schemas']['OpenSessionResult'];
export type OpenSessionResponse = components['schemas']['OpenSessionResponse'];

export type UpdateSessionRequest =
  components['schemas']['UpdateSessionRequest'];
export type UpdateSessionResult = components['schemas']['UpdateSessionResult'];
export type UpdateSessionResponse =
  components['schemas']['UpdateSessionResponse'];

export type SendMessageRequest = components['schemas']['SendMessageRequest'];
export type SendMessageResult = components['schemas']['SendMessageResult'];
export type SendMessageResponse = components['schemas']['SendMessageResponse'];

export type ForkSessionRequest = components['schemas']['ForkSessionRequest'];
export type ForkSessionResult = components['schemas']['ForkSessionResult'];
export type ForkSessionResponse = components['schemas']['ForkSessionResponse'];

export type StopTurnRequest = components['schemas']['StopTurnRequest'];
export type StopTurnResult = components['schemas']['StopTurnResult'];
export type StopTurnResponse = components['schemas']['StopTurnResponse'];

export type CompactSessionRequest =
  components['schemas']['CompactSessionRequest'];
export type CompactSessionResult =
  components['schemas']['CompactSessionResult'];
export type CompactSessionResponse =
  components['schemas']['CompactSessionResponse'];

export type UpdateRtcStatusRequest =
  components['schemas']['UpdateRtcStatusRequest'];
export type UpdateRtcStatusResult =
  components['schemas']['UpdateRtcStatusResult'];
export type UpdateRtcStatusResponse =
  components['schemas']['UpdateRtcStatusResponse'];

export type SubmitRtcResultRequest =
  components['schemas']['SubmitRtcResultRequest'];
export type SubmitRtcResultResult =
  components['schemas']['SubmitRtcResultResult'];
export type SubmitRtcResultResponse =
  components['schemas']['SubmitRtcResultResponse'];

// RPC Query：请求 / 响应
export type ListSessionsRequest = components['schemas']['ListSessionsRequest'];
export type ListSessionsResponse =
  components['schemas']['ListSessionsResponse'];

export type GetSessionRequest = components['schemas']['GetSessionRequest'];
export type GetSessionResponse = components['schemas']['GetSessionResponse'];

export type MessageListRequest = components['schemas']['MessageListRequest'];
export type MessageListResponse = components['schemas']['MessageListResponse'];

export type MessageGetRequest = components['schemas']['MessageGetRequest'];
export type MessageGetResponse = components['schemas']['MessageGetResponse'];

export type RtcListRequest = components['schemas']['RtcListRequest'];
export type RtcListResponse = components['schemas']['RtcListResponse'];

export type RtcGetRequest = components['schemas']['RtcGetRequest'];
export type RtcGetResponse = components['schemas']['RtcGetResponse'];

export type TurnListRequest = components['schemas']['TurnListRequest'];
export type TurnListResponse = components['schemas']['TurnListResponse'];

export type TurnGetRequest = components['schemas']['TurnGetRequest'];
export type TurnGetResponse = components['schemas']['TurnGetResponse'];

// ---------- Admin Auth ----------
export type AdminLoginRequest = components['schemas']['AdminLoginRequest'];
export type AdminLoginResponse = components['schemas']['AdminLoginResponse'];
export type AdminRefreshRequest = components['schemas']['AdminRefreshRequest'];
export type AdminRefreshResponse =
  components['schemas']['AdminRefreshResponse'];
export type AdminUserResponse = components['schemas']['AdminUserResponse'];
export type AdminLogoutRequest = components['schemas']['AdminLogoutRequest'];
export type AdminErrorResponse = components['schemas']['AdminErrorResponse'];

// ---------- HTTP / OAuth2 ----------
export type OAuth2AuthorizeResponse =
  components['schemas']['OAuth2AuthorizeResponse'];
export type OAuth2TokenExchangeRequest =
  components['schemas']['OAuth2TokenExchangeRequest'];
export type OAuth2TokenExchangeResponse =
  components['schemas']['OAuth2TokenExchangeResponse'];
export type OAuth2TokenExchangeRFC8693Request =
  components['schemas']['OAuth2TokenExchangeRFC8693Request'];
export type OAuth2TokenExchangeRFC8693Response =
  components['schemas']['OAuth2TokenExchangeRFC8693Response'];
export type OAuth2TokenRefreshRequest =
  components['schemas']['OAuth2TokenRefreshRequest'];
export type OAuth2TokenRefreshResponse =
  components['schemas']['OAuth2TokenRefreshResponse'];
export type OAuth2Error = components['schemas']['OAuth2Error'];

// ---------- RPC 错误码（保留手写常量） ----------

export const RpcErrorCode = {
  // 通用错误 (100-199)
  InvalidRequest: 100,
  InternalError: 101,

  // 幂等性冲突 (200-299)
  /** client_id 已存在，请求被拒绝 */
  ClientIdConflict: 200,
} as const;

export type RpcErrorCode = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];

export interface RpcError {
  code: RpcErrorCode;
  message: string;
}

// ---------- S3 对象存储 ----------

export * from './s3.js';

// ---------- Type Guards ----------

export * from './type-guards.js';

// ---------- Logger ----------

export * from './logger.js';

// ---------- Utils ----------

export * from './utils.js';

// ---------- Utility Types ----------

export * from './utility-types.js';

// ---------- HTTP Types ----------

export * from './http-types.js';
