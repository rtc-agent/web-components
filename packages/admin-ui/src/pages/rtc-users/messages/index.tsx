import { InboxOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Empty, Grid, Tag, theme } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { disabledFutureDate, parseTableSort } from '../shared/tableUtils';
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
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<MessageInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const { token } = theme.useToken();

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: MessagePageAPI = {
      // Query message list - sync URL and return data
      list: async (params = {}) => {
        const {
          current = 1,
          pageSize = 10,
          sessionId: listSessionId,
          role,
          startTime,
          endTime,
          sortBy,
          sortOrder,
        } = params;

        const effectiveSessionId = listSessionId || sessionId;

        // 1. Sync URL (based on existing searchParams)
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('current', String(current));
        newSearchParams.set('pageSize', String(pageSize));
        if (effectiveSessionId) {
          newSearchParams.set('session_id', effectiveSessionId);
        } else {
          newSearchParams.delete('session_id');
        }
        if (role) {
          newSearchParams.set('role', role);
        } else {
          newSearchParams.delete('role');
        }
        if (startTime) {
          newSearchParams.set('created_after', startTime);
        } else {
          newSearchParams.delete('created_after');
        }
        if (endTime) {
          newSearchParams.set('created_before', endTime);
        } else {
          newSearchParams.delete('created_before');
        }
        setSearchParams(newSearchParams, { replace: true });

        // 2. Call service to get data (matches ProTable request logic)
        if (!effectiveSessionId) {
          console.warn('[MessagesPage] list called without session_id');
          return {
            success: false,
            data: [],
            total: 0,
            error: 'session_id is required',
          };
        }

        try {
          const response = await getMessageList({
            session_id: effectiveSessionId,
            page: current,
            page_size: pageSize,
            role: role || undefined,
            created_after: startTime || undefined,
            created_before: endTime || undefined,
            sort_by: sortBy || undefined,
            sort_order: sortOrder || undefined,
          });

          return {
            success: true,
            data: response.items || [],
            total: response.total || 0,
          };
        } catch (error) {
          console.error('[MessagesPage] list failed:', error);
          return {
            success: false,
            data: [],
            total: 0,
            error: 'Failed to fetch message list',
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
    window.__pages__.rtcMessage = pageAPI;

    // Dispatch ready event
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'rtcMessage' } }),
    );

    console.log('[MessagesPage] Page API registered');

    // Cleanup
    return () => {
      delete window.__pages__?.rtcMessage;
      console.log('[MessagesPage] Page API unregistered');
    };
  }, []);

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
            ? record.input_tokens.toLocaleString()
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
            ? record.output_tokens.toLocaleString()
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
        <Empty
          image={
            <InboxOutlined
              style={{ fontSize: 64, color: token.colorTextTertiary }}
            />
          }
          description={intl.formatMessage({
            id: 'pages.messages.emptyHint',
            defaultMessage:
              'Please select a conversation from the conversation management page to view messages',
          })}
        >
          <Button
            type="primary"
            onClick={() => history.push('/rtc-users/management')}
          >
            {intl.formatMessage({
              id: 'pages.messages.goToUsers',
              defaultMessage: 'Go to user management',
            })}
          </Button>
        </Empty>
      ) : (
        <ProTable<MessageInfo>
          headerTitle={intl.formatMessage({
            id: 'pages.messages.headerTitle',
            defaultMessage: 'Message list',
          })}
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          loading={loading}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            style: { cursor: 'pointer' },
          })}
          request={async (params, sort) => {
            // Read params from searchParams (URL is single source of truth)
            const effectiveSessionId =
              searchParams.get('session_id') || sessionId;
            if (!effectiveSessionId) {
              return { data: [], total: 0, success: true };
            }
            setLoading(true);
            const role = searchParams.get('role') || undefined;
            const createdAfter = searchParams.get('created_after') || undefined;
            const createdBefore =
              searchParams.get('created_before') || undefined;
            const current = params.current || 1;
            const pageSize = params.pageSize || 10;
            try {
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
                  intl.formatMessage({
                    id: 'pages.messages.loadFailed',
                    defaultMessage: 'Failed to load messages',
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
              <Empty
                image={
                  <InboxOutlined
                    style={{ fontSize: 48, color: token.colorTextTertiary }}
                  />
                }
                description={intl.formatMessage({
                  id: 'pages.messages.noData',
                  defaultMessage: 'No messages found',
                })}
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
