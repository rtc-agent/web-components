import { configureLocalization } from '@lit/localize';
import { createContext } from '@lit/context';
import type { LocaleModule } from '@lit/localize';
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from '../utils/safe-local-storage.js';

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
      throw new Error(
        `[i18n] Unknown locale: "${locale}". Available: ${available}`,
      );
    }
    try {
      return await loader();
    } catch (err) {
      throw new Error(
        `[i18n] Failed to load locale "${locale}": ${err instanceof Error ? err.message : String(err)}`,
      );
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

// 6. Persistence
const STORAGE_KEY = 'rtc-agent-locale';

function getInitialLocale(hostLang?: string): SupportedLocale {
  // 1. Host application's HTML attribute (highest priority)
  if (hostLang && isValidLocale(hostLang)) {
    return hostLang;
  }
  // 2. Persisted preference in localStorage
  const saved = safeLocalStorageGet(STORAGE_KEY);
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
  safeLocalStorageSet(STORAGE_KEY, locale);
}

/**
 * Switch language and synchronize all related state
 * Components should call this function instead of calling _setLocale directly
 */
export async function switchLocale(locale: SupportedLocale): Promise<void> {
  await _setLocale(locale);
  persistLocale(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = isRTLLocale(locale) ? 'rtl' : 'ltr';
}

/**
 * Detect whether a locale requires right-to-left layout.
 * Matches any locale whose prefix appears in RTL_LOCALES (e.g. "fa-IR" -> "fa").
 */
function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.some((rtl) => locale.startsWith(rtl));
}
