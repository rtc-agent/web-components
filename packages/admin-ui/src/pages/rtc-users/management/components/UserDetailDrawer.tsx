import { Line } from '@ant-design/plots';
import { useIntl, useRequest } from '@umijs/max';
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

  // Debug: 追踪数据流，确认 useRequest 返回的数据结构正确
  if (process.env.NODE_ENV === 'development') {
    console.log('[UserDetailDrawer] user:', user?.id);
    console.log('[UserDetailDrawer] devicesData:', devicesData);
    console.log('[UserDetailDrawer] devicesData?.items:', devicesData?.items);
    console.log('[UserDetailDrawer] statsData:', statsData);
    console.log(
      '[UserDetailDrawer] statsData?.top_sessions:',
      statsData?.top_sessions,
    );
  }

  // 设备列表列定义
  const deviceColumns = [
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.deviceName',
        defaultMessage: '设备名称',
      }),
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.deviceId',
        defaultMessage: '设备 ID',
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
        defaultMessage: '最后活跃时间',
      }),
      dataIndex: 'last_active_at',
      key: 'last_active_at',
      render: (_: unknown, record: DeviceInfo) =>
        dayjs(record.last_active_at).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.registeredAt',
        defaultMessage: '注册时间',
      }),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (_: unknown, record: DeviceInfo) =>
        dayjs(record.created_at).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.detail.status',
        defaultMessage: '状态',
      }),
      key: 'status',
      render: (_: unknown, record: DeviceInfo) => (
        <Badge
          status={record.is_online ? 'success' : 'default'}
          text={
            record.is_online
              ? intl.formatMessage({
                  id: 'pages.rtcUsers.detail.online',
                  defaultMessage: '在线',
                })
              : intl.formatMessage({
                  id: 'pages.rtcUsers.detail.offline',
                  defaultMessage: '离线',
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
        defaultMessage: 'Session 标题',
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
        defaultMessage: 'Token 消耗',
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
        defaultMessage: '创建时间',
      }),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (_: unknown, record: TopSession) =>
        dayjs(record.created_at).format('YYYY-MM-DD HH:mm:ss'),
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
    theme: token.colorBgContainer === '#ffffff' ? 'classic' : 'classicDark',
  };

  const titleSuffix = user ? ` - ${user.email || user.id.slice(0, 8)}` : '';

  return (
    <Drawer
      title={`${intl.formatMessage({
        id: 'pages.rtcUsers.detail.title',
        defaultMessage: '用户详情',
      })}${titleSuffix}`}
      open={open}
      onClose={onClose}
      size={800}
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
                defaultMessage: '用户ID',
              })}
            >
              <Text copyable={{ text: user.id }}>{user.id}</Text>
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.email',
                defaultMessage: '邮箱',
              })}
            >
              {user.email || '-'}
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.name',
                defaultMessage: '姓名',
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
                defaultMessage: '状态',
              })}
            >
              <Badge
                status={user.status === 'active' ? 'success' : 'error'}
                text={
                  user.status === 'active'
                    ? intl.formatMessage({
                        id: 'pages.rtcUsers.statusActive',
                        defaultMessage: '正常',
                      })
                    : intl.formatMessage({
                        id: 'pages.rtcUsers.statusBanned',
                        defaultMessage: '已封禁',
                      })
                }
              />
            </Descriptions.Item>
            <Descriptions.Item
              label={intl.formatMessage({
                id: 'pages.rtcUsers.createdAt',
                defaultMessage: '创建时间',
              })}
            >
              {dayjs(user.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
          </Descriptions>

          <Tabs
            defaultActiveKey="devices"
            items={[
              {
                key: 'devices',
                label: intl.formatMessage({
                  id: 'pages.rtcUsers.detail.devices',
                  defaultMessage: '设备列表',
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
                      emptyText: intl.formatMessage({
                        id: 'pages.rtcUsers.detail.noDevices',
                        defaultMessage: '暂无设备',
                      }),
                    }}
                  />
                ),
              },
              {
                key: 'tokens',
                label: intl.formatMessage({
                  id: 'pages.rtcUsers.detail.tokens',
                  defaultMessage: 'Token 消耗',
                }),
                children: (
                  <Space
                    orientation="vertical"
                    size="large"
                    style={{ width: '100%' }}
                  >
                    {/* 统计卡片 */}
                    <Row gutter={16}>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.todayTokens',
                              defaultMessage: '今日 Token',
                            })}
                            value={statsData?.summary.today_tokens || 0}
                            loading={statsLoading}
                          />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.weekTokens',
                              defaultMessage: '本周 Token',
                            })}
                            value={statsData?.summary.week_tokens || 0}
                            loading={statsLoading}
                          />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.monthTokens',
                              defaultMessage: '本月 Token',
                            })}
                            value={statsData?.summary.month_tokens || 0}
                            loading={statsLoading}
                          />
                        </Card>
                      </Col>
                      <Col span={6}>
                        <Card size="small">
                          <Statistic
                            title={intl.formatMessage({
                              id: 'pages.rtcUsers.detail.totalTokens',
                              defaultMessage: '总计 Token',
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
                        defaultMessage: 'Token 消耗趋势（最近 30 天）',
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
                              defaultMessage: '暂无统计数据',
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
                          emptyText: intl.formatMessage({
                            id: 'pages.rtcUsers.detail.noStats',
                            defaultMessage: '暂无统计数据',
                          }),
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
