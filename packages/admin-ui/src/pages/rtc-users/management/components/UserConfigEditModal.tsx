import { ModalForm, ProFormTextArea } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Alert, App, Form } from 'antd';
import { useEffect } from 'react';
import { useResponsiveModalWidth } from '@/hooks/useResponsiveModalWidth';
import ConfigValueInput from '@/pages/system/configs/components/ConfigValueInput';
import { parseConfigValue } from '@/utils/configFormat';
import type { UserConfigItem } from '../service';

export interface UserConfigEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: UserConfigItem;
  onFinish: (values: {
    value: unknown;
    change_note?: string;
  }) => Promise<boolean>;
}

/**
 * 用户配置编辑弹窗
 */
const UserConfigEditModal: React.FC<UserConfigEditModalProps> = ({
  open,
  onOpenChange,
  item,
  onFinish,
}) => {
  const [form] = Form.useForm<{ value: unknown; change_note?: string }>();
  const intl = useIntl();
  const { message } = App.useApp();
  const modalWidth = useResponsiveModalWidth();

  useEffect(() => {
    if (open) {
      const currentValue =
        item.user_value ?? item.effective_value ?? item.yaml_default;
      const formValue =
        item.value_type === 'json' && typeof currentValue === 'object'
          ? JSON.stringify(currentValue, null, 2)
          : currentValue;
      form.setFieldsValue({ value: formValue });
    }
  }, [open, item, form]);

  return (
    <ModalForm
      title={`${intl.formatMessage({ id: 'pages.config.user.editTitle' })}${item.key}`}
      form={form}
      open={open}
      onOpenChange={onOpenChange}
      width={modalWidth}
      modalProps={{ destroyOnClose: true }}
      onFinish={async (values: { value: unknown; change_note?: string }) => {
        // 根据配置类型解析值
        const result = parseConfigValue(values.value, item.value_type);
        if (!result.success) {
          if (result.error === 'json') {
            message.error(
              intl.formatMessage({ id: 'pages.config.system.jsonFormatError' }),
            );
          } else if (result.error === 'null') {
            message.error(
              intl.formatMessage({ id: 'pages.config.system.jsonNullError' }),
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
      {item.description && (
        <Alert
          type="info"
          showIcon
          message={item.description}
          style={{ marginBottom: 16 }}
        />
      )}
      <ConfigValueInput
        valueType={item.value_type}
        configKey={item.key}
        promptRows={8}
        jsonRows={6}
      />
      <ProFormTextArea
        name="change_note"
        label={intl.formatMessage({ id: 'pages.config.system.changeNote' })}
        placeholder={intl.formatMessage({
          id: 'pages.config.system.changeNotePlaceholder',
        })}
        fieldProps={{ rows: 2, maxLength: 500, showCount: true }}
        rules={[
          {
            required: true,
            message: intl.formatMessage({
              id: 'pages.config.system.changeNoteRequired',
              defaultMessage: 'Please enter change description',
            }),
          },
          {
            whitespace: true,
            message: intl.formatMessage({
              id: 'pages.config.system.changeNoteWhitespace',
              defaultMessage: 'Change description cannot be blank',
            }),
          },
          {
            max: 500,
            message: intl.formatMessage({
              id: 'pages.config.system.changeNoteMax',
              defaultMessage: 'Change description cannot exceed 500 characters',
            }),
          },
        ]}
      />
    </ModalForm>
  );
};

export default UserConfigEditModal;
