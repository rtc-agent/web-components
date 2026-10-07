import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import {
  LoginForm,
  ProFormCaptcha,
  ProFormCheckbox,
  ProFormText,
} from '@ant-design/pro-components';
import {
  FormattedMessage,
  Helmet,
  SelectLang,
  useIntl,
  useModel,
} from '@umijs/max';
import { Alert, App, Button, Tabs } from 'antd';
import { createStyles } from 'antd-style';
import React, { startTransition, useEffect, useState } from 'react';
import { Footer } from '@/components';
import {
  getLoginConfig,
  type LoginResult,
  login,
  loginWithOTP,
  sendEmailOTP,
} from '@/services/admin-auth';
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
      title={content}
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

  handlers.setTokensFn(
    result.access_token,
    result.refresh_token,
    result.expires_in || 3600,
  );
  handlers.setUserInfoFn(result.user);
  handlers.messageSuccess(handlers.successText);
  try {
    await handlers.fetchUserInfo();
  } catch {
    // fetchUserInfo 失败不影响登录流程，后续页面加载会重试
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
  const [loginConfig, setLoginConfig] = useState<{
    password_enabled: boolean;
    otp_enabled: boolean;
  } | null>(null);
  // 提交中状态，用于禁用按钮并展示 loading
  const [submitting, setSubmitting] = useState(false);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { styles } = useStyles();
  const { message } = App.useApp();
  const intl = useIntl();

  // 获取登录配置；失败时回退到「密码 + 验证码都启用」的默认值，
  // 保证登录页在配置接口异常时仍可正常使用。
  useEffect(() => {
    getLoginConfig()
      .then((config) => {
        setLoginConfig(config);
        // Set default login method based on what's available
        if (!config.password_enabled && config.otp_enabled) {
          setType('email-otp');
        } else if (config.password_enabled) {
          setType('account');
        }
      })
      .catch(() => {
        // 配置获取失败：默认启用密码与验证码登录，避免因接口异常阻塞用户
        message.warning(
          intl.formatMessage({
            id: 'pages.login.configLoadFailed',
            defaultMessage: '登录配置加载失败，使用默认设置',
          }),
        );
        setLoginConfig({ password_enabled: true, otp_enabled: true });
      });
  }, []);

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
        defaultMessage: '登录成功！',
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
          defaultMessage: '登录失败，请重试',
        }),
      });
    } catch (error: unknown) {
      const defaultLoginFailureMessage = intl.formatMessage({
        id: 'pages.login.failure',
        defaultMessage: '登录失败，请重试！',
      });

      const err = error as { response?: { status?: number } };
      if (err.response?.status === 401) {
        setUserLoginState({
          status: 'error',
          message: intl.formatMessage({
            id: 'pages.login.invalidCredentials',
            defaultMessage: '邮箱或密码错误',
          }),
        });
      } else {
        message.error(
          getFriendlyErrorMessage(error, defaultLoginFailureMessage),
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
        defaultMessage: '登录成功！',
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
          defaultMessage: '登录失败，请重试',
        }),
      });
    } catch (error: unknown) {
      const defaultLoginFailureMessage = intl.formatMessage({
        id: 'pages.login.failure',
        defaultMessage: '登录失败，请重试！',
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
            defaultMessage: '验证码错误或已过期',
          }),
        });
      } else if (errorCode === 'locked') {
        setUserLoginState({
          status: 'error',
          message: intl.formatMessage({
            id: 'pages.login.captcha.locked',
            defaultMessage: '验证码功能已暂时锁定，请稍后再试',
          }),
        });
      } else {
        message.error(
          getFriendlyErrorMessage(error, defaultLoginFailureMessage),
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
      defaultMessage: '邮箱',
    }),
    rules: [
      {
        required: true,
        message: (
          <FormattedMessage
            id="pages.login.email.required"
            defaultMessage="请输入邮箱!"
          />
        ),
      },
      {
        type: 'email' as const,
        message: (
          <FormattedMessage
            id="pages.login.email.invalid"
            defaultMessage="邮箱格式不正确!"
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
            defaultMessage: '登录页',
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
        <LoginForm
          contentStyle={{
            minWidth: 280,
            maxWidth: '75vw',
          }}
          logo={
            <img
              alt={intl.formatMessage({
                id: 'pages.login.logoAlt',
                defaultMessage: '登录页 Logo',
              })}
              src="/logo.svg"
            />
          }
          title={Settings.title || 'RTC Agent'}
          subTitle={intl.formatMessage({
            id: 'pages.layouts.userLayout.title',
            defaultMessage: 'Ant Design 是西湖区最具影响力的 Web 设计规范',
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
                        defaultMessage: '账户密码登录',
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
                        defaultMessage: '邮箱验证码登录',
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
                  defaultMessage: '登录失败',
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
                  defaultMessage: '密码',
                })}
                rules={[
                  {
                    required: true,
                    message: (
                      <FormattedMessage
                        id="pages.login.password.required"
                        defaultMessage="请输入密码！"
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
                  defaultMessage: '请输入验证码',
                })}
                captchaTextRender={(timing, count) => {
                  if (timing) {
                    return `${count} ${intl.formatMessage({
                      id: 'pages.getCaptchaSecondText',
                      defaultMessage: '获取验证码',
                    })}`;
                  }
                  return intl.formatMessage({
                    id: 'pages.login.phoneLogin.getVerificationCode',
                    defaultMessage: '获取验证码',
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
                        defaultMessage="请输入验证码！"
                      />
                    ),
                  },
                  {
                    len: 6,
                    message: (
                      <FormattedMessage
                        id="pages.login.captcha.invalid"
                        defaultMessage="验证码为 6 位数字"
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
                        defaultMessage: '验证码已发送，请查收邮箱',
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
                          defaultMessage: '请求过于频繁，请稍后再试',
                        }),
                      );
                    } else {
                      message.error(
                        getFriendlyErrorMessage(
                          error,
                          intl.formatMessage({
                            id: 'pages.login.captcha.sendFailed',
                            defaultMessage: '发送验证码失败，请稍后重试',
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
                  defaultMessage="自动登录"
                />
              </ProFormCheckbox>
              <Button
                type="link"
                style={{
                  float: 'right',
                  padding: 0,
                }}
              >
                <FormattedMessage
                  id="pages.login.forgotPassword"
                  defaultMessage="忘记密码"
                />
              </Button>
            </div>
          )}
        </LoginForm>
      </div>
      <Footer />
    </div>
  );
};

export default Login;
