/**
 * Chatbot Page API Interface
 *
 * Page component registers these APIs on mount.
 * Function handlers call these APIs to operate the UI.
 *
 * Key principles:
 * - Uses React native patterns (useXChat, conversations state)
 * - Returns data matching UI display
 * - Does not directly manipulate DOM
 */

import type { ParsedMessage } from './data';

export interface ChatbotPageAPI {
  /**
   * Send a message in the active conversation.
   * Mirrors the Sender's onSubmit behavior.
   */
  sendMessage: (content: string) => Promise<{ success: boolean }>;

  /**
   * Get all messages in the active conversation.
   * Returns parsed messages currently displayed in the bubble list.
   */
  getMessages: () => Promise<{
    success: boolean;
    data: ParsedMessage[];
  }>;

  /**
   * Clear all messages in the active conversation.
   * Resets the chat state for the current conversation key.
   */
  clearConversation: () => Promise<{ success: boolean }>;

  /**
   * Create a new conversation and switch to it.
   * Mirrors the "New conversation" button.
   */
  newChat: () => Promise<{
    success: boolean;
    conversationKey: string;
  }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    chatbot?: ChatbotPageAPI;
  }
}
