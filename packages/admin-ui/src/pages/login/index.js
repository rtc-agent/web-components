import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Login Page
 *
 * Admin authentication page using Ant Design Form.
 * Validates email format and password length, calls authStore.login(),
 * and redirects to Dashboard on success.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Alert, Typography, Space } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
const { Title, Text } = Typography;
const LoginPage = () => {
    const navigate = useNavigate();
    const { login, isLoading, error, isAuthenticated, clearAuth } = useAuthStore();
    const [form] = Form.useForm();
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
    const handleSubmit = async (values) => {
        try {
            await login(values.email, values.password);
            navigate('/dashboard', { replace: true });
        }
        catch {
            // Error is handled by the store and displayed via the error state
        }
    };
    return (_jsx("div", { style: containerStyle, children: _jsx(Card, { style: cardStyle, children: _jsxs(Space, { direction: "vertical", size: "large", style: { width: '100%' }, children: [_jsxs("div", { style: headerStyle, children: [_jsx(Title, { level: 2, style: { margin: 0, textAlign: 'center' }, children: "RTC Agent" }), _jsx(Text, { type: "secondary", style: { display: 'block', textAlign: 'center', marginTop: 8 }, children: "Admin Console" })] }), error && (_jsx(Alert, { message: "Login Failed", description: error, type: "error", showIcon: true, closable: true })), _jsxs(Form, { form: form, layout: "vertical", onFinish: handleSubmit, autoComplete: "off", size: "large", children: [_jsx(Form.Item, { name: "email", label: "Email", rules: [
                                    { required: true, message: 'Please enter your email' },
                                    { type: 'email', message: 'Please enter a valid email address' },
                                ], children: _jsx(Input, { prefix: _jsx(UserOutlined, {}), placeholder: "admin@example.com" }) }), _jsx(Form.Item, { name: "password", label: "Password", rules: [
                                    { required: true, message: 'Please enter your password' },
                                    { min: 6, message: 'Password must be at least 6 characters' },
                                ], children: _jsx(Input.Password, { prefix: _jsx(LockOutlined, {}), placeholder: "Enter your password" }) }), _jsx(Form.Item, { style: { marginBottom: 0 }, children: _jsx(Button, { type: "primary", htmlType: "submit", loading: isLoading, block: true, children: "Sign In" }) })] })] }) }) }));
};
// ========== Styles ==========
const containerStyle = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: 24,
};
const cardStyle = {
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
    borderRadius: 8,
};
const headerStyle = {
    paddingBottom: 8,
    borderBottom: '1px solid #f0f0f0',
};
export default LoginPage;
//# sourceMappingURL=index.js.map