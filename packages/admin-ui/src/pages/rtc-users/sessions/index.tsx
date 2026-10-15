import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl } from '@umijs/max';
import { App, Button, Tag } from 'antd';
import React, { useCallback, useMemo, useRef } from 'react';
import { TableEmptyState } from '@/components';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { useTableSearchParams } from '@/hooks/useTableSearchParams';
import {
  createTableRequest,
  disabledFutureDate,
  parseTableSort,
} from '@/utils/tableUtils';
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
  const tableParams = useTableSearchParams<{
    user_id: string;
    status: string;
    search: string;
    start_time: string;
    end_time: string;
  }>();
  const userId = tableParams.getParam('user_id') || '';
  const isMobile = useIsMobile(); // < 768px

  // === Register Page API ===
  usePageAPIRegistration(
    'rtcSession',
    useCallback(
      (): SessionPageAPI => ({
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
          const effectiveUserId = listUserId || userId;
          tableParams.set({
            user_id: effectiveUserId,
            status,
            search,
            start_time: startTime,
            end_time: endTime,
          });

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
      }),
      [tableParams, userId],
    ),
  );

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
            ? intl.formatNumber(record.total_tokens)
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
        <TableEmptyState
          descriptionId="pages.sessions.emptyHint"
          defaultDescription="Please select a user from the user management page to view conversations"
          action={
            <Button
              type="primary"
              onClick={() => history.push('/rtc-users/management')}
            >
              {intl.formatMessage({
                id: 'pages.sessions.goToUsers',
                defaultMessage: 'Go to user management',
              })}
            </Button>
          }
        />
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
          request={createTableRequest(
            async (params, sort) => {
              // Read params from URL (single source of truth)
              const {
                user_id: effectiveUserId = userId,
                status,
                search,
                start_time: startTime,
                end_time: endTime,
              } = tableParams.get();

              if (!effectiveUserId) {
                return { items: [], total: 0 };
              }
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
                items: response.items,
                total: response.total,
              };
            },
            message,
            intl,
            {
              id: 'pages.sessions.loadFailed',
              defaultMessage: 'Failed to load sessions',
            },
          )}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
          }}
          search={{
            labelWidth: 'auto',
          }}
          form={{
            initialValues: tableParams.get(),
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
              <TableEmptyState
                descriptionId="pages.sessions.noData"
                defaultDescription="No conversations found"
              />
            ),
          }}
        />
      )}
    </PageContainer>
  );
};

export default SessionsPage;
