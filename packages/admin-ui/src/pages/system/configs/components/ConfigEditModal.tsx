import {
  ModalForm,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Alert, Form } from 'antd';
import React, { useEffect } from 'react';
import type { ServerConfigItem } from '@/services/serverConfig';
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
 * 配置编辑表单
 * 根据 value_type 渲染不同的输入组件
 */
const ConfigEditModal: React.FC<ConfigEditModalProps> = ({
  open,
  onOpenChange,
  config,
  onFinish,
}) => {
  const [form] = Form.useForm<{ value: unknown; change_note?: string }>();
  const intl = useIntl();

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
      title={`${intl.formatMessage({ id: 'pages.config.system.editTitle' })}${config.key}`}
      form={form}
      open={open}
      onOpenChange={onOpenChange}
      modalProps={{ destroyOnClose: true }}
      onFinish={async (values) => {
        // Parse json type value
        let finalValue = values.value;
        if (config.value_type === 'json' && typeof values.value === 'string') {
          try {
            finalValue = JSON.parse(values.value);
          } catch {
            return false;
          }
        }
        // Parse int/float from string if needed
        if (config.value_type === 'int' && typeof values.value === 'string') {
          finalValue = Number.parseInt(values.value, 10);
        }
        if (config.value_type === 'float' && typeof values.value === 'string') {
          finalValue = Number.parseFloat(values.value);
        }
        return onFinish({
          value: finalValue,
          change_note: values.change_note,
        });
      }}
    >
      {config.description && (
        <Alert
          type="info"
          showIcon
          title={config.description}
          style={{ marginBottom: 16 }}
        />
      )}
      <ConfigValueInput
        valueType={config.value_type}
        configKey={config.key}
      />
      <ProFormTextArea
        name="change_note"
        label={intl.formatMessage({ id: 'pages.config.system.changeNote' })}
        placeholder={intl.formatMessage({
          id: 'pages.config.system.changeNotePlaceholder',
        })}
        fieldProps={{ rows: 2, maxLength: 500, showCount: true }}
      />
    </ModalForm>
  );
};

export default ConfigEditModal;
