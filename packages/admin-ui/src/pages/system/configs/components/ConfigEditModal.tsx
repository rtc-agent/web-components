import { ModalForm, ProFormTextArea } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Alert, App, Form } from 'antd';
import React, { useEffect } from 'react';
import {
  getMaxLengthRule,
  getRequiredRule,
  getWhitespaceRule,
} from '@/constants/form-rules';
import { useResponsiveModalWidth } from '@/hooks/useResponsiveModalWidth';
import { parseConfigValue } from '@/utils/configFormat';
import type { ServerConfigItem } from '../service';
import ConfigValueInput from './ConfigValueInput';

export interface ConfigEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ServerConfigItem | null;
  onFinish: (values: {
    value: unknown;
    change_note?: string;
  }) => Promise<boolean>;
}

/**
 * Configuration Edit Form
 * Renders different input components based on value_type
 */
const ConfigEditModal: React.FC<ConfigEditModalProps> = ({
  open,
  onOpenChange,
  config,
  onFinish,
}) => {
  const [form] = Form.useForm<{ value: unknown; change_note?: string }>();
  const intl = useIntl();
  const { message } = App.useApp();
  const modalWidth = useResponsiveModalWidth(480);

  useEffect(() => {
    if (config && open) {
      const currentValue = config.value ?? config.yaml_default;
      // For json type, serialize to string for the textarea
      const formValue =
        config.value_type === 'json' && typeof currentValue === 'object'
          ? JSON.stringify(currentValue, null, 2)
          : currentValue;
      form.setFieldsValue({ value: formValue });
    }
  }, [config, open, form]);

  if (!config) return null;

  return (
    <ModalForm
      title={`${intl.formatMessage({ id: 'pages.config.system.editTitle', defaultMessage: 'Edit Config: ' })}${config.key}`}
      form={form}
      open={open}
      onOpenChange={onOpenChange}
      width={modalWidth}
      modalProps={{
        destroyOnHidden: true,
        style: { maxWidth: modalWidth },
      }}
      onFinish={async (values) => {
        // Parse value based on config type
        const result = parseConfigValue(values.value, config.value_type);
        if (!result.success) {
          if (result.error === 'json') {
            message.error(
              intl.formatMessage({
                id: 'pages.config.system.jsonFormatError',
                defaultMessage: 'Please enter valid JSON format',
              }),
            );
          } else if (result.error === 'null') {
            message.error(
              intl.formatMessage({
                id: 'pages.config.system.jsonNullError',
                defaultMessage: 'Config value cannot be null',
              }),
            );
          }
          return false;
        }

        return onFinish({
          value: result.value,
          change_note: values.change_note,
        });
      }}
    >
      {config.description && (
        <Alert
          type="info"
          showIcon
          message={config.description}
          style={{ marginBottom: 16 }}
        />
      )}
      <ConfigValueInput valueType={config.value_type} configKey={config.key} />
      <ProFormTextArea
        name="change_note"
        label={intl.formatMessage({
          id: 'pages.config.system.changeNote',
          defaultMessage: 'Change Note',
        })}
        placeholder={intl.formatMessage({
          id: 'pages.config.system.changeNotePlaceholder',
          defaultMessage: 'Optional, explain the reason for this change',
        })}
        rules={[
          getRequiredRule(intl.formatMessage, {
            id: 'pages.config.system.changeNoteRequired',
            defaultMessage: 'Please enter change description',
          }),
          getWhitespaceRule(intl.formatMessage, {
            id: 'pages.config.system.changeNoteWhitespace',
            defaultMessage: 'Change description cannot be blank',
          }),
          getMaxLengthRule(500, intl.formatMessage, {
            id: 'pages.config.system.changeNoteMax',
            defaultMessage: 'Change description cannot exceed 500 characters',
          }),
        ]}
        fieldProps={{ rows: 2, maxLength: 500, showCount: true }}
      />
    </ModalForm>
  );
};

export default ConfigEditModal;
