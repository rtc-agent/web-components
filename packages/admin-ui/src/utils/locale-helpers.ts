import { getLocale } from '@umijs/max';
import dayjs from 'dayjs';

// RTL (Right-to-Left) language prefixes
// Aligned with component package's RTL_LOCALES for consistency
export const RTL_LOCALES = ['fa', 'ar', 'he', 'ur'];

/**
 * Set document direction (ltr/rtl) based on current locale
 */
export const setDocumentDirection = () => {
  const locale = getLocale();
  const isRTL = RTL_LOCALES.some((rtl) => locale.startsWith(rtl));
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  document.documentElement.lang = locale;
};

/**
 * Load dayjs locale based on current locale.
 *
 * dayjs locale files are imported statically in app.tsx,
 * so switching locales only requires calling `dayjs.locale(...)`.
 * This ensures date/time formatting (e.g. day names, month names,
 * relative time like "2 hours ago") follows the user's language.
 *
 * Fallback: If a locale is not in the map, it will be lowercased and used directly.
 * This handles standard locale codes (e.g. "fr-FR" → "fr-fr").
 */
export const loadDayjsLocale = () => {
  const locale = getLocale();
  // Map Ant Design Pro locale codes to dayjs locale identifiers
  // Only includes locales actually supported by the application
  const dayjsLocaleMap: Record<string, string> = {
    'zh-CN': 'zh-cn',
    'zh-TW': 'zh-tw',
    'en-US': 'en',
    'ja-JP': 'ja',
    'ko-KR': 'ko',
    'pt-BR': 'pt-br',
    'id-ID': 'id',
    'bn-BD': 'bn-bd',
    'fa-IR': 'fa',
  };
  const dayjsLocale = dayjsLocaleMap[locale] || locale.toLowerCase();
  dayjs.locale(dayjsLocale);
};
