import { InboxOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl, useSearchParams } from '@umijs/max';
import { Button, Empty, Grid, Tag, theme } from 'antd';
import React, { useEffect, useMemo, useRef } from 'react';
import { disabledFutureDate, parseTableSort } from '../shared/tableUtils';
import type { SessionInfo } from './data';
import type { SessionPageAPI } from './page-api';
import { getSessionList } from './service';

const { useBreakpoint } = Grid;

/**
 * Session management page
 */
const SessionsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = searchParams.get('user_id') || '';
  const breakpoints = useBreakpoint();
  const isMobile = !breakpoints.md; // < 768px

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: SessionPageAPI = {
      // Sync URL filters and trigger table reload
      list: async (params = {}) => {
        const {
          userId: listUserId,
          status,
          search,
          startTime,
          endTime,
        } = params;

        // Sync filters to URL (no page refresh). Pagination is transient state, not synced.
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
        setSearchParams(newSearchParams, { replace: true });

        // Trigger table reload via actionRef (ProTable request will handle data fetching)
        actionRef.current?.reload();

        return {
          success: true,
          data: [],
          total: 0,
        };
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
          defaultMessage: 'User ID',
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
                defaultMessage: 'User ID is required',
              }),
            },
          ],
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.title',
          defaultMessage: 'Title',
        }),
        dataIndex: 'title',
        valueType: 'text',
        ellipsis: true,
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.status',
          defaultMessage: 'Status',
        }),
        dataIndex: 'status',
        valueType: 'select',
        valueEnum: {
          active: {
            text: intl.formatMessage({
              id: 'pages.sessions.statusActive',
              defaultMessage: 'Active',
            }),
            status: 'Success',
          },
          closed: {
            text: intl.formatMessage({
              id: 'pages.sessions.statusClosed',
              defaultMessage: 'Disabled',
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
                    defaultMessage: 'Active',
                  })
                : intl.formatMessage({
                    id: 'pages.sessions.statusClosed',
                    defaultMessage: 'Disabled',
                  })}
            </Tag>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.createdAt',
          defaultMessage: 'Created at',
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
          defaultMessage: 'Last active time',
        }),
        dataIndex: 'updated_at',
        valueType: 'dateTime',
        search: false,
        sorter: true,
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.totalTokens',
          defaultMessage: 'Token consumption',
        }),
        dataIndex: 'total_tokens',
        valueType: 'digit',
        search: false,
        sorter: true,
        render: (_, record) =>
          record.total_tokens != null
            ? record.total_tokens.toLocaleString()
            : '-',
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.timeRange',
          defaultMessage: 'Time range',
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
          defaultMessage: 'Search',
        }),
        dataIndex: 'search',
        valueType: 'text',
        hideInTable: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.sessions.actions',
          defaultMessage: 'Action',
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
              defaultMessage: 'View messages',
            })}
          </Button>
        ),
      },
    ],
    [intl, userId, isMobile],
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
            defaultMessage:
              'Please select a user from the user management page to view conversations',
          })}
        >
          <Button
            type="primary"
            onClick={() => history.push('/rtc-users/management')}
          >
            {intl.formatMessage({
              id: 'pages.sessions.goToUsers',
              defaultMessage: 'Go to user management',
            })}
          </Button>
        </Empty>
      ) : (
        <ProTable<SessionInfo>
          headerTitle={intl.formatMessage({
            id: 'pages.sessions.headerTitle',
            defaultMessage: 'Conversation list',
          })}
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          scroll={{ x: 'max-content' }}
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
                defaultMessage: 'Refresh',
              })}
            </Button>,
          ]}
          locale={{
            emptyText: (
              <Empty
                image={
                  <InboxOutlined
                    style={{ fontSize: 48, color: token.colorTextTertiary }}
                  />
                }
                description={intl.formatMessage({
                  id: 'pages.sessions.noData',
                  defaultMessage: 'No conversations found',
                })}
              />
            ),
          }}
        />
      )}
    </PageContainer>
  );
};

export default SessionsPage;
