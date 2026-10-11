/**
 * Session types - imported from protocol package
 * @rtc-agent/protocol provides the canonical Session type definition
 */
import type { Session } from '@rtc-agent/protocol';

/**
 * Session information (alias for protocol Session type)
 * Using protocol type ensures consistency with backend API
 */
export type SessionInfo = Session;

/**
 * Session list response
 * Admin-server specific pagination wrapper
 */
export type SessionListResponse = {
  items: SessionInfo[];
  total: number;
  page: number;
  page_size: number;
};
