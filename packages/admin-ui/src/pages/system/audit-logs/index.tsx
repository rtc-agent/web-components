import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { message, Tag } from 'antd';
import React, { useRef } from 'react';
import type { AuditLogItem } from '@/services/auditLog';
import { getAuditLogList } from '@/services/auditLog';

/** 事件类型映射 */
const EVENT_TYPE_MAP: Record<string, { text: string; color: string }> = {
  create_role: { text: '创建角色', color: 'green' },
  update_role: { text: '更新角色', color: 'blue' },
  delete_role: { text: '删除角色', color: 'red' },
  assign_role: { text: '分配角色', color: 'cyan' },
  revoke_role: { text: '撤销角色', color: 'orange' },
  create_permission: { text: '创建权限', color: 'green' },
  delete_permission: { text: '删除权限', color: 'red' },
};

/** 资源类型映射 */
const RESOURCE_TYPE_MAP: Record<string, string> = {
  role: '角色',
  user: '用户',
  permission: '权限',
};

/**
 * 审计日志页面
 */
const AuditLogsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  /** 表格列定义 */
  const columns: ProColumns<AuditLogItem>[] = [
    {
      title: '操作者',
      dataIndex: 'operator_name',
      valueType: 'text',
      search: false,
      render: (_, record) => record.operator_name || record.operator_id,
    },
    {
      title: '操作者 ID',
      dataIndex: 'actor_id',
      valueType: 'text',
      hideInTable: true,
      fieldProps: {
        placeholder: '输入操作者 ID',
      },
    },
    {
      title: '操作者 IP',
      dataIndex: 'operator_ip',
      valueType: 'text',
      search: false,
    },
    {
      title: '事件类型',
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
      title: '资源类型',
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
      title: '资源 ID',
      dataIndex: 'resource_id',
      valueType: 'text',
      ellipsis: true,
      fieldProps: {
        placeholder: '输入资源 ID',
      },
    },
    {
      title: '详情',
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
            }}
          >
            {JSON.stringify(record.details, null, 2)}
          </pre>
        );
      },
    },
    {
      title: '操作时间',
      dataIndex: 'created_at',
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: '开始时间',
      dataIndex: 'start_time',
      valueType: 'dateTime',
      hideInTable: true,
      fieldProps: {
        placeholder: '选择开始时间',
      },
    },
    {
      title: '结束时间',
      dataIndex: 'end_time',
      valueType: 'dateTime',
      hideInTable: true,
      fieldProps: {
        placeholder: '选择结束时间',
      },
    },
  ];

  return (
    <PageContainer>
      <ProTable<AuditLogItem>
        headerTitle="审计日志"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 'auto',
        }}
        request={async (params) => {
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
          } catch (error: any) {
            message.error(error?.message || '加载审计日志失败');
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
