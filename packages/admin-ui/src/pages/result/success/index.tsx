import { DingdingOutlined } from '@ant-design/icons';
import { GridContent } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Button, Card, Descriptions, Result, Steps, theme } from 'antd';
import React from 'react';
import useStyles from './index.style';

const Success: React.FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const { token } = theme.useToken();

  const descriptionItems = [
    {
      key: 'id',
      label: intl.formatMessage({
        id: 'pages.result.success.descriptionItems.id',
        defaultMessage: 'Project ID',
      }),
      children: '23421',
    },
    {
      key: 'owner',
      label: intl.formatMessage({
        id: 'pages.result.success.descriptionItems.owner',
        defaultMessage: 'Owner',
      }),
      children: intl.formatMessage({
        id: 'pages.result.success.desc.owner',
        defaultMessage: 'Qu Lili',
      }),
    },
    {
      key: 'time',
      label: intl.formatMessage({
        id: 'pages.result.success.descriptionItems.time',
        defaultMessage: 'Effective Time',
      }),
      children: '2016-12-12 ~ 2017-12-12',
    },
  ];

  const extra = (
    <>
      <Button type="primary">
        {intl.formatMessage({
          id: 'pages.result.success.extra.back',
          defaultMessage: 'Back to List',
        })}
      </Button>
      <Button>
        {intl.formatMessage({
          id: 'pages.result.success.extra.view',
          defaultMessage: 'View Project',
        })}
      </Button>
      <Button>
        {intl.formatMessage({
          id: 'pages.result.success.extra.print',
          defaultMessage: 'Print',
        })}
      </Button>
    </>
  );

  const desc1 = (
    <div className={styles.title}>
      <div
        style={{
          margin: '8px 0 4px',
        }}
      >
        <span>
          {intl.formatMessage({
            id: 'pages.result.success.desc.owner',
            defaultMessage: 'Qu Lili',
          })}
        </span>
        <DingdingOutlined
          style={{
            marginInlineStart: 8,
            color: token.colorInfo,
          }}
        />
      </div>
      <div>2016-12-12 12:32</div>
    </div>
  );

  const desc2 = (
    <div
      style={{
        fontSize: 12,
      }}
      className={styles.title}
    >
      <div
        style={{
          margin: '8px 0 4px',
        }}
      >
        <span>
          {intl.formatMessage({
            id: 'pages.result.success.desc.owner2',
            defaultMessage: 'Zhou Maomao',
          })}
        </span>
        <Button type="link" style={{ padding: 0 }}>
          <DingdingOutlined
            style={{
              color: token.colorInfo,
              marginInlineStart: 8,
            }}
          />
          <span>
            {intl.formatMessage({
              id: 'pages.result.success.desc.hurry',
              defaultMessage: 'Urge',
            })}
          </span>
        </Button>
      </div>
    </div>
  );

  const content = (
    <>
      <Descriptions
        title={intl.formatMessage({
          id: 'pages.result.success.desc.projectName',
          defaultMessage: 'Project Name',
        })}
        items={descriptionItems}
      />
      <br />
      <Steps
        type="dot"
        current={1}
        items={[
          {
            title: (
              <span
                style={{
                  fontSize: 14,
                }}
              >
                {intl.formatMessage({
                  id: 'pages.result.success.step.create',
                  defaultMessage: 'Create Project',
                })}
              </span>
            ),
            content: desc1,
          },
          {
            title: (
              <span
                style={{
                  fontSize: 14,
                }}
              >
                {intl.formatMessage({
                  id: 'pages.result.success.step.review1',
                  defaultMessage: 'Department Review',
                })}
              </span>
            ),
            content: desc2,
          },
          {
            title: (
              <span
                style={{
                  fontSize: 14,
                }}
              >
                {intl.formatMessage({
                  id: 'pages.result.success.step.review2',
                  defaultMessage: 'Financial Review',
                })}
              </span>
            ),
          },
          {
            title: (
              <span
                style={{
                  fontSize: 14,
                }}
              >
                {intl.formatMessage({
                  id: 'pages.result.success.step.done',
                  defaultMessage: 'Complete',
                })}
              </span>
            ),
          },
        ]}
      />
    </>
  );

  return (
    <GridContent>
      <Card variant="borderless">
        <Result
          status="success"
          title={intl.formatMessage({
            id: 'pages.result.success.title',
            defaultMessage: 'Submission Successful',
          })}
          subTitle={intl.formatMessage({
            id: 'pages.result.success.subTitle',
            defaultMessage:
              'The result page is used to provide feedback on the processing result of a series of tasks.',
          })}
          extra={extra}
          style={{
            marginBottom: 16,
          }}
        >
          {content}
        </Result>
      </Card>
    </GridContent>
  );
};

export default Success;
