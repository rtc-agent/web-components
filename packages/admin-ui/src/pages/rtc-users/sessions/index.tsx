import { InboxOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Empty, Tag, theme } from 'antd';
import React, { useEffect, useMemo, useRef } from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { disabledFutureDate, parseTableSort } from '../shared/tableUtils';
import type { SessionInfo } from './data';
import { getSessionList } from './service';

/**
 * Session 管理页面
 */
const SessionsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const intl = useIntl();
  const { message } = App.useApp();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('user_id') || '';

  // URL 参数变化时刷新表格
  useEffect(() => {
    if (userId) {
      actionRef.current?.reload();
    }
  }, [userId]);

  const { token } = theme.useToken();

  /** 表格列定义 */
  const columns: ProColumns<SessionInfo>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.sessions.userId',
          defaultMessage: '用户 ID',
        }),
        dataIndex: 'user_id',
        valueType: 'text',
        hideInTable: true,
        initialValue: userId,
        formItemProps: {
          rules: [
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.sessions.userIdRequired',
                defaultMessage: '用户 ID 为必填项',
              }),
            },
          ],
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.title',
          defaultMessage: '标题',
        }),
        dataIndex: 'title',
        valueType: 'text',
        ellipsis: true,
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.status',
          defaultMessage: '状态',
        }),
        dataIndex: 'status',
        valueType: 'select',
        valueEnum: {
          active: {
            text: intl.formatMessage({
              id: 'pages.sessions.statusActive',
              defaultMessage: '活跃',
            }),
            status: 'Success',
          },
          closed: {
            text: intl.formatMessage({
              id: 'pages.sessions.statusClosed',
              defaultMessage: '已关闭',
            }),
            status: 'Default',
          },
        },
        render: (_, record) => {
          const isActive = record.status === 'active';
          return (
            <Tag color={isActive ? 'green' : 'default'}>
              {isActive
                ? intl.formatMessage({
                    id: 'pages.sessions.statusActive',
                    defaultMessage: '活跃',
                  })
                : intl.formatMessage({
                    id: 'pages.sessions.statusClosed',
                    defaultMessage: '已关闭',
                  })}
            </Tag>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.createdAt',
          defaultMessage: '创建时间',
        }),
        dataIndex: 'created_at',
        valueType: 'dateTime',
        search: false,
        sorter: true,
        defaultSortOrder: 'descend',
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.updatedAt',
          defaultMessage: '最后活跃时间',
        }),
        dataIndex: 'updated_at',
        valueType: 'dateTime',
        search: false,
        sorter: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.totalTokens',
          defaultMessage: 'Token 消耗',
        }),
        dataIndex: 'total_tokens',
        valueType: 'digit',
        search: false,
        sorter: true,
        render: (_, record) => record.total_tokens.toLocaleString(),
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.timeRange',
          defaultMessage: '时间范围',
        }),
        dataIndex: 'time_range',
        valueType: 'dateRange',
        hideInTable: true,
        fieldProps: {
          disabledDate: disabledFutureDate,
        },
        search: {
          transform: (value: [string, string]) => ({
            start_time: `${value[0]}T00:00:00Z`,
            end_time: `${value[1]}T23:59:59Z`,
          }),
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.search',
          defaultMessage: '搜索',
        }),
        dataIndex: 'search',
        valueType: 'text',
        hideInTable: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.actions',
          defaultMessage: '操作',
        }),
        dataIndex: 'option',
        valueType: 'option',
        render: (_text, record) => (
          <Button
            type="link"
            size="small"
            onClick={() =>
              history.push(`/rtc-users/messages?session_id=${record.id}`)
            }
          >
            {intl.formatMessage({
              id: 'pages.sessions.viewMessages',
              defaultMessage: '查看消息',
            })}
          </Button>
        ),
      },
    ],
    [intl, userId],
  );

  return (
    <PageContainer>
      {!userId ? (
        <Empty
          image={
            <InboxOutlined
              style={{ fontSize: 64, color: token.colorTextTertiary }}
            />
          }
          description={intl.formatMessage({
            id: 'pages.sessions.emptyHint',
            defaultMessage: '请从用户管理页面选择用户以查看对话列表',
          })}
        >
          <Button
            type="primary"
            onClick={() => history.push('/rtc-users/management')}
          >
            {intl.formatMessage({
              id: 'pages.sessions.goToUsers',
              defaultMessage: '前往用户管理',
            })}
          </Button>
        </Empty>
      ) : (
        <ProTable<SessionInfo>
          headerTitle={intl.formatMessage({
            id: 'pages.sessions.headerTitle',
            defaultMessage: '对话列表',
          })}
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          request={async (params, sort) => {
            const {
              current,
              pageSize,
              user_id: _user_id,
              keyword,
              ...restParams
            } = params;
            // 优先使用 URL 参数中的 userId，确保导航切换用户时数据正确
            const effectiveUserId = userId || _user_id;
            if (!effectiveUserId) {
              return { data: [], total: 0, success: true };
            }
            try {
              const sortParams = parseTableSort(sort || {});
              const response = await getSessionList({
                user_id: effectiveUserId,
                page: current,
                page_size: pageSize,
                status: restParams.status,
                search: restParams.search,
                start_time: restParams.start_time,
                end_time: restParams.end_time,
                ...sortParams,
              });
              return {
                data: response.items,
                total: response.total,
                success: true,
              };
            } catch (error: unknown) {
              message.error(
                getFriendlyErrorMessage(
                  error,
                  intl.formatMessage({
                    id: 'pages.sessions.loadFailed',
                    defaultMessage: '加载对话列表失败',
                  }),
                ),
              );
              return { data: [], total: 0, success: false };
            }
          }}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
          }}
          search={{
            labelWidth: 'auto',
          }}
          options={{
            reload: true,
            density: true,
            setting: true,
          }}
          toolBarRender={() => [
            <Button key="refresh" onClick={() => actionRef.current?.reload()}>
              {intl.formatMessage({
                id: 'pages.sessions.refresh',
                defaultMessage: '刷新',
              })}
            </Button>,
          ]}
        />
      )}
    </PageContainer>
  );
};

export default SessionsPage;
