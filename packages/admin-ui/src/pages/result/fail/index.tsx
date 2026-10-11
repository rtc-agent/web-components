import { CloseCircleOutlined, RightOutlined } from '@ant-design/icons';
import { GridContent } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import useStyles from './index.style';

export default () => {
  const { styles } = useStyles();
  const intl = useIntl();

  const Content = (
    <>
      <div className={styles.title}>
        <span>
          {intl.formatMessage({
            id: 'pages.result.fail.errorTitle',
            defaultMessage:
              'The content you submitted has the following errors:',
          })}
        </span>
      </div>
      <div
        style={{
          marginBottom: 16,
        }}
      >
        <CloseCircleOutlined
          style={{
            marginRight: 8,
          }}
          className={styles.error_icon}
        />
        <span>
          {intl.formatMessage({
            id: 'pages.result.fail.error.accountFrozen',
            defaultMessage: 'Your account has been frozen',
          })}
        </span>
        <Button
          type="link"
          style={{
            marginLeft: 16,
            padding: 0,
          }}
        >
          <span>
            {intl.formatMessage({
              id: 'pages.result.fail.error.unfreeze',
              defaultMessage: 'Unfreeze Now',
            })}
          </span>
          <RightOutlined />
        </Button>
      </div>
      <div>
        <CloseCircleOutlined
          style={{
            marginRight: 8,
          }}
          className={styles.error_icon}
        />
        <span>
          {intl.formatMessage({
            id: 'pages.result.fail.error.notQualified',
            defaultMessage: 'Your account is not yet eligible to apply',
          })}
        </span>
        <Button
          type="link"
          style={{
            marginLeft: 16,
            padding: 0,
          }}
        >
          <span>
            {intl.formatMessage({
              id: 'pages.result.fail.error.upgrade',
              defaultMessage: 'Upgrade Now',
            })}
          </span>
          <RightOutlined />
        </Button>
      </div>
    </>
  );

  return (
    <GridContent>
      <Card variant="borderless">
        <Result
          status="error"
          title={intl.formatMessage({
            id: 'pages.result.fail.title',
            defaultMessage: 'Submission Failed',
          })}
          subTitle={intl.formatMessage({
            id: 'pages.result.fail.subTitle',
            defaultMessage:
              'Please verify and modify the following information before resubmitting.',
          })}
          extra={
            <Button type="primary">
              <span>
                {intl.formatMessage({
                  id: 'pages.result.fail.extra.back',
                  defaultMessage: 'Back to Modify',
                })}
              </span>
            </Button>
          }
          style={{
            marginTop: 48,
            marginBottom: 16,
          }}
        >
          {Content}
        </Result>
      </Card>
    </GridContent>
  );
};
