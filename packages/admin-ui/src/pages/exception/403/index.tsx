import { history, useIntl } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';
import { isAuthenticated } from '@/utils/auth-storage';

const Exception403: React.FC = () => {
  const intl = useIntl();

  const handleGoBack = () => {
    // If no auth, redirect to login; otherwise go back or home
    if (!isAuthenticated()) {
      history.replace('/user/login');
    } else if (window.history.length > 1) {
      history.back();
    } else {
      // Authenticated but no history: go to the root for permission-based redirect
      history.replace('/');
    }
  };

  return (
    <Card variant="borderless">
      <Result
        status="403"
        title="403"
        subTitle={intl.formatMessage({ id: 'pages.403.subTitle' })}
        extra={
          <Button type="primary" onClick={handleGoBack}>
            {intl.formatMessage({ id: 'pages.403.backHome' })}
          </Button>
        }
      />
    </Card>
  );
};

export default Exception403;
