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
  /** Configuration value type */
  valueType: string;
  /** Configuration key name, used to determine if it's a prompt type */
  configKey: string;
  /** Number of rows for prompt textarea, default 10 */
  promptRows?: number;
  /** Number of rows for JSON textarea, default 8 */
  jsonRows?: number;
  /** Whether to disable input */
  disabled?: boolean;
}

/**
 * Configuration Value Input Component
 * Renders different input components based on value_type with parameterized differences
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
