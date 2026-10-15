import { configureLocalization } from '@lit/localize';
import { createContext } from '@lit/context';
import type { LocaleModule } from '@lit/localize';
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from '../utils/safe-local-storage.js';
import { clearFormatterCaches } from '../utils/format.js';
import { createLogger } from '@rtc-agent/protocol';
import { STORAGE_KEYS } from '../config/auth.js';

const log = createLogger('i18n');

// 1. Locale codes
export const sourceLocale = 'zh-CN' as const;
export const targetLocales = ['en-US'] as const;
export type SupportedLocale =
  | (typeof targetLocales)[number]
  | typeof sourceLocale;

// RTL (right-to-left) locale prefixes — used to sync document.dir
const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'];

// 2. Dynamic import of locale bundles
const localeModules: Record<string, () => Promise<LocaleModule>> = {
  'en-US': async () => {
    const mod = await import('../locales/en-US.js');
    return mod.default;
  },
};

// 3. Configure localize runtime
export const { getLocale, setLocale: _setLocale } = configureLocalization({
  sourceLocale,
  targetLocales,
  loadLocale: async (locale) => {
    const loader = localeModules[locale];
    if (!loader) {
      const available = Object.keys(localeModules).join(', ');
      log.warn(
        `[i18n] Unknown locale: "${locale}". Available: ${available}. Falling back to source locale: ${sourceLocale}`,
      );
      // Fallback to source locale instead of throwing
      return localeModules[sourceLocale]!();
    }
    try {
      return await loader();
    } catch (err) {
      // P1-FIX: Provide more helpful error message in development
      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        warnMissingTranslation(locale, `Failed to load locale module`);
      }
      log.warn(
        `[i18n] Failed to load locale "${locale}": ${err instanceof Error ? err.message : String(err)}. Falling back to source locale: ${sourceLocale}`,
      );
      // Fallback to source locale instead of throwing
      return localeModules[sourceLocale]!();
    }
  },
});

// 4. Locale Context
export interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  locales: readonly SupportedLocale[];
}

export const localeContext = createContext<LocaleContextValue>(
  Symbol('locale'),
);

// 5. Type guard: compile-time type safety
const validLocales: readonly string[] = [sourceLocale, ...targetLocales];

export function isValidLocale(value: string): value is SupportedLocale {
  return validLocales.includes(value);
}

// 6. Persistence (uses STORAGE_KEYS.locale from config/auth.ts)

function getInitialLocale(hostLang?: string): SupportedLocale {
  // 1. Host application's HTML attribute (highest priority)
  if (hostLang && isValidLocale(hostLang)) {
    return hostLang;
  }
  // 2. Persisted preference in localStorage
  const saved = safeLocalStorageGet(STORAGE_KEYS.locale);
  if (saved && isValidLocale(saved)) {
    return saved;
  }
  // 3. Browser language
  const browserLang = navigator.language;
  if (isValidLocale(browserLang)) {
    return browserLang;
  }
  return sourceLocale;
}

export async function initLocale(hostLang?: string): Promise<void> {
  const initial = getInitialLocale(hostLang);
  if (initial !== sourceLocale) {
    await _setLocale(initial);
  }
  // Sync document lang/dir so screen readers & layout match the active locale
  document.documentElement.lang = initial;
  document.documentElement.dir = isRTLLocale(initial) ? 'rtl' : 'ltr';
}

export function persistLocale(locale: SupportedLocale): void {
  safeLocalStorageSet(STORAGE_KEYS.locale, locale);
}

/**
 * Guard flag to prevent concurrent locale switches
 */
let _isSwitching = false;

/**
 * Switch language and synchronize all related state
 * Components should call this function instead of calling _setLocale directly
 *
 * Uses a simple guard to prevent concurrent switching without unnecessary debounce delay.
 *
 * @param locale - Target locale to switch to
 */
export async function switchLocale(locale: SupportedLocale): Promise<void> {
  if (_isSwitching) {
    log.debug('Locale switch already in progress, ignoring request');
    return;
  }

  _isSwitching = true;
  try {
    await executeLocaleSwitch(locale);
  } finally {
    _isSwitching = false;
  }
}

/**
 * Execute the actual locale switch
 */
async function executeLocaleSwitch(locale: SupportedLocale): Promise<void> {
  try {
    // Validate locale before attempting to switch
    if (!isValidLocale(locale)) {
      log.warn(
        `[i18n] Invalid locale: "${locale}". Falling back to source locale: ${sourceLocale}`,
      );
      locale = sourceLocale;
    }

    await _setLocale(locale);
    persistLocale(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = isRTLLocale(locale) ? 'rtl' : 'ltr';
    // Clear formatter caches to avoid stale locale-specific formatting
    clearFormatterCaches();
    log.info(`Locale switched to: ${locale}`);
  } catch (err) {
    log.error(`Failed to switch locale to ${locale}:`, err);
    throw err;
  }
}

/**
 * Warn about missing translation
 *
 * Call this when a translation key is not found to help developers
 * identify missing translations during development.
 *
 * @param key - Translation key that is missing
 * @param fallback - Fallback text that was used
 */
export function warnMissingTranslation(key: string, fallback?: string): void {
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const message = fallback
      ? `[i18n] Missing translation for key: "${key}" (using fallback: "${fallback}")`
      : `[i18n] Missing translation for key: "${key}"`;
    log.warn(message);
  }
}

/**
 * Detect whether a locale requires right-to-left layout.
 * Matches any locale whose prefix appears in RTL_LOCALES (e.g. "fa-IR" -> "fa").
 */
function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.some((rtl) => locale.startsWith(rtl));
}
