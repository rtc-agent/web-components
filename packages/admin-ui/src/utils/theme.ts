import type { MappingAlgorithm, ThemeConfig } from 'antd';
import { theme } from 'antd';

/**
 * Theme token mapping and utility functions
 * Provides consistent theme token access across the application
 */

/**
 * Get theme tokens for custom styling
 * Uses antd's official getDesignToken() API to ensure consistency with the theme system.
 * @param isDark - Whether dark mode is enabled
 * @returns Design token object from antd theme system
 */
export const getThemeTokens = (isDark: boolean) => {
  const themeConfig: ThemeConfig = {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  };
  return theme.getDesignToken(themeConfig);
};

/**
 * Toggle theme between light and dark
 * @param currentTheme - Current theme mode ('light' or 'dark')
 * @returns New theme mode
 */
export const toggleTheme = (
  currentTheme: 'light' | 'dark',
): 'light' | 'dark' => {
  return currentTheme === 'light' ? 'dark' : 'light';
};

/**
 * Get antd algorithm for theme mode
 * @param isDark - Whether dark mode is enabled
 * @returns Antd theme algorithm
 */
export const getThemeAlgorithm = (isDark: boolean): MappingAlgorithm => {
  return isDark ? theme.darkAlgorithm : theme.defaultAlgorithm;
};

/**
 * Common style patterns using theme tokens
 * Helps maintain consistency across components
 */
export const getCommonStyles = (token: any) => ({
  // Card styles
  card: {
    background: token.colorBgContainer,
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${token.colorBorderSecondary}`,
  },

  // Input styles
  input: {
    background: token.colorBgContainer,
    borderColor: token.colorBorder,
    color: token.colorText,
    borderRadius: token.borderRadius,
  },

  // Code block styles
  codeBlock: {
    background: token.colorBgTextHover,
    color: token.colorText,
    padding: token.paddingSM,
    borderRadius: token.borderRadiusSM,
    fontFamily: 'monospace',
    fontSize: 12,
  },

  // Hover state
  hoverState: {
    background: token.colorBgTextHover,
    transition: 'background 0.2s',
  },

  // Focus state
  focusState: {
    borderColor: token.colorPrimary,
    boxShadow: `0 0 0 2px ${token.colorPrimaryBg}`,
  },
});
