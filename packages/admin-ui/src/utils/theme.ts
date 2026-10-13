import type { MappingAlgorithm } from 'antd';
import { theme } from 'antd';

/**
 * Theme token mapping and utility functions
 * Provides consistent theme token access across the application
 */

/**
 * Get theme tokens for custom styling
 * Useful for components that need direct token access outside of antd's theme context
 */
export const getThemeTokens = (isDark: boolean) => ({
  // Background colors
  colorBg: isDark ? '#141414' : '#ffffff',
  colorBgContainer: isDark ? '#1f1f1f' : '#ffffff',
  colorBgElevated: isDark ? '#1f1f1f' : '#ffffff',
  colorBgLayout: isDark ? '#000000' : '#f5f5f5',

  // Text colors
  colorText: isDark ? '#ffffff' : '#000000',
  colorTextSecondary: isDark
    ? 'rgba(255, 255, 255, 0.65)'
    : 'rgba(0, 0, 0, 0.65)',
  colorTextTertiary: isDark
    ? 'rgba(255, 255, 255, 0.45)'
    : 'rgba(0, 0, 0, 0.45)',
  colorTextQuaternary: isDark
    ? 'rgba(255, 255, 255, 0.25)'
    : 'rgba(0, 0, 0, 0.25)',

  // Border colors
  colorBorder: isDark ? '#424242' : '#d9d9d9',
  colorBorderSecondary: isDark ? '#303030' : '#f0f0f0',

  // Status colors
  colorPrimary: '#1677ff',
  colorSuccess: '#52c41a',
  colorWarning: '#faad14',
  colorError: '#ff4d4f',
  colorInfo: '#1677ff',

  // Spacing
  padding: 16,
  paddingSM: 12,
  paddingLG: 24,
  paddingXL: 32,
  paddingXS: 8,
  paddingXXS: 4,

  // Border radius
  borderRadius: 6,
  borderRadiusSM: 4,
  borderRadiusLG: 8,

  // Shadows
  boxShadow: isDark
    ? '0 6px 16px 0 rgba(0, 0, 0, 0.32)'
    : '0 6px 16px 0 rgba(0, 0, 0, 0.08)',
  boxShadowSecondary: isDark
    ? '0 3px 8px 0 rgba(0, 0, 0, 0.24)'
    : '0 3px 8px 0 rgba(0, 0, 0, 0.06)',
});

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
