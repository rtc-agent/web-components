import { InboxOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { history, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Empty, Tag } from 'antd';
import dayjs from 'dayjs';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import MessageDetailDrawer from './components/MessageDetailDrawer';
import type { MessageInfo } from './data';
import { getMessageList } from './service';

/** 禁用未来日期 */
const disabledDate = (current: dayjs.Dayjs) => current?.isAfter(dayjs(), 'day');

/**
 * Message 管理页面
 */
const MessagesPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const intl = useIntl();
  const { message } = App.useApp();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id') || '';

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<MessageInfo | null>(
    null,
  );

  // URL 参数变化时刷新表格
  useEffect(() => {
    if (sessionId) {
      actionRef.current?.reload();
    }
  }, [sessionId]);

  /** 打开消息详情 */
  const handleRowClick = useCallback((record: MessageInfo) => {
    setCurrentMessage(record);
    setDrawerOpen(true);
  }, []);

  /** 解析排序参数 */
  const parseSort = useCallback(
    (sort: Record<string, 'ascend' | 'descend' | null>) => {
      const sortField = Object.keys(sort || {}).find(
        (key) => sort[key] === 'ascend' || sort[key] === 'descend',
      );
      if (!sortField) return {};
      const sortOrder: 'asc' | 'desc' =
        sort[sortField] === 'ascend' ? 'asc' : 'desc';
      return {
        sort_by: sortField,
        sort_order: sortOrder,
      };
    },
    [],
  );

  /** 表格列定义 */
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
                defaultMessage: 'Session ID 为必填项',
              }),
            },
          ],
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.role',
          defaultMessage: '角色',
        }),
        dataIndex: 'role',
        valueType: 'select',
        valueEnum: {
          user: {
            text: 'User',
            status: 'Processing',
          },
          assistant: {
            text: 'Assistant',
            status: 'Success',
          },
        },
        render: (_, record) => {
          const isUser = record.role === 'user';
          return <Tag color={isUser ? 'blue' : 'green'}>{record.role}</Tag>;
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.content',
          defaultMessage: '内容',
        }),
        dataIndex: 'content',
        valueType: 'text',
        search: false,
        ellipsis: true,
        width: 400,
        render: (_, record) => {
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
          defaultMessage: '输入 Tokens',
        }),
        dataIndex: 'input_tokens',
        valueType: 'digit',
        search: false,
        sorter: true,
        render: (_, record) =>
          record.input_tokens !== null
            ? record.input_tokens.toLocaleString()
            : '-',
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.outputTokens',
          defaultMessage: '输出 Tokens',
        }),
        dataIndex: 'output_tokens',
        valueType: 'digit',
        search: false,
        sorter: true,
        render: (_, record) =>
          record.output_tokens !== null
            ? record.output_tokens.toLocaleString()
            : '-',
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.createdAt',
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
          id: 'pages.messages.globalOffset',
          defaultMessage: 'Global Offset',
        }),
        dataIndex: 'global_offset',
        valueType: 'digit',
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.messages.timeRange',
          defaultMessage: '时间范围',
        }),
        dataIndex: 'time_range',
        valueType: 'dateRange',
        hideInTable: true,
        fieldProps: {
          disabledDate,
        },
        search: {
          transform: (value: [string, string]) => ({
            created_after: `${value[0]}T00:00:00Z`,
            created_before: `${value[1]}T23:59:59Z`,
          }),
        },
      },
    ],
    [intl, sessionId],
  );

  return (
    <PageContainer>
      {!sessionId ? (
        <Empty
          image={<InboxOutlined style={{ fontSize: 64, color: '#bfbfbf' }} />}
          description={intl.formatMessage({
            id: 'pages.messages.emptyHint',
            defaultMessage: '请从对话管理页面选择对话以查看消息列表',
          })}
        >
          <Button
            type="primary"
            onClick={() => history.push('/rtc-users/management')}
          >
            {intl.formatMessage({
              id: 'pages.messages.goToUsers',
              defaultMessage: '前往用户管理',
            })}
          </Button>
        </Empty>
      ) : (
        <ProTable<MessageInfo>
          headerTitle={intl.formatMessage({
            id: 'pages.messages.headerTitle',
            defaultMessage: '消息列表',
          })}
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            style: { cursor: 'pointer' },
          })}
          request={async (params, sort) => {
            const { current, pageSize, session_id, keyword, ...restParams } =
              params;
            if (!session_id) {
              return { data: [], total: 0, success: true };
            }
            try {
              const sortParams = parseSort(sort || {});
              const response = await getMessageList({
                session_id,
                page: current,
                page_size: pageSize,
                role: restParams.role,
                created_after: restParams.created_after,
                created_before: restParams.created_before,
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
                    defaultMessage: '加载消息列表失败',
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
                id: 'pages.messages.refresh',
                defaultMessage: '刷新',
              })}
            </Button>,
          ]}
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
