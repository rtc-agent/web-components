import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import {
  LoginForm,
  ProFormCaptcha,
  ProFormCheckbox,
  ProFormText,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  FormattedMessage,
  Helmet,
  SelectLang,
  useIntl,
  useModel,
} from '@umijs/max';
import { Alert, App, Button, Skeleton, Tabs } from 'antd';
import { createStyles } from 'antd-style';
import React, { startTransition, useEffect, useState } from 'react';
import { Footer } from '@/components';
import { CONFIG_CACHE } from '@/utils/queryCacheConfig';
import { queryKeys } from '@/utils/queryKeys';
import type { LoginResult } from './service';
import {
  getLoginConfig,
  login,
  loginWithOTP,
  sendEmailOTP,
} from './service';
import { setTokens, setUserInfo } from '@/utils/auth-storage';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import Settings from '../../../../config/defaultSettings';

/**
 * Validate redirect URL to prevent open redirect attacks.
 * Only allow same-origin relative paths starting with '/'.
 */
const getSafeRedirectUrl = (redirect: string | null): string => {
  if (!redirect?.startsWith('/')) return '/';

  if (redirect.startsWith('//')) return '/';

  try {
    const parsed = new URL(redirect, window.location.origin);
    if (parsed.origin !== window.location.origin) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
};

const useStyles = createStyles(({ token }) => {
  return {
    lang: {
      width: 42,
      height: 42,
      lineHeight: '42px',
      position: 'fixed',
      right: 16,
      borderRadius: token.borderRadius,
      ':hover': {
        backgroundColor: token.colorBgTextHover,
      },
    },
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'auto',
      // 背景图 + 主题色兜底，保证暗色模式下仍有合适背景
      backgroundColor: token.colorBgLayout,
      backgroundImage:
        "url('https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/V-_oS6r-i7wAAAAAAAAAAAAAFl94AQBr')",
      backgroundSize: '100% 100%',
    },
  };
});

const Lang = () => {
  const { styles } = useStyles();

  return (
    <div className={styles.lang} data-lang>
      {SelectLang && <SelectLang />}
    </div>
  );
};

const LoginMessage: React.FC<{
  content: string;
}> = ({ content }) => {
  return (
    <Alert
      style={{
        marginBottom: 24,
      }}
      message={content}
      type="error"
      showIcon
    />
  );
};

/** 登录表单字段类型 */
type LoginValues = {
  email: string;
  password?: string;
  otp?: string;
};

/**
 * 登录成功后的统一处理：保存凭证、提示、拉取用户信息并跳转。
 * 抽离此函数避免 handlePasswordLogin / handleOTPLogin 重复逻辑。
 */
const handleLoginSuccess = async (
  result: LoginResult,
  handlers: {
    setTokensFn: typeof setTokens;
    setUserInfoFn: typeof setUserInfo;
    fetchUserInfo: () => Promise<void>;
    messageSuccess: (msg: string) => void;
    successText: string;
  },
): Promise<boolean> => {
  if (!result.access_token || !result.refresh_token) return false;

  // 异步存储 token（需要加密）
  await handlers.setTokensFn(
    result.access_token,
    result.refresh_token,
    result.expires_in || 3600,
  );
  handlers.setUserInfoFn(result.user);
  handlers.messageSuccess(handlers.successText);
  try {
    await handlers.fetchUserInfo();
  } catch (error) {
    // P2-FIX: Log fetchUserInfo failure for debugging, but don't block login flow.
    // The user info will be re-fetched on subsequent page loads.
    console.warn(
      '[Login] fetchUserInfo failed after successful login, will retry on next page load:',
      error,
    );
  }

  const urlParams = new URL(window.location.href).searchParams;
  const redirectUrl = getSafeRedirectUrl(urlParams.get('redirect'));
  window.location.href = redirectUrl;
  return true;
};

