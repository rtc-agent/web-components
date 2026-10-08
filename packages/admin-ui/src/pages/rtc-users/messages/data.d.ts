/**
 * Message role type
 */
export type MessageRole = 'user' | 'assistant';

/**
 * Message information
 */
export type MessageInfo = {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  global_offset: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

/**
 * Message list response
 */
export type MessageListResponse = {
  items: MessageInfo[];
  total: number;
  page: number;
  page_size: number;
};
