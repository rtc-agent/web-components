// @rtc-agent/client — Communication layer for RTC Agent

export { RTCAgentClient } from './client.js';
export { OAuth2Client } from './oauth2-client.js';
export { createLogger, setGlobalLogLevel } from './logger.js';
export type { Logger, LogLevel } from './logger.js';
export type { OAuth2ClientOptions, OAuth2ProvidersResponse } from './oauth2-client.js';
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

// Re-export protocol for downstream single-import convenience.
export * from '@rtc-agent/protocol';
