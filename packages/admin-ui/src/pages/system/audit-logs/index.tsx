import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useIntl, useSearchParams } from '@umijs/max';
import { App, Tag, theme } from 'antd';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { AuditLogItem } from './service';
import { getAuditLogList } from './service';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { parseTableSort } from '@/utils/tableUtils';
import type { AuditLogPageAPI } from './page-api';

/**
 * Audit Logs Page
 */
const AuditLogsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const isMobile = useIsMobile();

  // === Register Page API ===
  usePageAPIRegistration(
    'auditLog',
    useCallback(
      (): AuditLogPageAPI => ({
        // Read table data
        list: async (params = {}) => {
          const {
            current = 1,
            pageSize = 20,
            actor_id,
            resource_type,
            event_type,
            target_id,
            start_time,
            end_time,
          } = params;

          // Sync URL (no page refresh)
          const newSearchParams = new URLSearchParams();
          if (actor_id) {
            newSearchParams.set('actor_id', actor_id);
          }
          if (resource_type) {
            newSearchParams.set('resource_type', resource_type);
          }
          if (event_type) {
            newSearchParams.set('event_type', event_type);
          }
          if (target_id) {
            newSearchParams.set('target_id', target_id);
          }
          if (start_time) {
            newSearchParams.set('start_time', start_time);
          }
          if (end_time) {
            newSearchParams.set('end_time', end_time);
          }
          setSearchParams(newSearchParams, { replace: true });

          try {
            const response = await getAuditLogList({
              page: current,
              page_size: pageSize,
              actor_id,
              resource_type,
              event_type,
              target_id,
              start_time,
              end_time,
            });

            return {
              success: true,
              data: response.items,
              total: response.total,
            };
          } catch (error) {
            console.error('[AuditLog Page API] list failed:', error);
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.auditLogs.loadFailed',
                  defaultMessage: 'Failed to load audit logs',
                }),
              ),
            );
            return {
              success: false,
              data: [],
              total: 0,
            };
          }
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
    actionRef.current?.reload();
  }, [searchParams]);

  /** Event type mapping (i18n) */
  const EVENT_TYPE_MAP: Record<string, { text: string; color: string }> =
    useMemo(
      () => ({
        create_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.createRole',
            defaultMessage: 'Create admin role',
          }),
          color: token.colorSuccess,
        },
        update_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.updateRole',
            defaultMessage: 'Update admin role',
          }),
          color: token.colorInfo,
        },
        delete_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.deleteRole',
            defaultMessage: 'Delete admin role',
          }),
          color: token.colorError,
        },
        assign_roles: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.assignRoles',
            defaultMessage: 'Assign admin role',
          }),
          color: token.colorInfo,
        },
        revoke_role: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.revokeRole',
            defaultMessage: 'Revoke admin role',
          }),
          color: token.colorWarning,
        },
        create_permission: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.createPermission',
            defaultMessage: 'Create permission',
          }),
          color: token.colorSuccess,
        },
        delete_permission: {
          text: intl.formatMessage({
            id: 'pages.auditLogs.eventType.deletePermission',
            defaultMessage: 'Delete permission',
          }),
          color: token.colorError,
        },
      }),
      [intl, token],
    );

  /** Resource type mapping (i18n) */
  const RESOURCE_TYPE_MAP: Record<string, string> = useMemo(
    () => ({
      role: intl.formatMessage({
        id: 'pages.auditLogs.resourceType.role',
        defaultMessage: 'Admin role',
      }),
      admin_user: intl.formatMessage({
        id: 'pages.auditLogs.resourceType.adminUser',
        defaultMessage: 'Administrator',
      }),
      permission: intl.formatMessage({
        id: 'pages.auditLogs.resourceType.permission',
        defaultMessage: 'Permission',
      }),
    }),
    [intl],
  );

  /** Table column definitions */
  const columns: ProColumns<AuditLogItem>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.auditLogs.column.operator',
          defaultMessage: 'Operator',
        }),
        dataIndex: 'operator_name',
        valueType: 'text',
        search: false,
        render: (_, record) => record.operator_name || record.operator_id,
      },
      {
        title: intl.formatMessage({
          id: 'pages.auditLogs.column.actorId',
          defaultMessage: 'Operator ID',
        }),
        dataIndex: 'actor_id',
        valueType: 'text',
        hideInTable: true,
        fieldProps: {
          placeholder: intl.formatMessage({
            id: 'pages.auditLogs.column.actorIdPlaceholder',
            defaultMessage: 'Enter operator ID',
          }),
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.auditLogs.column.operatorIp',
          defaultMessage: 'Operator IP',
        }),
        dataIndex: 'operator_ip',
        valueType: 'text',
        search: false,
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.auditLogs.column.eventType',
          defaultMessage: 'Event type',
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
          defaultMessage: 'Resource type',
        }),
        dataIndex: 'resource_type',
        valueType: 'select',
        valueEnum: Object.fromEntries(
          Object.entries(RESOURCE_TYPE_MAP).map(([key, text]) => [
            key,
            { text },
          ]),
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
          defaultMessage: 'Resource ID',
        }),
        dataIndex: 'resource_id',
        valueType: 'text',
        ellipsis: true,
        hideInTable: isMobile,
        fieldProps: {
          placeholder: intl.formatMessage({
            id: 'pages.auditLogs.column.resourceIdPlaceholder',
            defaultMessage: 'Enter resource ID',
          }),
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.auditLogs.column.details',
          defaultMessage: 'Details',
        }),
        dataIndex: 'details',
        valueType: 'text',
        search: false,
        ellipsis: true,
        hideInTable: isMobile,
        render: (_, record) => {
          if (!record.details) return '-';
          // Use formatted JSON display for better readability
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
          defaultMessage: 'Operation time',
        }),
        dataIndex: 'created_at',
        valueType: 'dateTime',
        search: false,
        sorter: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.auditLogs.column.startTime',
          defaultMessage: 'Start time',
        }),
        dataIndex: 'start_time',
        valueType: 'dateTime',
        hideInTable: true,
        fieldProps: {
          placeholder: intl.formatMessage({
            id: 'pages.auditLogs.column.startTimePlaceholder',
            defaultMessage: 'Select start time',
          }),
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.auditLogs.column.endTime',
          defaultMessage: 'End time',
        }),
        dataIndex: 'end_time',
        valueType: 'dateTime',
        hideInTable: true,
        fieldProps: {
          placeholder: intl.formatMessage({
            id: 'pages.auditLogs.column.endTimePlaceholder',
            defaultMessage: 'Select end time',
          }),
        },
      },
    ],
    [intl, token, isMobile, EVENT_TYPE_MAP, RESOURCE_TYPE_MAP],
  );

  return (
    <PageContainer>
      <ProTable<AuditLogItem>
        headerTitle={intl.formatMessage({
          id: 'pages.auditLogs.headerTitle',
          defaultMessage: 'Audit logs',
        })}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        search={{
          labelWidth: 'auto',
        }}
        form={{
          initialValues: {
            actor_id: searchParams.get('actor_id') || undefined,
            resource_type: searchParams.get('resource_type') || undefined,
            event_type: searchParams.get('event_type') || undefined,
            resource_id: searchParams.get('target_id') || undefined,
            start_time: searchParams.get('start_time') || undefined,
            end_time: searchParams.get('end_time') || undefined,
          },
        }}
        beforeSearchSubmit={(params) => {
          // Cross-validation: start_time must be before end_time
          if (params.start_time && params.end_time) {
            const startTime = new Date(params.start_time as string).getTime();
            const endTime = new Date(params.end_time as string).getTime();
            if (startTime >= endTime) {
              message.warning(
                intl.formatMessage({
                  id: 'pages.auditLogs.timeRangeInvalid',
                  defaultMessage: 'Start time must be earlier than end time',
                }),
              );
              return false; // Cancel search
            }
          }
          return params;
        }}
        request={async (params, sort) => {
          // Read params from searchParams (URL is single source of truth)
          const actor_id = searchParams.get('actor_id') || undefined;
          const resource_type = searchParams.get('resource_type') || undefined;
          const event_type = searchParams.get('event_type') || undefined;
          const target_id = searchParams.get('target_id') || undefined;
          const start_time = searchParams.get('start_time') || undefined;
          const end_time = searchParams.get('end_time') || undefined;

          try {
            const sortParams = parseTableSort(sort || {});
            const response = await getAuditLogList({
              page: params.current,
              page_size: params.pageSize,
              actor_id,
              resource_type,
              event_type,
              target_id,
              start_time,
              end_time,
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
                  id: 'pages.auditLogs.loadFailed',
                  defaultMessage: 'Failed to load audit logs',
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
