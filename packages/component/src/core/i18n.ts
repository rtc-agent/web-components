import { configureLocalization } from '@lit/localize';
import { createContext } from '@lit/context';
import type { LocaleModule } from '@lit/localize';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('I18n');

// 1. Locale codes
export const sourceLocale = 'zh-CN' as const;
export const targetLocales = ['en-US'] as const;
export type SupportedLocale = typeof targetLocales[number] | typeof sourceLocale;

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
        `[i18n] Unknown locale: "${locale}". Available: ${available}`
      );
    }
    try {
      return await loader();
    } catch (err) {
      throw new Error(
        `[i18n] Failed to load locale "${locale}": ${err instanceof Error ? err.message : String(err)}`
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

export const localeContext = createContext<LocaleContextValue>(Symbol('locale'));

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
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isValidLocale(saved)) {
      return saved;
    }
  } catch (err) {
    // localStorage unavailable — fall through to browser language
    log.debug('localStorage unavailable for reading locale:', err);
  }
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
  // Sync document lang attribute to ensure screen readers use correct pronunciation rules
  document.documentElement.lang = initial;
}

export function persistLocale(locale: SupportedLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch (err) {
    // localStorage may be unavailable (private browsing, quota exceeded)
    log.debug('localStorage unavailable for persisting locale:', err);
  }
}

/**
 * Switch language and synchronize all related state
 * Components should call this function instead of calling _setLocale directly
 */
export async function switchLocale(locale: SupportedLocale): Promise<void> {
  await _setLocale(locale);
  persistLocale(locale);
  document.documentElement.lang = locale;
}
