import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess } from '@umijs/max';
import { Button, message, Popconfirm, Space, Tag } from 'antd';
import React, { useRef } from 'react';
import {
  createPermission,
  deletePermission,
  getPermissionList,
} from '@/services/permission';
import { getRoleList } from '@/services/role';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import type { PermissionFormValues, PermissionTableItem } from './data.d';

/** 资源类型定义 */
const RESOURCE_TYPES = [
  { label: '管理员管理', value: 'admin_user' },
  { label: '管理员角色管理', value: 'role' },
  { label: '权限管理', value: 'permission' },
  { label: '审计日志', value: 'audit_log' },
];

/** 操作类型定义 */
const ACTION_TYPES = [
  { label: '查看', value: 'read' },
  { label: '编辑', value: 'write' },
  { label: '删除', value: 'delete' },
];

/**
 * 权限管理页面
 */
const PermissionListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const [modalVisible, setModalVisible] = React.useState(false);
  const [roleMap, setRoleMap] = React.useState<Map<string, string>>(new Map());
  const [roleOptions, setRoleOptions] = React.useState<
    Array<{ label: string; value: string }>
  >([]);

  // 加载管理员角色列表，用于映射 role_id 到显示名称
  React.useEffect(() => {
    const loadRoles = async () => {
      try {
        // 注意：最多加载 1000 个管理员角色，超过部分会显示 role_id
        const response = await getRoleList({ page: 1, page_size: 1000 });
        const map = new Map<string, string>();
        const options: Array<{ label: string; value: string }> = [];
        response.items.forEach((role) => {
          const displayName = role.display_name || role.name;
          map.set(role.id, displayName);
          options.push({
            label: `${role.display_name} (${role.name})`,
            value: role.id,
          });
        });
        setRoleMap(map);
        setRoleOptions(options);
      } catch (_error) {
        // 忽略错误，管理员角色名称会显示为 role_id
      }
    };
    loadRoles();
  }, []);

  /** 表格列定义 */
  const columns: ProColumns<PermissionTableItem>[] = [
    {
      title: '管理员角色',
      dataIndex: 'role_id',
      valueType: 'text',
      search: false,
      render: (_, record) => (
        <Tag color="blue">{roleMap.get(record.role_id) || record.role_id}</Tag>
      ),
    },
    {
      title: '资源',
      dataIndex: 'resource',
      valueType: 'select',
      valueEnum: RESOURCE_TYPES.reduce(
        (acc, cur) => {
          acc[cur.value] = { text: cur.label };
          return acc;
        },
        {} as Record<string, { text: string }>,
      ),
      render: (_, record) => {
        const resource = RESOURCE_TYPES.find(
          (r) => r.value === record.resource,
        );
        return <Tag color="green">{resource?.label || record.resource}</Tag>;
      },
    },
    {
      title: '操作',
      dataIndex: 'action',
      valueType: 'select',
      valueEnum: ACTION_TYPES.reduce(
        (acc, cur) => {
          acc[cur.value] = { text: cur.label };
          return acc;
        },
        {} as Record<string, { text: string }>,
      ),
      render: (_, record) => {
        const action = ACTION_TYPES.find((a) => a.value === record.action);
        return <Tag color="orange">{action?.label || record.action}</Tag>;
      },
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      render: (_, record) => (
        <Space>
          <Access accessible={access.canPermissionEdit} fallback={null}>
            <Popconfirm
              title="确定要删除这个权限策略吗？"
              description="删除后该管理员角色将失去对应权限"
              onConfirm={async () => {
                try {
                  await deletePermission({
                    role_id: record.role_id,
                    resource: record.resource,
                    action: record.action,
                  });
                  message.success('删除成功');
                  actionRef.current?.reload();
                } catch (error: any) {
                  message.error(getFriendlyErrorMessage(error, '删除失败'));
                }
              }}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Access>
        </Space>
      ),
    },
  ];

  /** 提交表单 */
  const handleSubmit = async (values: PermissionFormValues) => {
    try {
      await createPermission(values);
      message.success('创建成功');
      actionRef.current?.reload();
      setModalVisible(false);
      return true;
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '创建失败'));
      return false;
    }
  };

  return (
    <PageContainer>
      <ProTable<PermissionTableItem>
        headerTitle="权限策略列表"
        actionRef={actionRef}
        rowKey={(record) =>
          `${record.role_id}-${record.resource}-${record.action}`
        }
        search={{
          labelWidth: 'auto',
        }}
        toolBarRender={() => [
          <Access
            accessible={access.canPermissionEdit}
            key="create"
            fallback={null}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setModalVisible(true);
              }}
            >
              新建权限策略
            </Button>
          </Access>,
        ]}
        request={async (params) => {
          try {
            const response = await getPermissionList({
              page: params.current,
              page_size: params.pageSize,
              role_id: params.role_id,
              resource: params.resource,
            });
            return {
              data: response.items.map((item) => ({
                ...item,
                key: `${item.role_id}-${item.resource}-${item.action}`,
              })),
              total: response.total,
              success: true,
            };
          } catch (error: any) {
            message.error(error?.message || '加载权限列表失败');
            return {
              data: [],
              total: 0,
              success: false,
            };
          }
        }}
        columns={columns}
      />

      <ModalForm<PermissionFormValues>
        title="新建权限策略"
        open={modalVisible}
        onOpenChange={setModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleSubmit}
      >
        <ProFormSelect
          name="role_id"
          label="管理员角色"
          placeholder="请选择管理员角色"
          rules={[{ required: true, message: '请选择管理员角色' }]}
          options={roleOptions}
        />
        <ProFormSelect
          name="resource"
          label="资源"
          placeholder="请选择资源类型"
          rules={[{ required: true, message: '请选择资源类型' }]}
          options={RESOURCE_TYPES}
        />
        <ProFormSelect
          name="action"
          label="操作"
          placeholder="请选择操作类型"
          rules={[{ required: true, message: '请选择操作类型' }]}
          options={ACTION_TYPES}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default PermissionListPage;
