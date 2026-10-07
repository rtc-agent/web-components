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
          // 统一跳回仪表盘首页，避免未登录用户被导向需权限的页面；
          // 后续可结合 access 信息细化管理员/普通用户跳转策略
          <Link to="/dashboard" prefetch>
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
