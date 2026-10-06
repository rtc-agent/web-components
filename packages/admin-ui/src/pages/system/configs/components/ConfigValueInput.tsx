import {
  ProFormDigit,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import React, { useMemo } from 'react';
import { isPromptKey } from '@/utils/configFormat';

export interface ConfigValueInputProps {
  /** 配置值类型 */
  valueType: string;
  /** 配置键名，用于判断是否为 prompt 类型 */
  configKey: string;
  /** prompt 文本区域的行数，默认 10 */
  promptRows?: number;
  /** JSON 文本区域的行数，默认 8 */
  jsonRows?: number;
  /** 是否禁用输入 */
  disabled?: boolean;
}

/**
 * 配置值输入组件
 * 根据 value_type 渲染不同的输入组件，支持参数化差异
 */
const ConfigValueInput: React.FC<ConfigValueInputProps> = ({
  valueType,
  configKey,
  promptRows = 10,
  jsonRows = 8,
  disabled = false,
}) => {
  const intl = useIntl();

  const input = useMemo(() => {
    switch (valueType) {
      case 'string':
        if (isPromptKey(configKey)) {
          return (
            <ProFormTextArea
              name="value"
              label={intl.formatMessage({
                id: 'pages.config.system.configValue',
              })}
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({
                    id: 'pages.config.system.configValueRequired',
                  }),
                },
              ]}
              fieldProps={{
                rows: promptRows,
                style: { fontFamily: 'monospace' },
              }}
              disabled={disabled}
            />
          );
        }
        return (
          <ProFormText
            name="value"
            label={intl.formatMessage({
              id: 'pages.config.system.configValue',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.config.system.configValueRequired',
                }),
              },
            ]}
            disabled={disabled}
          />
        );
      case 'int':
        return (
          <ProFormDigit
            name="value"
            label={intl.formatMessage({
              id: 'pages.config.system.configValue',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.config.system.configValueRequired',
                }),
              },
            ]}
            fieldProps={{ precision: 0 }}
            width="md"
            disabled={disabled}
          />
        );
      case 'float':
        return (
          <ProFormDigit
            name="value"
            label={intl.formatMessage({
              id: 'pages.config.system.configValue',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.config.system.configValueRequired',
                }),
              },
            ]}
            fieldProps={{ precision: 6 }}
            width="md"
            disabled={disabled}
          />
        );
      case 'bool':
        return (
          <ProFormSwitch
            name="value"
            label={intl.formatMessage({
              id: 'pages.config.system.configValue',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.config.system.configValueRequired',
                }),
              },
            ]}
            disabled={disabled}
          />
        );
      case 'duration':
        return (
          <ProFormText
            name="value"
            label={intl.formatMessage({
              id: 'pages.config.system.configValue',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.config.system.configValueRequired',
                }),
              },
              {
                pattern: /^(\d+(ns|us|ms|s|m|h))+$/,
                message: intl.formatMessage({
                  id: 'pages.config.system.durationFormat',
                }),
              },
            ]}
            placeholder={intl.formatMessage({
              id: 'pages.config.system.durationPlaceholder',
            })}
            tooltip={intl.formatMessage({
              id: 'pages.config.system.durationTooltip',
            })}
            width="md"
            disabled={disabled}
          />
        );
      case 'json':
        return (
          <ProFormTextArea
            name="value"
            label={intl.formatMessage({
              id: 'pages.config.system.configValue',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.config.system.configValueRequired',
                }),
              },
              {
                validator: (_rule: unknown, val: string) => {
                  if (!val) return Promise.resolve();
                  try {
                    const parsed = JSON.parse(val);
                    if (parsed === null) {
                      return Promise.reject(
                        new Error(
                          intl.formatMessage({
                            id: 'pages.config.system.jsonNullError',
                          }),
                        ),
                      );
                    }
                    return Promise.resolve();
                  } catch {
                    return Promise.reject(
                      new Error(
                        intl.formatMessage({
                          id: 'pages.config.system.jsonFormatError',
                        }),
                      ),
                    );
                  }
                },
              },
            ]}
            fieldProps={{
              rows: jsonRows,
              style: { fontFamily: 'monospace' },
            }}
            placeholder={intl.formatMessage({
              id: 'pages.config.system.jsonPlaceholder',
            })}
            disabled={disabled}
          />
        );
      default:
        return (
          <ProFormText
            name="value"
            label={intl.formatMessage({
              id: 'pages.config.system.configValue',
            })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.config.system.configValueRequired',
                }),
              },
            ]}
            disabled={disabled}
          />
        );
    }
  }, [valueType, configKey, promptRows, jsonRows, disabled, intl]);

  return input;
};

export default ConfigValueInput;