const Login: React.FC = () => {
  const [userLoginState, setUserLoginState] = useState<{
    status?: string;
    message?: string;
  }>({});
  const [type, setType] = useState<string>('account');
  // 提交中状态，用于禁用按钮并展示 loading
  const [submitting, setSubmitting] = useState(false);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { styles } = useStyles();
  const { message } = App.useApp();
  const intl = useIntl();

  // 获取登录配置；失败时回退到「密码 + 验证码都启用」的默认值，
  // 保证登录页在配置接口异常时仍可正常使用。
  const { data: loginConfig, isLoading: configLoading } = useQuery({
    queryKey: queryKeys.loginConfig(),
    queryFn: getLoginConfig,
    staleTime: CONFIG_CACHE.staleTime, // 5 minutes
    gcTime: CONFIG_CACHE.gcTime, // 30 minutes
    placeholderData: { password_enabled: true, otp_enabled: true },
  });

  // Set default login method based on what's available
  useEffect(() => {
    if (loginConfig && !configLoading) {
      if (!loginConfig.password_enabled && loginConfig.otp_enabled) {
        setType('email-otp');
      } else if (loginConfig.password_enabled) {
        setType('account');
      }
    }
  }, [loginConfig, configLoading]);

  const fetchUserInfo = async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      startTransition(() => {
        setInitialState((s) => ({
          ...s,
          currentUser: userInfo,
        }));
      });
    }
  };

  /** 密码登录 */
  const handlePasswordLogin = async (values: {
    email: string;
    password: string;
  }) => {
    try {
      const result = await login({
        email: values.email,
        password: values.password,
      });

      const successText = intl.formatMessage({
        id: 'pages.login.success',
        defaultMessage: 'Login successful!',
      });

      const handled = await handleLoginSuccess(result, {
        setTokensFn: setTokens,
        setUserInfoFn: setUserInfo,
        fetchUserInfo,
        messageSuccess: message.success,
        successText,
      });
      if (handled) return;

      setUserLoginState({
        status: 'error',
        message: intl.formatMessage({
          id: 'pages.login.failure',
          defaultMessage: 'Login failed, please try again',
        }),
      });
    } catch (error: unknown) {
      const defaultLoginFailureMessage = intl.formatMessage({
        id: 'pages.login.failure',
        defaultMessage: 'Login failed, please try again!',
      });

      const err = error as { response?: { status?: number } };
      if (err.response?.status === 401) {
        setUserLoginState({
          status: 'error',
          message: intl.formatMessage({
            id: 'pages.login.invalidCredentials',
            defaultMessage: 'Email or password error',
          }),
        });
      } else {
        message.error(
          getFriendlyErrorMessage(error, intl, defaultLoginFailureMessage),
        );
        setUserLoginState({
          status: 'error',
          message: defaultLoginFailureMessage,
        });
      }
    }
  };

  /** 邮箱验证码登录 */
  const handleOTPLogin = async (values: { email: string; otp: string }) => {
    try {
      const result = await loginWithOTP({
        email: values.email,
        otp: values.otp,
      });

      const successText = intl.formatMessage({
        id: 'pages.login.success',
        defaultMessage: 'Login successful!',
      });

      const handled = await handleLoginSuccess(result, {
        setTokensFn: setTokens,
        setUserInfoFn: setUserInfo,
        fetchUserInfo,
        messageSuccess: message.success,
        successText,
      });
      if (handled) return;

      setUserLoginState({
        status: 'error',
        message: intl.formatMessage({
          id: 'pages.login.failure',
          defaultMessage: 'Login failed, please try again',
        }),
      });
    } catch (error: unknown) {
      const defaultLoginFailureMessage = intl.formatMessage({
        id: 'pages.login.failure',
        defaultMessage: 'Login failed, please try again!',
      });

      const err = error as {
        response?: { data?: { errorCode?: string } };
      };
      const errorCode = err?.response?.data?.errorCode;
      if (errorCode === 'invalid_otp') {
        setUserLoginState({
          status: 'error',
          message: intl.formatMessage({
            id: 'pages.login.captcha.invalidOrExpired',
            defaultMessage: 'Verification code is incorrect or has expired',
          }),
        });
      } else if (errorCode === 'locked') {
        setUserLoginState({
          status: 'error',
          message: intl.formatMessage({
            id: 'pages.login.captcha.locked',
            defaultMessage:
              'Verification code function has been temporarily locked, please try again later',
          }),
        });
      } else {
        message.error(
          getFriendlyErrorMessage(error, intl, defaultLoginFailureMessage),
        );
        setUserLoginState({
          status: 'error',
          message: defaultLoginFailureMessage,
        });
      }
    }
  };

  /** 表单提交统一入口，管理 submitting 状态 */
  const handleSubmit = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      if (type === 'email-otp') {
        await handleOTPLogin(values as { email: string; otp: string });
      } else {
        await handlePasswordLogin(
          values as { email: string; password: string },
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const { status } = userLoginState;

  // 邮箱输入框共享配置（账户登录 & 验证码登录复用）
  const emailFieldConfig = {
    name: 'email' as const,
    fieldProps: {
      size: 'large' as const,
      prefix: type === 'email-otp' ? <MailOutlined /> : <UserOutlined />,
    },
    placeholder: intl.formatMessage({
      id: 'pages.login.email.placeholder',
      defaultMessage: 'Email',
    }),
    rules: [
      {
        required: true,
        message: (
          <FormattedMessage
            id="pages.login.email.required"
            defaultMessage="Please enter email!"
          />
        ),
      },
      {
        type: 'email' as const,
        message: (
          <FormattedMessage
            id="pages.login.email.invalid"
            defaultMessage="Invalid email format!"
          />
        ),
      },
    ],
  };

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          {intl.formatMessage({
            id: 'menu.login',
            defaultMessage: 'Login page',
          })}
          {Settings.title && ` - ${Settings.title}`}
        </title>
      </Helmet>
      <Lang />
      <div
        style={{
          flex: '1',
          padding: '32px 0',
        }}
      >
        {configLoading ? (
          <div
            style={{
              minWidth: 280,
              maxWidth: '75vw',
              margin: '0 auto',
            }}
          >
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : (
          <LoginForm
            contentStyle={{
              minWidth: 280,
              maxWidth: '75vw',
            }}
            logo={
              <img
                alt={intl.formatMessage({
                  id: 'pages.login.logoAlt',
                  defaultMessage: 'Login page Logo',
                })}
                src="/logo.svg"
              />
            }
            title={Settings.title || 'RTC Agent'}
            subTitle={intl.formatMessage({
              id: 'pages.layouts.userLayout.title',
              defaultMessage:
                'Ant Design is the most influential web design specification in Xihu district',
            })}
            initialValues={{
              autoLogin: true,
            }}
            submitter={{
              submitButtonProps: {
                loading: submitting,
                disabled: submitting,
              },
            }}
            onFinish={handleSubmit}
          >
            <Tabs
              activeKey={type}
              onChange={setType}
              centered
              items={[
                ...(loginConfig?.password_enabled !== false
                  ? [
                      {
                        key: 'account',
                        label: intl.formatMessage({
                          id: 'pages.login.accountLogin.tab',
                          defaultMessage: 'Account password login',
                        }),
                      },
                    ]
                  : []),
                ...(loginConfig?.otp_enabled !== false
                  ? [
                      {
                        key: 'email-otp',
                        label: intl.formatMessage({
                          id: 'pages.login.emailOTP.tab',
                          defaultMessage: 'Email verification code login',
                        }),
                      },
                    ]
                  : []),
              ]}
            />

          {status === 'error' && (
            <LoginMessage
              content={
                userLoginState.message ||
                intl.formatMessage({
                  id: 'pages.login.failure',
                  defaultMessage: 'Login failed',
                })
              }
            />
          )}

          {type === 'account' && (
            <>
              <ProFormText {...emailFieldConfig} />
              <ProFormText.Password
                name="password"
                fieldProps={{
                  size: 'large',
                  prefix: <LockOutlined />,
                }}
                placeholder={intl.formatMessage({
                  id: 'pages.login.password.placeholder',
                  defaultMessage: 'Password',
                })}
                rules={[
                  {
                    required: true,
                    message: (
                      <FormattedMessage
                        id="pages.login.password.required"
                        defaultMessage="Please enter password!"
                      />
                    ),
                  },
                ]}
              />
            </>
          )}

          {type === 'email-otp' && (
            <>
              {/* 邮箱字段复用共享配置，仅覆盖前缀图标 */}
              <ProFormText
                name={emailFieldConfig.name}
                fieldProps={emailFieldConfig.fieldProps}
                placeholder={emailFieldConfig.placeholder}
                rules={emailFieldConfig.rules}
              />
              <ProFormCaptcha
                fieldProps={{
                  size: 'large',
                  prefix: <LockOutlined />,
                }}
                captchaProps={{
                  size: 'large',
                  type: 'primary',
                  ghost: true,
                }}
                placeholder={intl.formatMessage({
                  id: 'pages.login.captcha.placeholder',
                  defaultMessage: 'Please enter verification code',
                })}
                captchaTextRender={(timing, count) => {
                  if (timing) {
                    return `${count} ${intl.formatMessage({
                      id: 'pages.getCaptchaSecondText',
                      defaultMessage: 'Get verification code',
                    })}`;
                  }
                  return intl.formatMessage({
                    id: 'pages.login.phoneLogin.getVerificationCode',
                    defaultMessage: 'Get verification code',
                  });
                }}
                name="otp"
                phoneName="email"
                rules={[
                  {
                    required: true,
                    message: (
                      <FormattedMessage
                        id="pages.login.captcha.required"
                        defaultMessage="Please enter verification code!"
                      />
                    ),
                  },
                  {
                    len: 6,
                    message: (
                      <FormattedMessage
                        id="pages.login.captcha.invalid"
                        defaultMessage="Verification code is 6 digits"
                      />
                    ),
                  },
                ]}
                onGetCaptcha={async (email) => {
                  try {
                    await sendEmailOTP({ email });
                    message.success(
                      intl.formatMessage({
                        id: 'pages.login.captcha.sent',
                        defaultMessage:
                          'Verification code has been sent, please check your email',
                      }),
                    );
                  } catch (error: unknown) {
                    const err = error as {
                      response?: { data?: { errorCode?: string } };
                    };
                    const errorCode = err?.response?.data?.errorCode;
                    if (errorCode === 'rate_limited') {
                      message.warning(
                        intl.formatMessage({
                          id: 'pages.login.captcha.rateLimited',
                          defaultMessage:
                            'Too many requests, please try again later',
                        }),
                      );
                    } else {
                      message.error(
                        getFriendlyErrorMessage(
                          error,
                          intl,
                          intl.formatMessage({
                            id: 'pages.login.captcha.sendFailed',
                            defaultMessage:
                              'Failed to send verification code, please try again later',
                          }),
                        ),
                      );
                    }
                    // 抛出错误以触发 ProFormCaptcha 内部重置倒计时
                    throw error;
                  }
                }}
              />
            </>
          )}

          {loginConfig?.password_enabled !== false && (
            <div
              style={{
                marginBottom: 24,
              }}
            >
              <ProFormCheckbox noStyle name="autoLogin">
                <FormattedMessage
                  id="pages.login.rememberMe"
                  defaultMessage="Auto login"
                />
              </ProFormCheckbox>
              <Button
                type="link"
                style={{
                  float: 'inline-end',
                  padding: 0,
                }}
              >
                <FormattedMessage
                  id="pages.login.forgotPassword"
                  defaultMessage="Forgot password"
                />
              </Button>
            </div>
          )}
          </LoginForm>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default Login;
