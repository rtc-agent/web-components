import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { message, Tag, theme } from 'antd';
import React, { useMemo, useRef } from 'react';
import type { AuditLogItem } from '@/services/auditLog';
import { getAuditLogList } from '@/services/auditLog';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

/**
 * 审计日志页面
 */
const AuditLogsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const intl = useIntl();
  const { token } = theme.useToken();

  /** 事件类型映射（国际化） */
  const EVENT_TYPE_MAP: Record<string, { text: string; color: string }> =
    useMemo(
      () => ({
        create_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.createRole',
            defaultMessage: '创建管理员角色',
          }),
          color: 'green',
        },
        update_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.updateRole',
            defaultMessage: '更新管理员角色',
          }),
          color: 'blue',
        },
        delete_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.deleteRole',
            defaultMessage: '删除管理员角色',
          }),
          color: 'red',
        },
        assign_roles: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.assignRoles',
            defaultMessage: '分配管理员角色',
          }),
          color: 'cyan',
        },
        revoke_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.revokeRole',
            defaultMessage: '撤销管理员角色',
          }),
          color: 'orange',
        },
        create_permission: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.createPermission',
            defaultMessage: '创建权限',
          }),
          color: 'green',
        },
        delete_permission: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.deletePermission',
            defaultMessage: '删除权限',
          }),
          color: 'red',
        },
      }),
      [intl],
    );

  /** 资源类型映射（国际化） */
  const RESOURCE_TYPE_MAP: Record<string, string> = useMemo(
    () => ({
      role: intl.formatMessage({
        id: 'pages.auditLogs.resourceType.role',
        defaultMessage: '管理员角色',
      }),
      admin_user: intl.formatMessage({
        id: 'pages.auditLogs.resourceType.adminUser',
        defaultMessage: '管理员',
      }),
      permission: intl.formatMessage({
        id: 'pages.auditLogs.resourceType.permission',
        defaultMessage: '权限',
      }),
    }),
    [intl],
  );

  /** 表格列定义 */
  const columns: ProColumns<AuditLogItem>[] = [
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.operator',
        defaultMessage: '操作者',
      }),
      dataIndex: 'operator_name',
      valueType: 'text',
      search: false,
      render: (_, record) => record.operator_name || record.operator_id,
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.actorId',
        defaultMessage: '操作者 ID',
      }),
      dataIndex: 'actor_id',
      valueType: 'text',
      hideInTable: true,
      fieldProps: {
        placeholder: intl.formatMessage({
          id: 'pages.auditLogs.column.actorIdPlaceholder',
          defaultMessage: '输入操作者 ID',
        }),
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.operatorIp',
        defaultMessage: '操作者 IP',
      }),
      dataIndex: 'operator_ip',
      valueType: 'text',
      search: false,
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.eventType',
        defaultMessage: '事件类型',
      }),
      dataIndex: 'event_type',
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(EVENT_TYPE_MAP).map(([key, { text }]) => [
          key,
          { text },
        ]),
      ),
      render: (_, record) => {
        const event = EVENT_TYPE_MAP[record.event_type];
        return (
          <Tag color={event?.color || 'default'}>
            {event?.text || record.event_type}
          </Tag>
        );
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.resourceType',
        defaultMessage: '资源类型',
      }),
      dataIndex: 'resource_type',
      valueType: 'select',
      valueEnum: Object.fromEntries(
        Object.entries(RESOURCE_TYPE_MAP).map(([key, text]) => [key, { text }]),
      ),
      render: (_, record) => (
        <Tag>
          {RESOURCE_TYPE_MAP[record.resource_type] || record.resource_type}
        </Tag>
      ),
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.resourceId',
        defaultMessage: '资源 ID',
      }),
      dataIndex: 'resource_id',
      valueType: 'text',
      ellipsis: true,
      fieldProps: {
        placeholder: intl.formatMessage({
          id: 'pages.auditLogs.column.resourceIdPlaceholder',
          defaultMessage: '输入资源 ID',
        }),
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.details',
        defaultMessage: '详情',
      }),
      dataIndex: 'details',
      valueType: 'text',
      search: false,
      ellipsis: true,
      render: (_, record) => {
        if (!record.details) return '-';
        // 使用格式化的 JSON 显示，提升可读性
        return (
          <pre
            style={{
              margin: 0,
              fontSize: '12px',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: token.colorBgTextHover,
              color: token.colorText,
              padding: token.paddingSM,
              borderRadius: token.borderRadiusSM,
            }}
          >
            {JSON.stringify(record.details, null, 2)}
          </pre>
        );
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.createdAt',
        defaultMessage: '操作时间',
      }),
      dataIndex: 'created_at',
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.startTime',
        defaultMessage: '开始时间',
      }),
      dataIndex: 'start_time',
      valueType: 'dateTime',
      hideInTable: true,
      fieldProps: {
        placeholder: intl.formatMessage({
          id: 'pages.auditLogs.column.startTimePlaceholder',
          defaultMessage: '选择开始时间',
        }),
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.auditLogs.column.endTime',
        defaultMessage: '结束时间',
      }),
      dataIndex: 'end_time',
      valueType: 'dateTime',
      hideInTable: true,
      fieldProps: {
        placeholder: intl.formatMessage({
          id: 'pages.auditLogs.column.endTimePlaceholder',
          defaultMessage: '选择结束时间',
        }),
      },
    },
  ];

  return (
    <PageContainer>
      <ProTable<AuditLogItem>
        headerTitle={intl.formatMessage({
          id: 'pages.auditLogs.headerTitle',
          defaultMessage: '审计日志',
        })}
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 'auto',
        }}
        request={async (params) => {
          // 交叉验证：start_time 必须早于 end_time
          if (params.start_time && params.end_time) {
            const startTime = new Date(params.start_time).getTime();
            const endTime = new Date(params.end_time).getTime();
            if (startTime >= endTime) {
              message.warning(
                intl.formatMessage({
                  id: 'pages.auditLogs.timeRangeInvalid',
                  defaultMessage: '开始时间必须早于结束时间',
                }),
              );
              return { data: [], total: 0, success: false };
            }
          }

          try {
            const response = await getAuditLogList({
              page: params.current,
              page_size: params.pageSize,
              actor_id: params.actor_id,
              resource_type: params.resource_type,
              event_type: params.event_type,
              target_id: params.resource_id,
              start_time: params.start_time,
              end_time: params.end_time,
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
                  id: 'pages.auditLogs.loadFailed',
                  defaultMessage: '加载审计日志失败',
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
        columns={columns}
      />
    </PageContainer>
  );
};

export default AuditLogsPage;
