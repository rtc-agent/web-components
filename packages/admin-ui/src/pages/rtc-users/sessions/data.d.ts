/**
 * Session status
 */
export type SessionStatus = 'active' | 'closed';

/**
 * Session information
 */
export type SessionInfo = {
  id: string;
  client_id: string;
  title: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cached_read_tokens: number;
  total_cost_micros: number;
};

/**
 * Session list response
 */
export type SessionListResponse = {
  items: SessionInfo[];
  total: number;
  page: number;
  page_size: number;
};
