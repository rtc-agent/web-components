// src/pages/chatbot/service.ts
import { OpenAIChatProvider, XRequest } from '@ant-design/x-sdk';

export const CHAT_API_URL = process.env.CHAT_API_URL ?? '';

/**
 * Factory — call once per component mount (wrap in useMemo).
 * OpenAIChatProvider handles SSE parsing and history accumulation internally.
 *
 * Returns null if CHAT_API_URL is not configured, allowing the component
 * to handle the missing configuration gracefully.
 */
export const createChatProvider = () => {
  if (!CHAT_API_URL) {
    console.warn('CHAT_API_URL not configured, chatbot disabled');
    return null;
  }

  return new OpenAIChatProvider({
    request: XRequest(CHAT_API_URL, {
      manual: true,
      params: { model: 'glm-4.5-flash', stream: true },
    }),
  });
};
