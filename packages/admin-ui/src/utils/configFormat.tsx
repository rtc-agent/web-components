import { useIntl } from '@umijs/max';
import { Tag } from 'antd';
import type { ReactNode } from 'react';

/**
 * Render source label with colored tag.
 * Shared between system config page and user config drawer.
 */
export const useConfigSourceRenderer = () => {
  const intl = useIntl();

  return (source: string): ReactNode => {
    switch (source) {
      case 'yaml':
        return (
          <Tag color="green">
            {intl.formatMessage({ id: 'pages.config.system.source.yaml' })}
          </Tag>
        );
      case 'system':
        return (
          <Tag color="blue">
            {intl.formatMessage({ id: 'pages.config.system.source.system' })}
          </Tag>
        );
      case 'user':
        return (
          <Tag color="purple">
            {intl.formatMessage({ id: 'pages.config.system.source.user' })}
          </Tag>
        );
      default:
        return <Tag>{source}</Tag>;
    }
  };
};

/**
 * Legacy renderConfigSource function for backward compatibility.
 * Uses default messages without i18n.
 */
export const renderConfigSource = (source: string): ReactNode => {
  switch (source) {
    case 'yaml':
      return <Tag color="green">yaml 默认</Tag>;
    case 'system':
      return <Tag color="blue">系统配置</Tag>;
    case 'user':
      return <Tag color="purple">用户覆盖</Tag>;
    default:
      return <Tag>{source}</Tag>;
  }
};

/**
 * Format config value for display.
 * Handles null/undefined, objects (JSON serialization), and primitives.
 */
export const formatConfigValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * Truncate a formatted value string for table cell display.
 */
export const truncateValue = (text: string, maxLen: number): string =>
  text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;

/**
 * 判断配置 key 是否为 prompt 类型字段。
 * prompt 字段需要更大的文本区域来编辑。
 *
 * 检测规则：
 * 1. 精确匹配 worker.system_prompt（系统级 prompt 配置）
 * 2. key 中包含 'prompt'（如各种自定义 prompt 配置）
 */
export const isPromptKey = (key: string): boolean => {
  return key === 'worker.system_prompt' || key.includes('prompt');
};
