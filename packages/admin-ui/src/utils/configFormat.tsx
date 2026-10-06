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

/**
 * 根据配置类型解析原始值。
 * 用于配置编辑弹窗，将用户输入的字符串转换为正确的类型。
 *
 * @param rawValue - 用户输入的原始值（通常是字符串）
 * @param valueType - 配置类型（json/int/float/string/bool 等）
 * @returns 解析结果，包含成功标志、解析后的值或错误信息
 */
export const parseConfigValue = (
  rawValue: unknown,
  valueType: string,
): { success: boolean; value?: unknown; error?: string } => {
  // JSON 类型：尝试解析字符串
  if (valueType === 'json' && typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      // 防御性检查：拒绝 null 值（后端不允许配置为 null）
      if (parsed === null) {
        return { success: false, error: 'null' };
      }
      return { success: true, value: parsed };
    } catch {
      return { success: false, error: 'json' };
    }
  }

  // int 类型：转换为整数
  if (valueType === 'int' && typeof rawValue === 'string') {
    const parsed = Number.parseInt(rawValue, 10);
    return { success: true, value: parsed };
  }

  // float 类型：转换为浮点数
  if (valueType === 'float' && typeof rawValue === 'string') {
    const parsed = Number.parseFloat(rawValue);
    return { success: true, value: parsed };
  }

  // 其他类型：直接返回原始值
  return { success: true, value: rawValue };
};
