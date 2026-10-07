import { LockOutlined, UserOutlined } from '@ant-design/icons';
import type { ProFormInstance } from '@ant-design/pro-components';
import { ModalForm, ProFormText } from '@ant-design/pro-components';
import { message } from 'antd';
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
  const formRef = useRef<ProFormInstance>();

  const handleSubmit = async (values: {
    name?: string;
    password?: string;
    confirmPassword?: string;
  }) => {
    // 校验密码一致性
    if (values.password && values.password !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
      return false;
    }

    try {
      await updateProfile({
        name: values.name,
        password: values.password,
      });

      message.success('个人信息更新成功');
      onSuccess?.();
      return true;
    } catch (error) {
      message.error('更新失败，请重试');
      return false;
    }
  };

  return (
    <ModalForm
      title="个人设置"
      formRef={formRef}
      open={open}
      onFinish={handleSubmit}
      modalProps={{
        destroyOnClose: true,
        onCancel: onClose,
        okText: '保存',
        cancelText: '取消',
      }}
      initialValues={initialValues}
      width={480}
    >
      <ProFormText
        name="email"
        label="邮箱"
        placeholder="邮箱"
        disabled
        fieldProps={{
          prefix: <UserOutlined />,
        }}
      />
      <ProFormText
        name="name"
        label="昵称"
        placeholder="请输入昵称"
        rules={[
          {
            required: true,
            message: '请输入昵称',
          },
          {
            max: 100,
            message: '昵称不能超过100个字符',
          },
        ]}
        fieldProps={{
          prefix: <UserOutlined />,
        }}
      />
      <ProFormText.Password
        name="password"
        label="新密码"
        placeholder="留空则不修改密码"
        rules={[
          {
            min: 6,
            message: '密码至少6个字符',
          },
        ]}
        fieldProps={{
          prefix: <LockOutlined />,
        }}
      />
      <ProFormText.Password
        name="confirmPassword"
        label="确认密码"
        placeholder="再次输入新密码"
        dependencies={['password']}
        rules={[
          {
            validator: (_, value) => {
              if (!value) return Promise.resolve();
              const password = formRef.current?.getFieldValue('password');
              if (password && value !== password) {
                return Promise.reject(new Error('两次输入的密码不一致'));
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
