// RTC Agent Protocol
// 后端与前端共享的协议类型定义（TypeScript 侧）

// openapi-typescript 生成的 OpenAPI 规范类型（paths / components / operations）
export * from './models.gen.js';

import type {components} from './models.gen.js';

// ---------- 将 components.schemas 下的所有类型重新导出为扁平名称 ----------
// 保持与旧版手写 TS 的导入兼容：`import { Session } from '@rtc-agent/protocol'`

export type UUID = components['schemas']['UUID'];

// 枚举
export type SessionStatus = components['schemas']['SessionStatus'];
export type TurnStatus = components['schemas']['TurnStatus'];
export type MessageRole = components['schemas']['MessageRole'];
export type MessageStreamingStatus = components['schemas']['MessageStreamingStatus'];
export type ContentType = components['schemas']['ContentType'];
export type RtcStatus = components['schemas']['RtcStatus'];
export type UpdateEntity = components['schemas']['UpdateEntity'];
export type UpdateAction = components['schemas']['UpdateAction'];
export type UpdateType = components['schemas']['UpdateType'];
export type RpcMethod = components['schemas']['RpcMethod'];

/** RPC 方法名常量（命名空间对象，供 `RpcMethod.SessionList` 形式访问） */
export const RpcMethod = {
    // Session
    SessionList: 'v1.session.list',
    SessionGet: 'v1.session.get',
    SessionClose: 'v1.session.close',
    SessionUpdate: 'v1.session.update',
    SessionFork: 'v1.session.fork',
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
} as const;

// 域模型
export type Session = components['schemas']['Session'];
export type Turn = components['schemas']['Turn'];
export type Message = components['schemas']['Message'];
export type ContentData = components['schemas']['ContentData'];
export type ToolCall = components['schemas']['ToolCall'];
export type Rtc = components['schemas']['Rtc'];

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
export type CloseSessionResponse = components['schemas']['CloseSessionResponse'];

export type UpdateSessionRequest = components['schemas']['UpdateSessionRequest'];
export type UpdateSessionResult = components['schemas']['UpdateSessionResult'];
export type UpdateSessionResponse = components['schemas']['UpdateSessionResponse'];

export type SendMessageRequest = components['schemas']['SendMessageRequest'];
export type SendMessageResult = components['schemas']['SendMessageResult'];
export type SendMessageResponse = components['schemas']['SendMessageResponse'];

export type ForkSessionRequest = components['schemas']['ForkSessionRequest'];
export type ForkSessionResult = components['schemas']['ForkSessionResult'];
export type ForkSessionResponse = components['schemas']['ForkSessionResponse'];

export type StopTurnRequest = components['schemas']['StopTurnRequest'];
export type StopTurnResult = components['schemas']['StopTurnResult'];
export type StopTurnResponse = components['schemas']['StopTurnResponse'];

export type UpdateRtcStatusRequest = components['schemas']['UpdateRtcStatusRequest'];
export type UpdateRtcStatusResult = components['schemas']['UpdateRtcStatusResult'];
export type UpdateRtcStatusResponse = components['schemas']['UpdateRtcStatusResponse'];

export type SubmitRtcResultRequest = components['schemas']['SubmitRtcResultRequest'];
export type SubmitRtcResultResult = components['schemas']['SubmitRtcResultResult'];
export type SubmitRtcResultResponse = components['schemas']['SubmitRtcResultResponse'];

// RPC Query：请求 / 响应export type ListSessionsRequest = components['schemas']['ListSessionsRequest'];
export type ListSessionsResponse = components['schemas']['ListSessionsResponse'];

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

// HTTP / OAuth2
export type OAuth2AuthorizeResponse = components['schemas']['OAuth2AuthorizeResponse'];
export type OAuth2TokenExchangeRequest = components['schemas']['OAuth2TokenExchangeRequest'];
export type OAuth2TokenExchangeResponse = components['schemas']['OAuth2TokenExchangeResponse'];
export type OAuth2TokenRefreshRequest = components['schemas']['OAuth2TokenRefreshRequest'];
export type OAuth2TokenRefreshResponse = components['schemas']['OAuth2TokenRefreshResponse'];
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
