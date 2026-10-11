import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { ModalForm, ProFormText } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { App, Grid } from 'antd';
import React, { useRef } from 'react';
import { updateProfile } from '@/services/admin-profile';

export type ProfileSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialValues?: {
    name?: string;
    email?: string;
  };
};

const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  open,
  onClose,
  onSuccess,
  initialValues,
}) => {
  const formRef = useRef<any>(null);
  const intl = useIntl();
  const { message } = App.useApp();
  const breakpoints = Grid.useBreakpoint();
  const isMobile = !breakpoints.sm;
  const modalWidth = isMobile ? '95vw' : 480;

  const handleSubmit = async (values: {
    name?: string;
    password?: string;
    confirmPassword?: string;
  }) => {
    // 校验密码一致性
    if (values.password && values.password !== values.confirmPassword) {
      message.error(
        intl.formatMessage({
          id: 'component.profileSettings.passwordMismatch',
          defaultMessage: 'The two passwords do not match',
        }),
      );
      return false;
    }

    try {
      await updateProfile({
        name: values.name,
        password: values.password,
      });

      message.success(
        intl.formatMessage({
          id: 'component.profileSettings.updateSuccess',
          defaultMessage: 'Profile updated successfully',
        }),
      );
      onSuccess?.();
      return true;
    } catch (_error) {
      message.error(
        intl.formatMessage({
          id: 'component.profileSettings.updateFailed',
          defaultMessage: 'Update failed, please try again',
        }),
      );
      return false;
    }
  };

  return (
    <ModalForm
      title={intl.formatMessage({
        id: 'component.profileSettings.title',
        defaultMessage: 'Personal settings',
      })}
      formRef={formRef}
      open={open}
      onFinish={handleSubmit}
      modalProps={{
        destroyOnClose: true,
        onCancel: onClose,
        okText: intl.formatMessage({ id: 'component.globalForm.ok' }),
        cancelText: intl.formatMessage({ id: 'component.globalForm.cancel' }),
        style: { maxWidth: modalWidth },
      }}
      initialValues={initialValues}
      width={modalWidth}
    >
      <ProFormText
        name="email"
        label={intl.formatMessage({
          id: 'component.profileSettings.email.label',
          defaultMessage: 'Email',
        })}
        placeholder={intl.formatMessage({
          id: 'component.profileSettings.email.placeholder',
          defaultMessage: 'Email',
        })}
        disabled
        fieldProps={{
          prefix: <UserOutlined />,
        }}
      />
      <ProFormText
        name="name"
        label={intl.formatMessage({
          id: 'component.profileSettings.nickname.label',
          defaultMessage: 'Nickname',
        })}
        placeholder={intl.formatMessage({
          id: 'component.profileSettings.nickname.placeholder',
          defaultMessage: 'Please enter nickname',
        })}
        rules={[
          {
            required: true,
            message: intl.formatMessage({
              id: 'component.profileSettings.nickname.required',
              defaultMessage: 'Please enter nickname',
            }),
          },
          {
            max: 100,
            message: intl.formatMessage({
              id: 'component.profileSettings.nickname.maxLength',
              defaultMessage: 'Nickname cannot exceed 100 characters',
            }),
          },
        ]}
        fieldProps={{
          prefix: <UserOutlined />,
        }}
      />
      <ProFormText.Password
        name="password"
        label={intl.formatMessage({
          id: 'component.profileSettings.newPassword.label',
          defaultMessage: 'New password',
        })}
        placeholder={intl.formatMessage({
          id: 'component.profileSettings.newPassword.placeholder',
          defaultMessage: 'Leave blank to keep password unchanged',
        })}
        rules={[
          {
            min: 6,
            message: intl.formatMessage({
              id: 'component.profileSettings.newPassword.minLength',
              defaultMessage: 'Password must be at least 6 characters',
            }),
          },
        ]}
        fieldProps={{
          prefix: <LockOutlined />,
        }}
      />
      <ProFormText.Password
        name="confirmPassword"
        label={intl.formatMessage({
          id: 'component.profileSettings.confirmPassword.label',
          defaultMessage: 'Confirm password',
        })}
        placeholder={intl.formatMessage({
          id: 'component.profileSettings.confirmPassword.placeholder',
          defaultMessage: 'Enter new password again',
        })}
        dependencies={['password']}
        rules={[
          {
            validator: (_, value) => {
              if (!value) return Promise.resolve();
              const password = formRef.current?.getFieldValue('password');
              if (password && value !== password) {
                return Promise.reject(
                  new Error(
                    intl.formatMessage({
                      id: 'component.profileSettings.passwordMismatch',
                      defaultMessage: 'The two passwords do not match',
                    }),
                  ),
                );
              }
              return Promise.resolve();
            },
          },
        ]}
        fieldProps={{
          prefix: <LockOutlined />,
        }}
      />
    </ModalForm>
  );
};

export default ProfileSettingsModal;
