import { Line } from '@ant-design/plots';
import { getLocale, useIntl, useRequest } from '@umijs/max';
import {
  Badge,
  Card,
  Col,
  Descriptions,
  Drawer,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Typography,
  theme,
} from 'antd';
import dayjs from 'dayjs';
import React, { useMemo } from 'react';
import TableEmptyState from '@/components/TableEmptyState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useThemeMode } from '@/hooks/useThemeMode';
import type {
  DeviceInfo,
  DeviceListResponse,
  RtcUserInfo,
  TokenStatsResponse,
  TopSession,
} from '../data';
import { getUserDevices, getUserTokenStats } from '../service';

const { Text } = Typography;

type UserDetailDrawerProps = {
  open: boolean;
  user: RtcUserInfo | null;
  onClose: () => void;
};

/**
 * 用户详情 Drawer
 *
 * 包含两个 Tab：
 * - 设备列表：显示用户所有设备及在线状态
 * - Token 消耗：统计卡片 + 趋势图表 + Top Sessions
 */
const UserDetailDrawer: React.FC<UserDetailDrawerProps> = ({
  open,
  user,
  onClose,
}) => {
  const intl = useIntl();
  const { token } = theme.useToken();

  // Use custom hook for robust theme detection
  const isDark = useThemeMode();
  const isMobile = useIsMobile();

  // 获取设备列表
  // NOTE: umi 内置的 useRequest 默认 formatResult: result => result?.data，
  // 而 request() 已经通过响应拦截器解包了 { success, data } 结构，
  // 所以此处需要用恒等函数覆盖，避免二次解包导致 data 为 undefined。
  const { data: devicesData, loading: devicesLoading } = useRequest(
    () => (user ? getUserDevices(user.id) : Promise.reject()),
    {
      ready: !!user,
      refreshDeps: [user?.id],
      formatResult: (res: unknown) => res,
    },
  ) as { data: DeviceListResponse | undefined; loading: boolean };

  // 获取 Token 统计 (同上 formatResult 说明)
  const { data: statsData, loading: statsLoading } = useRequest(
    () => (user ? getUserTokenStats(user.id, 30) : Promise.reject()),
    {
      ready: !!user,
      refreshDeps: [user?.id],
      formatResult: (res: unknown) => res,
    },
  ) as { data: TokenStatsResponse | undefined; loading: boolean };

  // 设备列表列定义
  const deviceColumns = [
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.deviceName',
        defaultMessage: 'Device name',
      }),
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.deviceId',
        defaultMessage: 'Device ID',
      }),
      dataIndex: 'device_id',
      key: 'device_id',
      ellipsis: true,
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.userAgent',
        defaultMessage: 'User-Agent',
      }),
      dataIndex: 'user_agent',
      key: 'user_agent',
      ellipsis: true,
      width: 200,
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.lastActiveAt',
        defaultMessage: 'Last active time',
      }),
      dataIndex: 'last_active_at',
      key: 'last_active_at',
      render: (_: unknown, record: DeviceInfo) =>
        dayjs(record.last_active_at).locale(getLocale()).format('L LT'),
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.registeredAt',
        defaultMessage: 'Registration time',
      }),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (_: unknown, record: DeviceInfo) =>
        dayjs(record.created_at).locale(getLocale()).format('L LT'),
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.status',
        defaultMessage: 'Status',
      }),
      key: 'status',
      render: (_: unknown, record: DeviceInfo) => (
        <Badge
          status={record.is_online ? 'success' : 'default'}
          text={
            record.is_online
              ? intl.formatMessage({
                  id: 'pages.rtcUsers.detail.online',
                  defaultMessage: 'Online',
                })
              : intl.formatMessage({
                  id: 'pages.rtcUsers.detail.offline',
                  defaultMessage: 'Offline',
                })
          }
        />
      ),
    },
  ];

  // Top Sessions 列定义
  const topSessionColumns = [
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.sessionTitle',
        defaultMessage: 'Session title',
      }),
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (_: unknown, record: TopSession) => (
        <a href={`/rtc-users/messages?session_id=${record.session_id}`}>
          {record.title || `Session ${record.session_id.slice(0, 8)}`}
        </a>
      ),
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.sessionTokens',
        defaultMessage: 'Token consumption',
      }),
      dataIndex: 'total_tokens',
      key: 'total_tokens',
      render: (_: unknown, record: TopSession) =>
        record.total_tokens.toLocaleString(),
      sorter: (a: TopSession, b: TopSession) => a.total_tokens - b.total_tokens,
      defaultSortOrder: 'descend' as const,
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.sessionCreatedAt',
        defaultMessage: 'Created at',
      }),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (_: unknown, record: TopSession) =>
        dayjs(record.created_at).locale(getLocale()).format('L LT'),
    },
  ];

  // 图表数据准备
  const chartData = useMemo(() => {
    if (!statsData?.daily_stats) return [];

    const data: Array<{
      date: string;
      type: string;
      value: number;
    }> = [];

    statsData.daily_stats.forEach(
      (stat: {
        date: string;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cached_read_tokens: number;
      }) => {
        data.push({
          date: stat.date,
          type: intl.formatMessage({
            id: 'pages.rtcUsers.detail.inputTokens',
            defaultMessage: 'Input Tokens',
          }),
          value: stat.total_input_tokens,
        });
        data.push({
          date: stat.date,
          type: intl.formatMessage({
            id: 'pages.rtcUsers.detail.outputTokens',
            defaultMessage: 'Output Tokens',
          }),
          value: stat.total_output_tokens,
        });
        data.push({
          date: stat.date,
          type: intl.formatMessage({
            id: 'pages.rtcUsers.detail.cachedTokens',
            defaultMessage: 'Cached Tokens',
          }),
          value: stat.total_cached_read_tokens,
        });
      },
    );

    return data;
  }, [statsData, intl]);

  // 图表配置
  const chartConfig = {
    data: chartData,
    xField: 'date',
    yField: 'value',
    colorField: 'type',
    axis: {
      x: {
        label: {
          autoRotate: true,
          autoHide: false,
          style: {
            fill: token.colorTextSecondary,
          },
        },
      },
      y: {
        labelFormatter: (v: number) => {
          if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
          if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
          return v;
        },
        label: {
          style: {
            fill: token.colorTextSecondary,
          },
        },
      },
    },
    tooltip: {
      channel: 'y',
      valueFormatter: (v: number) => v.toLocaleString(),
    },
    height: 300,
    autoFit: true,
    theme: isDark ? 'classicDark' : 'classic',
    style: {
      stroke: token.colorBorder,
    },
  };

  const titleSuffix = user ? ` - ${user.email || user.id.slice(0, 8)}` : '';

  return (
    <Drawer
      title={`${intl.formatMessage({
        id: 'pages.rtcUsers.detail.title',
        defaultMessage: 'User details',
      })}${titleSuffix}`}
      open={open}
      onClose={onClose}
      width={isMobile ? '90%' : 800}
      destroyOnHidden
    >
      {user && (
        <>
          <Descriptions
            column={2}
            bordered
            size="small"
            style={{ marginBottom: 24 }}
          >
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.userId',
                defaultMessage: 'User ID',
              })}
            >
              <Text copyable={{ text: user.id }}>{user.id}</Text>
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.email',
                defaultMessage: 'Email',
              })}
            >
              {user.email || '-'}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.name',
                defaultMessage: 'Name',
              })}
            >
              {user.name || '-'}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.provider',
                defaultMessage: 'Provider',
              })}
            >
              {user.provider}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.status',
                defaultMessage: 'Status',
              })}
            >
              <Badge
                status={user.status === 'active' ? 'success' : 'error'}
                text={
                  user.status === 'active'
                    ? intl.formatMessage({
                        id: 'pages.rtcUsers.statusActive',
                        defaultMessage: 'Normal',
                      })
                    : intl.formatMessage({
                        id: 'pages.rtcUsers.statusBanned',
                        defaultMessage: 'Banned',
                      })
                }
              />
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.createdAt',
                defaultMessage: 'Created at',
              })}
            >
              {dayjs(user.created_at).locale(getLocale()).format('L LT')}
            </Descriptions.Item>
          </Descriptions>

          <Tabs
            defaultActiveKey="devices"
            items={[
              {
                key: 'devices',
                label: intl.formatMessage({
                  id: 'pages.rtcUsers.detail.devices',
                  defaultMessage: 'Device list',
                }),
                children: (
                  <Table
                    dataSource={devicesData?.items || []}
                    columns={deviceColumns}
                    rowKey="id"
                    loading={devicesLoading}
                    pagination={false}
                    scroll={{ x: 1000 }}
                    locale={{
                      emptyText: (
                        <TableEmptyState
                          descriptionId="pages.rtcUsers.detail.noDevices"
                          defaultDescription="No devices"
                        />
                      ),
                    }}
                  />
                ),
              },
              {
                key: 'tokens',
                label: intl.formatMessage({
                  id: 'pages.rtcUsers.detail.tokens',
                  defaultMessage: 'Token consumption',
                }),
                children: (
                  <Space
                    direction="vertical"
                    size="large"
                    style={{ width: '100%' }}
                  >
                    {/* 统计卡片 */}
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.todayTokens',
                              defaultMessage: "Today's token",
                            })}
                            value={statsData?.summary.today_tokens || 0}
                            loading={statsLoading}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.weekTokens',
                              defaultMessage: "This week's token",
                            })}
                            value={statsData?.summary.week_tokens || 0}
                            loading={statsLoading}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.monthTokens',
                              defaultMessage: "This month's token",
                            })}
                            value={statsData?.summary.month_tokens || 0}
                            loading={statsLoading}
                          />
                        </Card>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.totalTokens',
                              defaultMessage: 'Total token',
                            })}
                            value={statsData?.summary.total_tokens || 0}
                            loading={statsLoading}
                          />
                        </Card>
                      </Col>
                    </Row>

                    {/* 趋势图表 */}
                    <Card
                      title={intl.formatMessage({
                        id: 'pages.rtcUsers.detail.trend',
                        defaultMessage:
                          'Token consumption trend (last 30 days)',
                      })}
                      size="small"
                      loading={statsLoading}
                    >
                      {chartData.length > 0 ? (
                        <Line {...chartConfig} />
                      ) : (
                        <div style={{ textAlign: 'center', padding: '40px 0' }}>
                          <Text type="secondary">
                            {intl.formatMessage({
                              id: 'pages.rtcUsers.detail.noStats',
                              defaultMessage: 'No statistics data',
                            })}
                          </Text>
                        </div>
                      )}
                    </Card>

                    {/* Top Sessions */}
                    <Card
                      title={intl.formatMessage({
                        id: 'pages.rtcUsers.detail.topSessions',
                        defaultMessage: 'Top Sessions',
                      })}
                      size="small"
                    >
                      <Table
                        dataSource={statsData?.top_sessions || []}
                        columns={topSessionColumns}
                        rowKey="session_id"
                        pagination={false}
                        locale={{
                          emptyText: (
                            <TableEmptyState
                              descriptionId="pages.rtcUsers.detail.noStats"
                              defaultDescription="No statistics data"
                            />
                          ),
                        }}
                      />
                    </Card>
                  </Space>
                ),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
};

export default UserDetailDrawer;
