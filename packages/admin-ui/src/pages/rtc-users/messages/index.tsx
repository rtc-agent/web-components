import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl } from '@umijs/max';
import { App, Button, Tag } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TableEmptyState } from '@/components';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { useProTableLocale } from '@/hooks/useProTableLocale';
import { useTableSearchParams } from '@/hooks/useTableSearchParams';
import {
  createTableRequest,
  disabledFutureDate,
  parseTableSort,
} from '@/utils/tableUtils';
import MessageDetailDrawer from './components/MessageDetailDrawer';
import type { MessageInfo } from './data';
import type { MessagePageAPI } from './page-api';
import { getMessageList } from './service';

/**
 * Message Management Page
 */
const MessagesPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const intl = useIntl();
  const { message } = App.useApp();
  const tableParams = useTableSearchParams<{
    session_id: string;
    role: string;
    created_after: string;
    created_before: string;
  }>();
  const sessionId = tableParams.getParam('session_id') || '';
  const isMobile = useIsMobile();
  const tableLocale = useProTableLocale(
    'pages.messages.noData',
    'No messages found',
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<MessageInfo | null>(
    null,
  );

  // === Register Page API ===
  usePageAPIRegistration(
    'rtcMessage',
    useCallback(
      (): MessagePageAPI => ({
        // Sync URL filters and trigger table reload
        list: async (params = {}) => {
          const { sessionId: listSessionId, role, startTime, endTime } = params;

          // Sync filters to URL (no page refresh). Pagination is transient state, not synced.
          const effectiveSessionId = listSessionId || sessionId;
          tableParams.set({
            session_id: effectiveSessionId,
            role,
            created_after: startTime,
            created_before: endTime,
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
      [tableParams, sessionId],
    ),
  );

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    if (sessionId) {
      actionRef.current?.reload();
    }
  }, [tableParams]);

  /** Open message detail drawer */
  const handleRowClick = useCallback((record: MessageInfo) => {
    setCurrentMessage(record);
    setDrawerOpen(true);
  }, []);

  /** Table column definitions */
  const columns: ProColumns<MessageInfo>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.messages.sessionId',
          defaultMessage: 'Session ID',
        }),
        dataIndex: 'session_id',
        valueType: 'text',
        hideInTable: true,
        initialValue: sessionId,
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.role',
          defaultMessage: 'Role',
        }),
        dataIndex: 'role',
        valueType: 'select',
        valueEnum: {
          user: {
            text: intl.formatMessage({
              id: 'pages.messages.role.user',
              defaultMessage: 'User',
            }),
            status: 'Processing',
          },
          assistant: {
            text: intl.formatMessage({
              id: 'pages.messages.role.assistant',
              defaultMessage: 'Assistant',
            }),
            status: 'Success',
          },
        },
        render: (_, record) => {
          const isUser = record.role === 'user';
          return (
            <Tag color={isUser ? 'blue' : 'green'}>
              {isUser
                ? intl.formatMessage({
                    id: 'pages.messages.role.user',
                    defaultMessage: 'User',
                  })
                : intl.formatMessage({
                    id: 'pages.messages.role.assistant',
                    defaultMessage: 'Assistant',
                  })}
            </Tag>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.content',
          defaultMessage: 'Content',
        }),
        dataIndex: 'content',
        valueType: 'text',
        search: false,
        ellipsis: true,
        width: 400,
        render: (_, record) => {
          // Message content is stored as JSON string: '{"type":"text","data":"hello"}'
          // Extract readable summary text based on the type field for table display
          // Fallback to plain text for legacy non-JSON data
          if (!record.content) {
            return '-';
          }
          try {
            const parsed = JSON.parse(record.content);
            if (parsed?.type && parsed?.data !== undefined) {
              const { type, data } = parsed;
              if (type === 'text' || type === 'markdown') {
                return typeof data === 'string' ? data : JSON.stringify(data);
              }
              if (type === 'thinking') {
                return `[thinking] ${typeof data === 'string' ? data.slice(0, 80) : ''}`;
              }
              if (type === 'toolcall_input') {
                const name = data?.tool_name ?? 'unknown';
                return `[tool call] ${name}`;
              }
              if (type === 'toolcall_output') {
                const name = data?.tool_name ?? 'unknown';
                return `[tool result] ${name}`;
              }
              if (type === 'error') {
                return `[error] ${data?.title ?? data?.message ?? ''}`;
              }
              if (type === 'user_message') {
                return typeof data?.text === 'string'
                  ? data.text
                  : JSON.stringify(data);
              }
              return `[${type}]`;
            }
          } catch {
            // Not JSON, show as plain text
          }
          return record.content;
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.inputTokens',
          defaultMessage: 'Input tokens',
        }),
        dataIndex: 'input_tokens',
        valueType: 'digit',
        search: false,
        sorter: true,
        hideInTable: isMobile,
        render: (_, record) =>
          record.input_tokens != null
            ? intl.formatNumber(record.input_tokens)
            : '-',
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.outputTokens',
          defaultMessage: 'Output tokens',
        }),
        dataIndex: 'output_tokens',
        valueType: 'digit',
        search: false,
        sorter: true,
        hideInTable: isMobile,
        render: (_, record) =>
          record.output_tokens != null
            ? intl.formatNumber(record.output_tokens)
            : '-',
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.createdAt',
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
          id: 'pages.messages.globalOffset',
          defaultMessage: 'Global Offset',
        }),
        dataIndex: 'global_offset',
        valueType: 'digit',
        search: false,
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.timeRange',
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
            created_after: `${value[0]}T00:00:00Z`,
            created_before: `${value[1]}T23:59:59Z`,
          }),
        },
      },
    ],
    [intl, sessionId, isMobile],
  );

  return (
    <PageContainer>
      {!sessionId ? (
        <TableEmptyState
          descriptionId="pages.messages.emptyHint"
          defaultDescription="Please select a conversation from the conversation management page to view messages"
          action={
            <Button
              type="primary"
              onClick={() => history.push('/rtc-users/management')}
            >
              {intl.formatMessage({
                id: 'pages.messages.goToUsers',
                defaultMessage: 'Go to user management',
              })}
            </Button>
          }
        />
      ) : (
        <ProTable<MessageInfo>
          headerTitle={intl.formatMessage({
            id: 'pages.messages.headerTitle',
            defaultMessage: 'Message list',
          })}
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            style: { cursor: 'pointer' },
          })}
          request={createTableRequest(
            async (params, sort) => {
              // Read params from tableParams (URL is single source of truth)
              const effectiveSessionId =
                tableParams.getParam('session_id') || sessionId;
              if (!effectiveSessionId) {
                return { items: [], total: 0 };
              }
              const role = tableParams.getParam('role') || undefined;
              const createdAfter =
                tableParams.getParam('created_after') || undefined;
              const createdBefore =
                tableParams.getParam('created_before') || undefined;
              const current = params.current || 1;
              const pageSize = params.pageSize || 10;
              const sortParams = parseTableSort(sort || {});
              const response = await getMessageList({
                session_id: effectiveSessionId,
                page: current,
                page_size: pageSize,
                role,
                created_after: createdAfter,
                created_before: createdBefore,
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
              id: 'pages.messages.loadFailed',
              defaultMessage: 'Failed to load messages',
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
            initialValues: {
              session_id: tableParams.getParam('session_id') || '',
              role: tableParams.getParam('role') || undefined,
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
                id: 'pages.messages.refresh',
                defaultMessage: 'Refresh',
              })}
            </Button>,
          ]}
          locale={tableLocale}
        />
      )}

      <MessageDetailDrawer
        open={drawerOpen}
        message={currentMessage}
        onClose={() => {
          setDrawerOpen(false);
          setCurrentMessage(null);
        }}
      />
    </PageContainer>
  );
};

export default MessagesPage;
