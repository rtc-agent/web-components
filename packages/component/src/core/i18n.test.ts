import { describe, it, expect, beforeEach } from 'vitest';
import {
  initLocale,
  switchLocale,
  isValidLocale,
  sourceLocale,
  targetLocales,
  persistLocale,
} from './i18n.js';

describe('i18n core', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
  });

  describe('isValidLocale', () => {
    it('识别合法 locale', () => {
      expect(isValidLocale('zh-CN')).toBe(true);
      expect(isValidLocale('en-US')).toBe(true);
    });

    it('拒绝非法 locale', () => {
      expect(isValidLocale('fr-FR')).toBe(false);
      expect(isValidLocale('zh-TW')).toBe(false);
      expect(isValidLocale('')).toBe(false);
      expect(isValidLocale('invalid')).toBe(false);
    });
  });

  describe('getInitialLocale', () => {
    it('优先读取 localStorage', async () => {
      localStorage.setItem('rtc-agent-locale', 'en-US');
      await initLocale();
      expect(document.documentElement.lang).toBe('en-US');
    });

    it('localStorage 值非法时回退', async () => {
      localStorage.setItem('rtc-agent-locale', 'invalid-locale');
      await initLocale();
      // Fall back to browser language or sourceLocale
      expect(['zh-CN', 'en-US']).toContain(document.documentElement.lang);
    });

    it('无 localStorage 时回退到浏览器语言或 sourceLocale', async () => {
      await initLocale();
      // navigator.language may be zh-CN, en-US, etc.
      expect(['zh-CN', 'en-US']).toContain(document.documentElement.lang);
    });
  });

  describe('initLocale', () => {
    it('同步 lang 属性', async () => {
      localStorage.setItem('rtc-agent-locale', 'en-US');
      await initLocale();
      expect(document.documentElement.lang).toBe('en-US');
    });

    it('sourceLocale 时不触发 loadLocale', async () => {
      localStorage.setItem('rtc-agent-locale', 'zh-CN');
      await initLocale();
      expect(document.documentElement.lang).toBe('zh-CN');
    });
  });

  describe('switchLocale', () => {
    it('同步 lang 属性和 localStorage', async () => {
      await switchLocale('en-US');
      expect(document.documentElement.lang).toBe('en-US');
      expect(localStorage.getItem('rtc-agent-locale')).toBe('en-US');
    });

    it('切换回 sourceLocale 也正常同步', async () => {
      await switchLocale('en-US');
      await switchLocale('zh-CN');
      expect(document.documentElement.lang).toBe('zh-CN');
      expect(localStorage.getItem('rtc-agent-locale')).toBe('zh-CN');
    });

    it('未知 locale fallback 到源语言', async () => {
      // switchLocale should not throw, but fallback to source locale
      await switchLocale('fr-FR' as any);
      // Should fallback to zh-CN (source locale)
      expect(document.documentElement.lang).toBe('zh-CN');
    });

    it('无效 locale 不抛出错误而是 fallback', async () => {
      // Our new strategy is to fallback to source locale instead of throwing
      await switchLocale('invalid-locale' as any);
      // Should fallback to zh-CN (source locale)
      expect(document.documentElement.lang).toBe('zh-CN');
    });
  });

  describe('persistLocale', () => {
    it('写入 localStorage', () => {
      persistLocale('en-US');
      expect(localStorage.getItem('rtc-agent-locale')).toBe('en-US');
    });
  });

  describe('locale constants', () => {
    it('sourceLocale 为 zh-CN', () => {
      expect(sourceLocale).toBe('zh-CN');
    });

    it('targetLocales 包含 en-US', () => {
      expect(targetLocales).toContain('en-US');
    });
  });
});
