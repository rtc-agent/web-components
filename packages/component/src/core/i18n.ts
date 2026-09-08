import { configureLocalization } from '@lit/localize';
import { createContext } from '@lit/context';
import type { LocaleModule } from '@lit/localize';

// 1. 语言代码
export const sourceLocale = 'zh-CN' as const;
export const targetLocales = ['en-US'] as const;
export type SupportedLocale = typeof targetLocales[number] | typeof sourceLocale;

// 2. 动态导入语言包
const localeModules: Record<string, () => Promise<LocaleModule>> = {
  'en-US': async () => {
    const mod = await import('../locales/en-US.js');
    return mod.default;
  },
};

// 3. 配置 localize 运行时
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

// 5. 类型守卫：编译期保证类型安全
const validLocales: readonly string[] = [sourceLocale, ...targetLocales];

export function isValidLocale(value: string): value is SupportedLocale {
  return validLocales.includes(value);
}

// 6. 持久化
const STORAGE_KEY = 'rtc-agent-locale';

function getInitialLocale(): SupportedLocale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && isValidLocale(saved)) {
    return saved;
  }
  const browserLang = navigator.language;
  if (isValidLocale(browserLang)) {
    return browserLang;
  }
  return sourceLocale;
}

export async function initLocale(): Promise<void> {
  const initial = getInitialLocale();
  if (initial !== sourceLocale) {
    await _setLocale(initial);
  }
  // 同步文档 lang 属性，确保屏幕阅读器使用正确发音规则
  document.documentElement.lang = initial;
}

export function persistLocale(locale: SupportedLocale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

/**
 * 切换语言并同步所有相关状态
 * 组件中应调用此函数而非直接调用 _setLocale
 */
export async function switchLocale(locale: SupportedLocale): Promise<void> {
  await _setLocale(locale);
  persistLocale(locale);
  document.documentElement.lang = locale;
}
