import { history, useIntl } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';

const Exception403: React.FC = () => {
  const intl = useIntl();

  const handleGoBack = () => {
    // 如果是从其他页面跳转来的，返回上一页
    if (window.history.length > 1) {
      history.back();
    } else {
      // 否则跳转到登录页（让用户重新登录）
      history.replace('/user/login');
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
