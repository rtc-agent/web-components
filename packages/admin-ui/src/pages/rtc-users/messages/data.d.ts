/**
 * Message 角色
 */
export type MessageRole = 'user' | 'assistant';

/**
 * Message 信息
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
 * Message 列表响应
 */
export type MessageListResponse = {
  items: MessageInfo[];
  total: number;
  page: number;
  page_size: number;
};
