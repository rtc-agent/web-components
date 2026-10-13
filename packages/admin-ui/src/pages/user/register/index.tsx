import { useMutation, useQueryClient } from '@tanstack/react-query';
import { history, Link, useIntl } from '@umijs/max';
import {
  Button,
  Col,
  Form,
  Input,
  message,
  Popover,
  Progress,
  Row,
  Select,
  Space,
} from 'antd';
import type { Store } from 'antd/es/form/interface';
import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { queryKeys } from '@/utils/queryKeys';
import { fakeRegister } from './service';
import useStyles from './style';

const FormItem = Form.Item;
const { Option } = Select;

const passwordProgressMap: {
  ok: 'success';
  pass: 'normal';
  poor: 'exception';
} = {
  ok: 'success',
  pass: 'normal',
  poor: 'exception',
};

const getPasswordStatus = (value?: string) => {
  if (value && value.length > 9) {
    return 'ok';
  }
  if (value && value.length > 5) {
    return 'pass';
  }
  return 'poor';
};

const PasswordProgress: React.FC<{
  value?: string;
  styles: Record<string, string>;
}> = ({ value, styles }) => {
  const passwordStatus = getPasswordStatus(value);
  return value?.length ? (
    <div className={styles[`progress-${passwordStatus}`]}>
      <Progress
        status={passwordProgressMap[passwordStatus]}
        size={6}
        percent={value.length * 10 > 100 ? 100 : value.length * 10}
        showInfo={false}
      />
    </div>
  ) : null;
};

const Register: FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const [count, setCount]: [number, any] = useState(0);
  const [open, setVisible]: [boolean, any] = useState(false);
  const [prefix, setPrefix]: [string, any] = useState('86');
  const [popover, setPopover]: [boolean, any] = useState(false);
  const intervalRef = useRef<number | undefined>(undefined);
  const queryClient = useQueryClient();

  const passwordStatusMap = {
    ok: (
      <div className={styles.success}>
        <span>
          {intl.formatMessage({
            id: 'pages.user.register.strength.strong',
            defaultMessage: 'Strength: Strong',
          })}
        </span>
      </div>
    ),
    pass: (
      <div className={styles.warning}>
        <span>
          {intl.formatMessage({
            id: 'pages.user.register.strength.medium',
            defaultMessage: 'Strength: Medium',
          })}
        </span>
      </div>
    ),
    poor: (
      <div className={styles.error}>
        <span>
          {intl.formatMessage({
            id: 'pages.user.register.strength.short',
            defaultMessage: 'Strength: Too Short',
          })}
        </span>
      </div>
    ),
  };

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
      const errorMessage =
        error?.response?.data?.errorMessage ||
        error?.message ||
        intl.formatMessage({
          id: 'pages.user.register.failed',
          defaultMessage: 'Registration failed',
        });
      message.error(errorMessage);
    },
  });
  const onFinish = (values: Store) => {
    register(values);
  };
  const checkConfirm = (_: any, value: string) => {
    const promise = Promise;
    if (value && value !== form.getFieldValue('password')) {
      return promise.reject(
        intl.formatMessage({
          id: 'pages.user.register.passwordMismatch',
          defaultMessage: 'The passwords you entered do not match!',
        }),
      );
    }
    return promise.resolve();
  };
  const checkPassword = (_: any, value: string) => {
    const promise = Promise;
    if (!value) {
      setVisible(!!value);
      return promise.reject(
        intl.formatMessage({
          id: 'pages.user.register.passwordRequired',
          defaultMessage: 'Please enter a password!',
        }),
      );
    }
    if (!open) {
      setVisible(!!value);
    }
    setPopover(!popover);
    if (value.length < 6) {
      return promise.reject('');
    }
    if (value && form.isFieldTouched('confirm')) {
      form.validateFields(['confirm']);
    }
    return promise.resolve();
  };
  const changePrefix = (value: string) => {
    setPrefix(value);
  };
  const password = Form.useWatch('password', form);
  const passwordStatus = getPasswordStatus(password);
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
        <Popover
          getPopupContainer={(node) => {
            if (node?.parentNode) {
              return node.parentNode as HTMLElement;
            }
            return node;
          }}
          content={
            open && (
              <div
                style={{
                  padding: '4px 0',
                }}
              >
                {passwordStatusMap[passwordStatus]}
                <PasswordProgress value={password} styles={styles} />
                <div
                  style={{
                    marginTop: 10,
                  }}
                >
                  <span>
                    {intl.formatMessage({
                      id: 'pages.user.register.passwordTip',
                      defaultMessage:
                        'Please enter at least 6 characters. Please do not use a password that is easy to guess.',
                    })}
                  </span>
                </div>
              </div>
            )
          }
          overlayStyle={{
            width: 240,
          }}
          placement="right"
          open={open}
        >
          <FormItem
            name="password"
            className={
              form.getFieldValue('password') &&
              form.getFieldValue('password').length > 0 &&
              styles.password
            }
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'pages.user.register.passwordRequired',
                  defaultMessage: 'Please enter a password!',
                }),
              },
              {
                validator: checkPassword,
              },
            ]}
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
        </Popover>
        <FormItem
          name="confirm"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.user.register.confirmPassword',
                defaultMessage: 'Confirm Password',
              }),
            },
            {
              validator: checkConfirm,
            },
          ]}
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
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.user.register.phoneRequired',
                defaultMessage: 'Please enter your phone number!',
              }),
            },
            {
              pattern: /^\d{11}$/,
              message: intl.formatMessage({
                id: 'pages.user.register.phoneInvalid',
                defaultMessage: 'The phone number format is incorrect!',
              }),
            },
          ]}
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
