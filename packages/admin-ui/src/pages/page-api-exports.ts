/**
 * Page API Type Exports
 *
 * Centralized export of all Page API interfaces for external consumption.
 * Each page registers its API on mount via window.__pages__ registry.
 *
 * Usage:
 * import type { ChatbotPageAPI, AdminPageAPI } from '@/pages/page-api-exports';
 *
 * const chatbotAPI = window.__pages__?.chatbot as ChatbotPageAPI;
 */

// User pages
export type { SelfAccountSettingsPageAPI } from './account/settings/page-api';
export type { ChatbotPageAPI } from './chatbot/page-api';
export type { AdminPageAPI } from './user/management/page-api';

// RTC pages
export type { MessagePageAPI } from './rtc-users/messages/page-api';
export type { SessionPageAPI } from './rtc-users/sessions/page-api';
export type { RtcUserPageAPI } from './rtc-users/management/page-api';

// System pages
export type { AuditLogPageAPI } from './system/audit-logs/page-api';
export type { ServerConfigPageAPI } from './system/configs/page-api';
export type { PermissionPageAPI } from './system/permissions/page-api';
export type { RolePageAPI } from './system/roles/page-api';

/**
 * Type-safe accessor for Page APIs
 *
 * Example:
 * const chatbotAPI = getPageAPI<ChatbotPageAPI>('chatbot');
 * if (chatbotAPI) {
 *   await chatbotAPI.sendMessage('Hello');
 * }
 */
export function getPageAPI<T>(pageName: keyof PagesRegistry): T | undefined {
  return window.__pages__?.[pageName] as T | undefined;
}
