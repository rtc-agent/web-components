import { useEffect, useState } from 'react';

/**
 * Custom hook to detect current theme mode (dark/light)
 *
 * Uses reliable detection methods:
 * 1. Checks document's data-theme attribute (primary)
 * 2. Falls back to system color scheme preference
 *
 * @returns isDark - boolean indicating if dark mode is active
 */
export const useThemeMode = (): boolean => {
  const [isDark, setIsDark] = useState(() => {
    // Check explicit theme attribute (most reliable)
    const themeAttr = document.documentElement.getAttribute('data-theme');
    if (themeAttr !== null) {
      return themeAttr === 'dark';
    }

    // Fall back to system preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    return false;
  });

  useEffect(() => {
    // Update when data-theme attribute changes
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'data-theme'
        ) {
          const themeAttr = document.documentElement.getAttribute('data-theme');
          if (themeAttr !== null) {
            setIsDark(themeAttr === 'dark');
          }
        }
      }
    });

    // Observe document element for theme attribute changes
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      const themeAttr = document.documentElement.getAttribute('data-theme');
      // Only respond to system theme if no explicit theme is set
      if (themeAttr === null) {
        setIsDark(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  return isDark;
};
