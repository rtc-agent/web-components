import { InboxOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Empty, Tag, theme } from 'antd';
import React, { useEffect, useMemo, useRef } from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { disabledFutureDate, parseTableSort } from '../shared/tableUtils';
import type { SessionInfo } from './data';
import type { SessionPageAPI } from './page-api';
import { getSessionList } from './service';

/**
 * Session management page
 */
const SessionsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const intl = useIntl();
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = searchParams.get('user_id') || '';

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: SessionPageAPI = {
      // Read table data
      list: async (params = {}) => {
        const {
          current = 1,
          pageSize = 10,
          userId: listUserId,
          status,
          search,
          startTime,
          endTime,
          sortBy,
          sortOrder,
        } = params;

        // Sync URL (no page refresh)
        const newSearchParams = new URLSearchParams();
        const effectiveUserId = listUserId || userId;
        if (effectiveUserId) {
          newSearchParams.set('user_id', effectiveUserId);
        }
        if (status) {
          newSearchParams.set('status', status);
        }
        if (search) {
          newSearchParams.set('search', search);
        }
        if (startTime) {
          newSearchParams.set('start_time', startTime);
        }
        if (endTime) {
          newSearchParams.set('end_time', endTime);
        }
        newSearchParams.set('current', String(current));
        newSearchParams.set('pageSize', String(pageSize));
        setSearchParams(newSearchParams, { replace: true });

        // Call service
        if (!effectiveUserId) {
          return { success: true, data: [], total: 0 };
        }

        try {
          const response = await getSessionList({
            user_id: effectiveUserId,
            page: current,
            page_size: pageSize,
            status,
            search,
            start_time: startTime,
            end_time: endTime,
            sort_by: sortBy,
            sort_order: sortOrder,
          });

          return {
            success: true,
            data: response.items,
            total: response.total,
          };
        } catch (error) {
          console.error('[Session Page API] list failed:', error);
          return {
            success: false,
            data: [],
            total: 0,
            error: 'Failed to fetch session list',
          };
        }
      },

      // Refresh table
      refresh: async () => {
        actionRef.current?.reload();
      },
    };

    // Register to global
    window.__pages__ = window.__pages__ || {};
    window.__pages__.rtcSession = pageAPI;

    // Dispatch ready event
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'rtcSession' } }),
    );

    console.log('[SessionsPage] Page API registered');

    // Cleanup
    return () => {
      delete window.__pages__?.rtcSession;
      console.log('[SessionsPage] Page API unregistered');
    };
  }, []);

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    actionRef.current?.reload();
  }, [searchParams]);

  const { token } = theme.useToken();

  /** Table column definitions */
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
            // Read params from searchParams (URL is single source of truth)
            const effectiveUserId = searchParams.get('user_id') || userId;
            if (!effectiveUserId) {
              return { data: [], total: 0, success: true };
            }
            const status = searchParams.get('status') || undefined;
            const search = searchParams.get('search') || undefined;
            const startTime = searchParams.get('start_time') || undefined;
            const endTime = searchParams.get('end_time') || undefined;
            const current = params.current || 1;
            const pageSize = params.pageSize || 10;
            try {
              const sortParams = parseTableSort(sort || {});
              const response = await getSessionList({
                user_id: effectiveUserId,
                page: current,
                page_size: pageSize,
                status,
                search,
                start_time: startTime,
                end_time: endTime,
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
          form={{
            initialValues: {
              user_id: searchParams.get('user_id') || '',
              status: searchParams.get('status') || undefined,
              search: searchParams.get('search') || undefined,
            },
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
