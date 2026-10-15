import { useMutation, useQueryClient } from '@tanstack/react-query';
import { history, Link, useIntl } from '@umijs/max';
import { App, Button, Col, Form, Input, Row, Select, Space } from 'antd';
import type { Store } from 'antd/es/form/interface';
import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { queryKeys } from '@/utils/queryKeys';
import {
  getConfirmPasswordRules,
  getPasswordRules,
  getPhoneRules,
} from '@/utils/validation';
import { fakeRegister } from './service';
import useStyles from './style';

const FormItem = Form.Item;
const { Option } = Select;

const Register: FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const { message } = App.useApp();
  const [count, setCount]: [number, any] = useState(0);
  const [prefix, setPrefix]: [string, any] = useState('86');
  const intervalRef = useRef<number | undefined>(undefined);
  const queryClient = useQueryClient();

  const [form] = Form.useForm();
  useEffect(() => {
    return () => {
      // 组件卸载时清理 interval
      if (intervalRef.current !== undefined) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);
  const onGetCaptcha = () => {
    // 清理已存在的 interval，防止内存泄漏
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
    }

    let counts = 59;
    setCount(counts);
    intervalRef.current = window.setInterval(() => {
      counts -= 1;
      setCount(counts);
      if (counts === 0) {
        if (intervalRef.current !== undefined) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
      }
    }, 1000);
  };
  const { isPending: submitting, mutate: register } = useMutation({
    mutationFn: (formValues: Store) => {
      const payload = {
        mail: formValues.email,
        password: formValues.password,
        confirm: formValues.confirm,
        mobile: formValues.mobile,
        captcha: formValues.captcha,
        prefix: formValues.prefix,
      };
      return fakeRegister(payload);
    },
    onSuccess: (data, params) => {
      if (data.status === 'ok') {
        queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
        message.success(
          intl.formatMessage({
            id: 'pages.user.register.success',
            defaultMessage: 'Registration successful!',
          }),
        );
        history.push({
          pathname: `/user/register-result?account=${params.mail}`,
        });
      }
    },
    onError: (error: any) => {
      const errorMessage = getFriendlyErrorMessage(
        error,
        intl,
        intl.formatMessage({
          id: 'pages.user.register.failed',
          defaultMessage: 'Registration failed',
        }),
      );
      message.error(errorMessage);
    },
  });
  const onFinish = (values: Store) => {
    register(values);
  };
  const changePrefix = (value: string) => {
    setPrefix(value);
  };
  return (
    <div className={styles.main}>
      <h3>
        {intl.formatMessage({
          id: 'pages.user.register.title',
          defaultMessage: 'Register',
        })}
      </h3>
      <Form form={form} name="UserRegister" onFinish={onFinish}>
        <FormItem
          name="email"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.user.register.emailRequired',
                defaultMessage: 'Please enter your email address!',
              }),
            },
            {
              whitespace: true,
              message: intl.formatMessage({
                id: 'pages.user.register.emailWhitespace',
                defaultMessage: 'Email cannot be only spaces',
              }),
            },
            {
              type: 'email',
              message: intl.formatMessage({
                id: 'pages.user.register.emailInvalid',
                defaultMessage: 'The email address format is incorrect!',
              }),
            },
          ]}
        >
          <Input
            size="large"
            placeholder={intl.formatMessage({
              id: 'pages.user.register.emailPlaceholder',
              defaultMessage: 'Email',
            })}
          />
        </FormItem>
        <FormItem
          name="password"
          rules={getPasswordRules(intl.formatMessage.bind(intl), {
            required: true,
            min: 6,
            max: 128,
          }).map((rule) => {
            // Override the required message to use page-specific i18n key
            if ('required' in rule && rule.required) {
              return {
                ...rule,
                message: intl.formatMessage({
                  id: 'pages.user.register.passwordRequired',
                  defaultMessage: 'Please enter a password!',
                }),
              };
            }
            // Override the min message to use page-specific i18n key
            if ('min' in rule) {
              return {
                ...rule,
                message: intl.formatMessage({
                  id: 'pages.user.register.passwordMinLength',
                  defaultMessage: `Password must be at least ${rule.min} characters`,
                }),
              };
            }
            return rule;
          })}
        >
          <Input
            size="large"
            type="password"
            placeholder={intl.formatMessage({
              id: 'pages.user.register.passwordPlaceholder',
              defaultMessage: 'At least 6 characters, case sensitive',
            })}
          />
        </FormItem>
        <FormItem
          name="confirm"
          rules={getConfirmPasswordRules(
            intl.formatMessage.bind(intl),
            form,
          ).map((rule) => {
            // Override the required message to use page-specific i18n key
            if ('required' in rule && rule.required) {
              return {
                ...rule,
                message: intl.formatMessage({
                  id: 'pages.user.register.confirmPassword',
                  defaultMessage: 'Confirm Password',
                }),
              };
            }
            return rule;
          })}
        >
          <Input
            size="large"
            type="password"
            placeholder={intl.formatMessage({
              id: 'pages.user.register.confirmPasswordPlaceholder',
              defaultMessage: 'Confirm Password',
            })}
          />
        </FormItem>
        <FormItem
          name="mobile"
          rules={getPhoneRules(intl.formatMessage.bind(intl), {
            required: true,
            areaCode: prefix,
          }).map((rule) => {
            // Override the required message to use page-specific i18n key
            if ('required' in rule && rule.required) {
              return {
                ...rule,
                message: intl.formatMessage({
                  id: 'pages.user.register.phoneRequired',
                  defaultMessage: 'Please enter your phone number!',
                }),
              };
            }
            // Override the pattern message to use page-specific i18n key
            if ('pattern' in rule) {
              return {
                ...rule,
                message: intl.formatMessage({
                  id: 'pages.user.register.phoneInvalid',
                  defaultMessage: 'The phone number format is incorrect!',
                }),
              };
            }
            return rule;
          })}
        >
          <Space.Compact style={{ width: '100%' }}>
            <Select
              size="large"
              value={prefix}
              onChange={changePrefix}
              style={{
                width: '30%',
              }}
            >
              <Option value="86">+86</Option>
              <Option value="87">+87</Option>
            </Select>

            <Input
              size="large"
              placeholder={intl.formatMessage({
                id: 'pages.user.register.phonePlaceholder',
                defaultMessage: 'Phone Number',
              })}
            />
          </Space.Compact>
        </FormItem>
        <Row gutter={8}>
          <Col span={16}>
            <FormItem
              name="captcha"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({
                    id: 'pages.user.register.captchaRequired',
                    defaultMessage: 'Please enter the verification code!',
                  }),
                },
              ]}
            >
              <Input
                size="large"
                placeholder={intl.formatMessage({
                  id: 'pages.user.register.captchaPlaceholder',
                  defaultMessage: 'Verification Code',
                })}
              />
            </FormItem>
          </Col>
          <Col span={8}>
            <Button
              size="large"
              disabled={!!count}
              className={styles.getCaptcha}
              onClick={onGetCaptcha}
            >
              {count
                ? `${count} s`
                : intl.formatMessage({
                    id: 'pages.user.register.getCaptcha',
                    defaultMessage: 'Get Code',
                  })}
            </Button>
          </Col>
        </Row>
        <FormItem>
          <div className={styles.footer}>
            <Button
              size="large"
              loading={submitting}
              className={styles.submit}
              type="primary"
              htmlType="submit"
            >
              <span>
                {intl.formatMessage({
                  id: 'pages.user.register.register',
                  defaultMessage: 'Register',
                })}
              </span>
            </Button>
            <Link to="/user/login" prefetch>
              <span>
                {intl.formatMessage({
                  id: 'pages.user.register.loginLink',
                  defaultMessage: 'Log in with existing account',
                })}
              </span>
            </Link>
          </div>
        </FormItem>
      </Form>
    </div>
  );
};
export default Register;
