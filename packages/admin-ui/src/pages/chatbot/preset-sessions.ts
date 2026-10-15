/**
 * Preset session configurations for the chatbot page.
 *
 * Each preset session has:
 * - id: unique identifier for the conversation key
 * - titleKey: i18n key for the session title (displayed in sidebar)
 * - groupKey: i18n key for the time group (e.g., "Today", "Yesterday")
 */

export interface PresetSession {
  id: string;
  titleKey: string;
  groupKey: string;
}

/**
 * Preset sessions shown in the chatbot sidebar.
 *
 * Order matters: items appear in the sidebar in this order.
 * Group keys determine time-based grouping (Today/Yesterday/Earlier).
 */
export const PRESET_SESSIONS: PresetSession[] = [
  {
    id: 'preset-1',
    titleKey: 'pages.chatbot.faq.formValidation',
    groupKey: 'pages.chatbot.today',
  },
  {
    id: 'preset-2',
    titleKey: 'pages.chatbot.faq.proTableToolbar',
    groupKey: 'pages.chatbot.today',
  },
  {
    id: 'preset-3',
    titleKey: 'pages.chatbot.faq.darkTheme',
    groupKey: 'pages.chatbot.yesterday',
  },
  {
    id: 'preset-4',
    titleKey: 'pages.chatbot.faq.proLayoutMenu',
    groupKey: 'pages.chatbot.yesterday',
  },
  {
    id: 'preset-5',
    titleKey: 'pages.chatbot.faq.chartsData',
    groupKey: 'pages.chatbot.yesterday',
  },
  {
    id: 'preset-6',
    titleKey: 'pages.chatbot.faq.backendAuth',
    groupKey: 'pages.chatbot.earlier',
  },
  {
    id: 'preset-7',
    titleKey: 'pages.chatbot.faq.proFormSelect',
    groupKey: 'pages.chatbot.earlier',
  },
  {
    id: 'preset-8',
    titleKey: 'pages.chatbot.faq.designTokens',
    groupKey: 'pages.chatbot.earlier',
  },
];
