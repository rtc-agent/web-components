/**
 * Login Page
 *
 * Admin authentication page using Ant Design Form.
 * Validates email format and password length, calls authStore.login(),
 * and redirects to Dashboard on success.
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Alert, Typography, Space } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';

const { Title, Text } = Typography;

interface LoginFormValues {
  email: string;
  password: string;
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, isLoading, error, isAuthenticated, clearAuth } = useAuthStore();
  const [form] = Form.useForm<LoginFormValues>();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Clear error when component unmounts
  useEffect(() => {
    return () => {
      clearAuth();
    };
  }, [clearAuth]);

  const handleSubmit = async (values: LoginFormValues) => {
    try {
      await login(values.email, values.password);
      navigate('/dashboard', { replace: true });
    } catch {
      // Error is handled by the store and displayed via the error state
    }
  };

  return (
    <div style={containerStyle}>
      <Card style={cardStyle}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={headerStyle}>
            <Title level={2} style={{ margin: 0, textAlign: 'center' }}>
              RTC Agent
            </Title>
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>
              Admin Console
            </Text>
          </div>

          {error && (
            <Alert
              message="Login Failed"
              description={error}
              type="error"
              showIcon
              closable
            />
          )}

          <Form<LoginFormValues>
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            autoComplete="off"
            size="large"
          >
            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: 'Please enter your email' },
                { type: 'email', message: 'Please enter a valid email address' },
              ]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="admin@example.com"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: 'Please enter your password' },
                { min: 6, message: 'Password must be at least 6 characters' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Enter your password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={isLoading}
                block
              >
                Sign In
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
};

// ========== Styles ==========

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 400,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
  borderRadius: 8,
};

const headerStyle: React.CSSProperties = {
  paddingBottom: 8,
  borderBottom: '1px solid #f0f0f0',
};

export default LoginPage;
