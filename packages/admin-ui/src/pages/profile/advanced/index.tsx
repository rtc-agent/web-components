import {
  DingdingOutlined,
  DownOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import {
  GridContent,
  PageContainer,
  RouteContext,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import { queryKeys } from '@/utils/queryKeys';
import { PROFILE_CACHE } from '@/utils/queryCacheConfig';
import type { DescriptionsProps } from 'antd';
import {
  Badge,
  Button,
  Card,
  Descriptions,
  Divider,
  Dropdown,
  Empty,
  Popover,
  Space,
  Statistic,
  Steps,
  Table,
  Tooltip,
  theme,
} from 'antd';
import type { IconRenderType, StepsProps } from 'antd/es/steps';
import type { FC } from 'react';
import React, { useState } from 'react';
import type { AdvancedProfileData } from './data.d';
import { queryAdvancedProfile } from './service';
import useStyles from './style.style';

type AdvancedState = {
  operationKey: 'tab1' | 'tab2' | 'tab3';
  tabActiveKey: string;
};

const Advanced: FC = () => {
  const { styles } = useStyles();
  const { token } = theme.useToken();
  const intl = useIntl();

  const [tabStatus, seTabStatus] = useState<AdvancedState>({
    operationKey: 'tab1',
    tabActiveKey: 'detail',
  });

  const { data = {}, isLoading: loading } = useQuery<AdvancedProfileData>({
    queryKey: queryKeys.profile.advanced(),
    queryFn: () => queryAdvancedProfile().then((res) => res.data),
    staleTime: PROFILE_CACHE.staleTime, // 5 minutes
    gcTime: PROFILE_CACHE.gcTime, // 30 minutes
  });
  const { advancedOperation1, advancedOperation2, advancedOperation3 } = data;

  // Action buttons for PageContainer
  const action = (
    <RouteContext.Consumer>
      {({ isMobile }) => {
        if (isMobile) {
          return (
            <Dropdown.Button
              type="primary"
              icon={<DownOutlined />}
              menu={{
                items: [
                  {
                    key: '1',
                    label: intl.formatMessage({
                      id: 'pages.profile.advanced.action1',
                    }),
                  },
                  {
                    key: '2',
                    label: intl.formatMessage({
                      id: 'pages.profile.advanced.action2',
                    }),
                  },
                  {
                    key: '3',
                    label: intl.formatMessage({
                      id: 'pages.profile.advanced.action3',
                    }),
                  },
                ],
              }}
              placement="bottomRight"
            >
              {intl.formatMessage({ id: 'pages.profile.advanced.mainAction' })}
            </Dropdown.Button>
          );
        }
        return (
          <Space>
            <Space.Compact>
              <Button>
                {intl.formatMessage({ id: 'pages.profile.advanced.action1' })}
              </Button>
              <Button>
                {intl.formatMessage({ id: 'pages.profile.advanced.action2' })}
              </Button>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: '1',
                      label: intl.formatMessage({
                        id: 'pages.profile.advanced.option1',
                      }),
                    },
                    {
                      key: '2',
                      label: intl.formatMessage({
                        id: 'pages.profile.advanced.option2',
                      }),
                    },
                    {
                      key: '3',
                      label: intl.formatMessage({
                        id: 'pages.profile.advanced.option3',
                      }),
                    },
                  ],
                }}
                placement="bottomRight"
              >
                <Button
                  aria-label={intl.formatMessage({
                    id: 'pages.profile.advanced.moreActions',
                  })}
                >
                  <EllipsisOutlined />
                </Button>
              </Dropdown>
            </Space.Compact>
            <Button type="primary">
              {intl.formatMessage({ id: 'pages.profile.advanced.mainAction' })}
            </Button>
          </Space>
        );
      }}
    </RouteContext.Consumer>
  );

  const operationTabList = [
    {
      key: 'tab1',
      tab: intl.formatMessage({ id: 'pages.profile.advanced.operationLog1' }),
    },
    {
      key: 'tab2',
      tab: intl.formatMessage({ id: 'pages.profile.advanced.operationLog2' }),
    },
    {
      key: 'tab3',
      tab: intl.formatMessage({ id: 'pages.profile.advanced.operationLog3' }),
    },
  ];

  const columns = [
    {
      title: intl.formatMessage({ id: 'pages.profile.advanced.operationType' }),
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.advanced.operator' }),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: intl.formatMessage({
        id: 'pages.profile.advanced.executionResult',
      }),
      dataIndex: 'status',
      key: 'status',
      render: (text: string) => {
        if (text === 'agree') {
          return (
            <Badge
              status="success"
              text={intl.formatMessage({
                id: 'pages.profile.advanced.success',
              })}
            />
          );
        }
        return (
          <Badge
            status="error"
            text={intl.formatMessage({ id: 'pages.profile.advanced.reject' })}
          />
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.advanced.operationTime' }),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.advanced.remark' }),
      dataIndex: 'memo',
      key: 'memo',
    },
  ];

  const descriptionItems: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({ id: 'pages.profile.advanced.creator' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.creatorName',
        defaultMessage: 'Qu Lili',
      }),
    },
    {
      key: '2',
      label: intl.formatMessage({ id: 'pages.profile.advanced.product' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.productName',
        defaultMessage: 'XX Service',
      }),
    },
    {
      key: '3',
      label: intl.formatMessage({ id: 'pages.profile.advanced.creationTime' }),
      children: '2017-07-07',
    },
    {
      key: '4',
      label: intl.formatMessage({
        id: 'pages.profile.advanced.relatedDocument',
      }),
      children: <a href="/">12421</a>,
    },
    {
      key: '5',
      label: intl.formatMessage({ id: 'pages.profile.advanced.effectiveDate' }),
      children: '2017-07-07 ~ 2017-08-08',
    },
    {
      key: '6',
      label: intl.formatMessage({ id: 'pages.profile.advanced.remark' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.remarkText',
        defaultMessage: 'Please confirm within two business days',
      }),
    },
  ];

  const infoGroupItems: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({ id: 'pages.profile.advanced.someData' }),
      children: '725',
    },
    {
      key: '2',
      label: intl.formatMessage({
        id: 'pages.profile.advanced.dataUpdateTime',
      }),
      children: '2017-08-08',
    },
    {
      key: '3',
      label: (
        <span>
          {intl.formatMessage({ id: 'pages.profile.advanced.someData' })}
          <Tooltip
            title={intl.formatMessage({
              id: 'pages.profile.advanced.dataNote',
            })}
          >
            <InfoCircleOutlined
              style={{
                color: token.colorTextDescription,
                marginInlineStart: 4,
              }}
            />
          </Tooltip>
        </span>
      ),
      children: '725',
    },
    {
      key: '4',
      label: intl.formatMessage({
        id: 'pages.profile.advanced.dataUpdateTime',
      }),
      children: '2017-08-08',
    },
  ];

  const userInfoItems: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({ id: 'pages.profile.advanced.userName' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.userNameValue',
        defaultMessage: 'Fu Xiaoxiao',
      }),
    },
    {
      key: '2',
      label: intl.formatMessage({ id: 'pages.profile.advanced.memberCard' }),
      children: '32943898021309809423',
    },
    {
      key: '3',
      label: intl.formatMessage({ id: 'pages.profile.advanced.idCard' }),
      children: '3321944288191034921',
    },
    {
      key: '4',
      label: intl.formatMessage({ id: 'pages.profile.advanced.contactInfo' }),
      children: '18112345678',
    },
    {
      key: '5',
      label: intl.formatMessage({
        id: 'pages.profile.advanced.contactAddress',
      }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.fullAddress',
        defaultMessage:
          'Qu Lili 18100000000 Huanggushan Road, Xihu District, Hangzhou, Zhejiang',
      }),
    },
  ];

  const groupItems1: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({ id: 'pages.profile.advanced.leader' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.leaderName',
        defaultMessage: 'Lin Dongdong',
      }),
    },
    {
      key: '2',
      label: intl.formatMessage({ id: 'pages.profile.advanced.roleCode' }),
      children: '1234567',
    },
    {
      key: '3',
      label: intl.formatMessage({ id: 'pages.profile.advanced.department' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.departmentName',
        defaultMessage: 'XX Company - YY Department',
      }),
    },
    {
      key: '4',
      label: intl.formatMessage({
        id: 'pages.profile.advanced.expirationTime',
      }),
      children: '2017-08-08',
    },
    {
      key: '5',
      label: intl.formatMessage({ id: 'pages.profile.advanced.description' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.longDescription',
        defaultMessage:
          'This description is very long very long very long very long very long very long very long very long very long very long very long very long...',
      }),
    },
  ];

  const groupItems2: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({
        id: 'pages.profile.advanced.scientificName',
      }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.scientificDescription',
        defaultMessage:
          'Citrullus lanatus (Thunb.) Matsum. et Nakai Annual trailing herb; thick stems and branches with prominent ridges. Thick tendrils..',
      }),
    },
  ];

  const groupItems3: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({ id: 'pages.profile.advanced.leader' }),
      children: intl.formatMessage({
        id: 'pages.profile.advanced.desc.userNameValue',
        defaultMessage: 'Fu Xiaoxiao',
      }),
    },
    {
      key: '2',
      label: intl.formatMessage({ id: 'pages.profile.advanced.roleCode' }),
      children: '1234568',
    },
  ];

  const customDot: IconRenderType = (dot: React.ReactNode, { active }) => {
    if (active) {
      const popoverContent = (
        <div
          style={{
            width: 160,
          }}
        >
          {intl.formatMessage({
            id: 'pages.profile.advanced.desc.stepPersonName',
            defaultMessage: 'Wu Jiahao',
          })}
          <span
            style={{
              float: 'inline-end',
            }}
          >
            <Badge
              status="default"
              text={
                <span
                  style={{
                    color: token.colorTextDescription,
                  }}
                >
                  {intl.formatMessage({
                    id: 'pages.profile.advanced.noResponse',
                  })}
                </span>
              }
            />
          </span>
          <div
            style={{
              marginTop: 4,
            }}
          >
            {intl.formatMessage({ id: 'pages.profile.advanced.timeConsuming' })}
          </div>
        </div>
      );
      return (
        <Popover
          placement="topLeft"
          arrow={{
            pointAtCenter: true,
          }}
          content={popoverContent}
        >
          <span>{dot}</span>
        </Popover>
      );
    }
    return dot;
  };

  const extra = (
    <div className={styles.moreInfo}>
      <Statistic
        title={intl.formatMessage({ id: 'pages.profile.advanced.status' })}
        value={intl.formatMessage({
          id: 'pages.profile.advanced.pendingApproval',
        })}
      />
      <Statistic
        title={intl.formatMessage({ id: 'pages.profile.advanced.orderAmount' })}
        value={568.08}
        prefix="¥"
      />
    </div>
  );

  const description = (
    <RouteContext.Consumer>
      {({ isMobile }) => (
        <Descriptions
          className={styles.headerList}
          size="small"
          column={isMobile ? 1 : 2}
          items={descriptionItems}
        />
      )}
    </RouteContext.Consumer>
  );

  const desc1 = (
    <div className={styles.stepDescription}>
      {intl.formatMessage({
        id: 'pages.profile.advanced.desc.creatorName',
        defaultMessage: 'Qu Lili',
      })}
      <DingdingOutlined
        style={{
          marginInlineStart: 8,
        }}
      />
      <div>2016-12-12 12:32</div>
    </div>
  );

  const desc2 = (
    <div className={styles.stepDescription}>
      {intl.formatMessage({
        id: 'pages.profile.advanced.desc.reviewerName',
        defaultMessage: 'Zhou Maomao',
      })}
      <DingdingOutlined
        style={{
          color: token.colorInfo,
          marginInlineStart: 8,
        }}
      />
      <div>
        <Button type="link" style={{ padding: 0 }}>
          {intl.formatMessage({ id: 'pages.profile.advanced.hurry' })}
        </Button>
      </div>
    </div>
  );

  const stepsItems: StepsProps['items'] = [
    {
      title: intl.formatMessage({ id: 'pages.profile.advanced.step1Title' }),
      content: desc1,
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.advanced.step2Title' }),
      content: desc2,
    },
    { title: intl.formatMessage({ id: 'pages.profile.advanced.step3Title' }) },
    { title: intl.formatMessage({ id: 'pages.profile.advanced.step4Title' }) },
  ];

  const contentList = {
    tab1: (
      <Table
        pagination={false}
        loading={loading}
        dataSource={advancedOperation1}
        columns={columns}
      />
    ),
    tab2: (
      <Table
        pagination={false}
        loading={loading}
        dataSource={advancedOperation2}
        columns={columns}
      />
    ),
    tab3: (
      <Table
        pagination={false}
        loading={loading}
        dataSource={advancedOperation3}
        columns={columns}
      />
    ),
  };

  const onTabChange = (tabActiveKey: string) => {
    seTabStatus({
      ...tabStatus,
      tabActiveKey,
    });
  };

  const onOperationTabChange = (key: string) => {
    seTabStatus({
      ...tabStatus,
      operationKey: key as 'tab1',
    });
  };

  return (
    <PageContainer
      title={intl.formatMessage({ id: 'pages.profile.advanced.orderNumber' })}
      extra={action}
      className={styles.pageHeader}
      content={description}
      extraContent={extra}
      tabActiveKey={tabStatus.tabActiveKey}
      onTabChange={onTabChange}
      tabList={[
        {
          key: 'detail',
          tab: intl.formatMessage({ id: 'pages.profile.advanced.detail' }),
        },
        {
          key: 'rule',
          tab: intl.formatMessage({ id: 'pages.profile.advanced.rule' }),
        },
      ]}
    >
      <div className={styles.main}>
        <GridContent>
          <Card
            title={intl.formatMessage({
              id: 'pages.profile.advanced.processProgress',
            })}
            style={{
              marginBottom: 24,
            }}
          >
            <RouteContext.Consumer>
              {({ isMobile }) => (
                <Steps
                  orientation={isMobile ? 'vertical' : 'horizontal'}
                  iconRender={customDot}
                  current={1}
                  items={stepsItems}
                />
              )}
            </RouteContext.Consumer>
          </Card>
          <Card
            title={intl.formatMessage({
              id: 'pages.profile.advanced.userInfo',
            })}
            style={{
              marginBottom: 24,
            }}
            variant="borderless"
          >
            <Descriptions
              style={{
                marginBottom: 24,
              }}
              items={userInfoItems}
            />
            <Descriptions
              style={{
                marginBottom: 24,
              }}
              title={intl.formatMessage({
                id: 'pages.profile.advanced.infoGroup',
              })}
              items={infoGroupItems}
            />
            <h4
              style={{
                marginBottom: 16,
              }}
            >
              {intl.formatMessage({ id: 'pages.profile.advanced.infoGroup' })}
            </h4>
            <Card
              type="inner"
              title={intl.formatMessage({
                id: 'pages.profile.advanced.multiLevelInfoGroup',
              })}
            >
              <Descriptions
                title={intl.formatMessage({
                  id: 'pages.profile.advanced.groupName',
                })}
                items={groupItems1}
              />
              <Divider size="large" />
              <Descriptions
                title={intl.formatMessage({
                  id: 'pages.profile.advanced.groupName',
                })}
                column={1}
                items={groupItems2}
              />
              <Divider size="large" />
              <Descriptions
                title={intl.formatMessage({
                  id: 'pages.profile.advanced.groupName',
                })}
                items={groupItems3}
              />
            </Card>
          </Card>
          <Card
            title={intl.formatMessage({
              id: 'pages.profile.advanced.recentCallRecords',
            })}
            style={{
              marginBottom: 24,
            }}
            variant="borderless"
          >
            <Empty />
          </Card>
          <Card
            variant="borderless"
            tabList={operationTabList}
            onTabChange={onOperationTabChange}
          >
            {contentList[tabStatus.operationKey] as React.ReactNode}
          </Card>
        </GridContent>
      </div>
    </PageContainer>
  );
};

export default Advanced;
