import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Tag } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TableEmptyState } from '@/components';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { disabledFutureDate, parseTableSort } from '@/utils/tableUtils';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id') || '';
  const isMobile = useIsMobile();

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
          const newSearchParams = new URLSearchParams();
          const effectiveSessionId = listSessionId || sessionId;
          if (effectiveSessionId) {
            newSearchParams.set('session_id', effectiveSessionId);
          }
          if (role) {
            newSearchParams.set('role', role);
          }
          if (startTime) {
            newSearchParams.set('created_after', startTime);
          }
          if (endTime) {
            newSearchParams.set('created_before', endTime);
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
      }),
      [],
    ),
  );

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    if (sessionId) {
      actionRef.current?.reload();
    }
  }, [searchParams]);

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
        formItemProps: {
          rules: [
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.messages.sessionIdRequired',
                defaultMessage: 'Session ID is required',
              }),
            },
          ],
        },
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
            text: intl.formatMessage({ id: 'pages.messages.role.user' }),
            status: 'Processing',
          },
          assistant: {
            text: intl.formatMessage({ id: 'pages.messages.role.assistant' }),
            status: 'Success',
          },
        },
        render: (_, record) => {
          const isUser = record.role === 'user';
          return (
            <Tag color={isUser ? 'blue' : 'green'}>
              {isUser
                ? intl.formatMessage({ id: 'pages.messages.role.user' })
                : intl.formatMessage({ id: 'pages.messages.role.assistant' })}
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
          request={async (params, sort) => {
            try {
              // Read params from searchParams (URL is single source of truth)
              const effectiveSessionId =
                searchParams.get('session_id') || sessionId;
              if (!effectiveSessionId) {
                return { data: [], total: 0, success: true };
              }
              const role = searchParams.get('role') || undefined;
              const createdAfter =
                searchParams.get('created_after') || undefined;
              const createdBefore =
                searchParams.get('created_before') || undefined;
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
                data: response.items,
                total: response.total,
                success: true,
              };
            } catch (error: unknown) {
              message.error(
                getFriendlyErrorMessage(
                  error,
                  intl,
                  intl.formatMessage({
                    id: 'pages.messages.loadFailed',
                    defaultMessage: 'Failed to load messages',
                  }),
                ),
              );
              return {
                data: [],
                total: 0,
                success: false,
              };
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
              session_id: searchParams.get('session_id') || '',
              role: searchParams.get('role') || undefined,
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
          locale={{
            emptyText: (
              <TableEmptyState
                descriptionId="pages.messages.noData"
                defaultDescription="No messages found"
              />
            ),
          }}
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
