/**
 * Message types - imported from protocol package
 * @rtc-agent/protocol provides the canonical Message type definition
 */
import type {
  Message,
  MessageRole as ProtocolMessageRole,
} from '@rtc-agent/protocol';

/**
 * Message role type (re-exported from protocol for convenience)
 */
export type MessageRole = ProtocolMessageRole;

/**
 * Message information (alias for protocol Message type)
 * Using protocol type ensures consistency with backend API
 */
export type MessageInfo = Message;

/**
 * Message list response
 * Admin-server specific pagination wrapper
 */
export type MessageListResponse = {
  items: MessageInfo[];
  total: number;
  page: number;
  page_size: number;
};
