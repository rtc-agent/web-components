import { Link, useIntl, useSearchParams } from '@umijs/max';
import { Button, Result } from 'antd';
import React from 'react';
import useStyles from './style.style';

const RegisterResult: React.FC<Record<string, unknown>> = () => {
  const { styles } = useStyles();
  const [params] = useSearchParams();
  const intl = useIntl();

  const actions = (
    <div className={styles.actions}>
      <Button size="large" type="primary">
        <span>
          {intl.formatMessage({
            id: 'pages.user.registerResult.viewEmail',
            defaultMessage: 'Check Email',
          })}
        </span>
      </Button>
      <Link to="/" prefetch>
        <Button size="large">
          {intl.formatMessage({
            id: 'pages.user.registerResult.backHome',
            defaultMessage: 'Back Home',
          })}
        </Button>
      </Link>
    </div>
  );

  const email = params?.get('account') || 'AntDesign@example.com';
  return (
    <Result
      className={styles.registerResult}
      status="success"
      title={
        <div className={styles.title}>
          <span>
            {intl.formatMessage(
              {
                id: 'pages.user.registerResult.title',
                defaultMessage:
                  'Your account: {email} has been registered successfully',
              },
              { email },
            )}
          </span>
        </div>
      }
      subTitle={intl.formatMessage({
        id: 'pages.user.registerResult.subTitle',
        defaultMessage:
          'The activation email has been sent to your email. The email is valid for 24 hours. Please log in to your email in time and click the link in the email to activate your account.',
      })}
      extra={actions}
    />
  );
};
export default RegisterResult;
