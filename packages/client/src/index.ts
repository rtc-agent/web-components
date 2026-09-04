// @rtc-agent/client —— RTC Agent 通信层

export { RTCAgentClient } from './client.js';
export type {
  IRTCAgentClient,
  RTCAgentClientOptions,
  ConnectionState,
  ConnectionStateEvent,
  StreamChunk,
  StreamStart,
  StreamEnd,
  EventName,
  EventCallback,
  Unsubscribe,
  RTCAgentClientEvents,
  PublicationEvent,
  TokenExpiredAction,
} from './types.js';

// 重新导出 protocol，方便下游一次性 import
export * from '@rtc-agent/protocol';
