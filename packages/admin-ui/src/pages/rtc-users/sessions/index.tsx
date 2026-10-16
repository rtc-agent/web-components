import { InboxOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Empty, Grid, Tag, theme } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
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
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = searchParams.get('user_id') || '';
  const breakpoints = useBreakpoint();
  const isMobile = !breakpoints.md; // < 768px
  const [loading, setLoading] = useState(false);

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: SessionPageAPI = {
      // Query session list - sync URL and return data
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

        const effectiveUserId = listUserId || userId;

        // 1. Sync URL (based on existing searchParams)
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('current', String(current));
        newSearchParams.set('pageSize', String(pageSize));
        if (effectiveUserId) {
          newSearchParams.set('user_id', effectiveUserId);
        } else {
          newSearchParams.delete('user_id');
        }
        if (status) {
          newSearchParams.set('status', status);
        } else {
          newSearchParams.delete('status');
        }
        if (search) {
          newSearchParams.set('search', search);
        } else {
          newSearchParams.delete('search');
        }
        if (startTime) {
          newSearchParams.set('start_time', startTime);
        } else {
          newSearchParams.delete('start_time');
        }
        if (endTime) {
          newSearchParams.set('end_time', endTime);
        } else {
          newSearchParams.delete('end_time');
        }
        setSearchParams(newSearchParams, { replace: true });

        // 2. Call service to get data (matches ProTable request logic)
        if (!effectiveUserId) {
          console.warn('[SessionsPage] list called without user_id');
          return {
            success: false,
            data: [],
            total: 0,
            error: 'user_id is required',
          };
        }

        try {
          const response = await getSessionList({
            user_id: effectiveUserId,
            page: current,
            page_size: pageSize,
            status: status || undefined,
            search: search || undefined,
            start_time: startTime || undefined,
            end_time: endTime || undefined,
            sort_by: sortBy || undefined,
            sort_order: sortOrder || undefined,
          });

          return {
            success: true,
            data: response.items || [],
            total: response.total || 0,
          };
        } catch (error) {
          console.error('[SessionsPage] list failed:', error);
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
          loading={loading}
          request={async (params, sort) => {
            // Read params from searchParams (URL is single source of truth)
            const effectiveUserId = searchParams.get('user_id') || userId;
            if (!effectiveUserId) {
              return { data: [], total: 0, success: true };
            }
            setLoading(true);
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
                    defaultMessage: 'Failed to load conversations',
                  }),
                ),
              );
              return { data: [], total: 0, success: false };
            } finally {
              setLoading(false);
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
