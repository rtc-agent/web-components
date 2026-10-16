import { Link, useIntl } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';

const Exception500: React.FC = () => {
  const intl = useIntl();
  return (
    <Card variant="borderless">
      <Result
        status="500"
        title="500"
        subTitle={intl.formatMessage({
          id: 'pages.500.subTitle',
          defaultMessage: 'Sorry, something went wrong.',
        })}
        extra={
          <Link to="/" prefetch>
            <Button type="primary">
              {intl.formatMessage({
                id: 'pages.500.backHome',
                defaultMessage: 'Back Home',
              })}
            </Button>
          </Link>
        }
      />
    </Card>
  );
};

export default Exception500;
