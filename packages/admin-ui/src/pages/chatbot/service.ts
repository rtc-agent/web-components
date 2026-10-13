// src/pages/chatbot/service.ts
import { OpenAIChatProvider, XRequest } from '@ant-design/x-sdk';

export const CHAT_API_URL = process.env.CHAT_API_URL ?? '';

/**
 * Factory — call once per component mount (wrap in useMemo).
 * OpenAIChatProvider handles SSE parsing and history accumulation internally.
 */
export const createChatProvider = () => {
  if (!CHAT_API_URL) {
    throw new Error(
      'CHAT_API_URL environment variable is not configured. ' +
        'Please set it in your environment or .env file.',
    );
  }

  return new OpenAIChatProvider({
    request: XRequest(CHAT_API_URL, {
      manual: true,
      params: { model: 'glm-4.5-flash', stream: true },
    }),
  });
};
