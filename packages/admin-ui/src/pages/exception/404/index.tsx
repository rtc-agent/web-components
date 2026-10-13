import { Link, useIntl } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';

const Exception404: React.FC = () => {
  const intl = useIntl();
  return (
    <Card variant="borderless">
      <Result
        status="404"
        title="404"
        subTitle={intl.formatMessage({ id: 'pages.404.subTitle' })}
        extra={
          // 统一跳回个人中心，避免未登录用户被导向需权限的页面；
          // 个人中心对所有已认证用户可见，是安全的默认跳转目标
          <Link to="/account/center" prefetch>
            <Button type="primary">
              {intl.formatMessage({ id: 'pages.404.buttonText' })}
            </Button>
          </Link>
        }
      />
    </Card>
  );
};

export default Exception404;
