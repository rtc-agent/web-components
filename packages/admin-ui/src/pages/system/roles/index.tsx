import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess } from '@umijs/max';
import {
  Button,
  Checkbox,
  Modal,
  message,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import {
  createPermission,
  deletePermission,
  getPermissionList,
  type PermissionPolicy,
} from '@/services/permission';
import {
  createRole,
  deleteRole,
  getRoleList,
  patchRole,
  updateRole,
} from '@/services/role';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import type { RoleFormValues, RoleTableItem } from './data.d';
import type { RolePageAPI } from './page-api';

/** 资源类型 */
const RESOURCE_TYPES = [
  { label: '管理员用户', value: 'admin_user' },
  { label: '角色', value: 'role' },
  { label: '权限', value: 'permission' },
  { label: '管理员角色关联', value: 'admin_user_role' },
  { label: '审计日志', value: 'audit_log' },
  { label: 'RTC 用户', value: 'rtc_user' },
  { label: 'RTC 会话', value: 'rtc_session' },
  { label: 'RTC 消息', value: 'rtc_message' },
  { label: '服务器配置', value: 'server_config' },
  { label: '仪表盘', value: 'dashboard' },
];

/** 操作类型 */
const ACTION_TYPES = [
  { label: '读取', value: 'read' },
  { label: '写入', value: 'write' },
  { label: '删除', value: 'delete' },
  { label: '封禁', value: 'ban' },
];

/**
 * 管理员角色管理页面
 */
const RoleListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const [currentRow, setCurrentRow] = useState<RoleTableItem>();
  const [modalVisible, setModalVisible] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<PermissionPolicy[]>(
    [],
  );
  const [_allPermissions, setAllPermissions] = useState<PermissionPolicy[]>([]);

  // === 注册 Page API ===
  useEffect(() => {
    const pageAPI: RolePageAPI = {
      // 读取表格数据
      list: async (params = {}) => {
        const { current = 1, pageSize = 20, keyword } = params;

        try {
          const response = await getRoleList({
            page: current,
            page_size: pageSize,
            keyword,
          });

          return {
            success: true,
            data: response.items,
            total: response.total,
          };
        } catch (error) {
          console.error('[Role Page API] list failed:', error);
          return {
            success: false,
            data: [],
            total: 0,
          };
        }
      },

      // 刷新表格
      refresh: async () => {
        actionRef.current?.reload();
      },

      // 创建管理员角色
      create: async (data) => {
        try {
          const result = await createRole(data);
          actionRef.current?.reload();
          return { success: true, id: result.id };
        } catch (error) {
          console.error('[Role Page API] create failed:', error);
          return { success: false };
        }
      },

      // 更新管理员角色
      update: async (data) => {
        try {
          const { id, ...updateData } = data;
          await updateRole(id, updateData);
          actionRef.current?.reload();
          return { success: true };
        } catch (error) {
          console.error('[Role Page API] update failed:', error);
          return { success: false };
        }
      },

      // 删除管理员角色
      remove: async (ids) => {
        try {
          let deletedCount = 0;
          for (const id of ids) {
            await deleteRole(id);
            deletedCount++;
          }
          actionRef.current?.reload();
          return { success: true, deletedCount };
        } catch (error) {
          console.error('[Role Page API] remove failed:', error);
          return { success: false };
        }
      },
    };

    // 注册到全局
    window.__pages__ = window.__pages__ || {};
    window.__pages__.role = pageAPI;

    // 发送就绪事件（通知 navigation.goto 页面已加载）
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'role' } }),
    );

    console.log('[RoleListPage] Page API registered');

    // 清理
    return () => {
      delete window.__pages__?.role;
      console.log('[RoleListPage] Page API unregistered');
    };
  }, []);

  /** 表格列定义 */
  const columns: ProColumns<RoleTableItem>[] = [
    {
      title: '关键字搜索',
      dataIndex: 'keyword',
      valueType: 'text',
      hideInTable: true,
      fieldProps: {
        placeholder: '输入管理员角色名称、显示名称或描述',
      },
    },
    {
      title: '管理员角色名称',
      dataIndex: 'name',
      valueType: 'text',
      search: false,
    },
    {
      title: '显示名称',
      dataIndex: 'display_name',
      valueType: 'text',
      search: false,
    },
    {
      title: '描述',
      dataIndex: 'description',
      valueType: 'text',
      search: false,
      ellipsis: true,
    },
    {
      title: '系统管理员角色',
      dataIndex: 'is_system',
      valueType: 'select',
      search: false,
      valueEnum: {
        true: { text: '是', status: 'Default' },
        false: { text: '否', status: 'Processing' },
      },
      render: (_, record) => (
        <Tag color={record.is_system ? 'default' : 'processing'}>
          {record.is_system ? '系统管理员角色' : '自定义管理员角色'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      valueType: 'select',
      search: false,
      valueEnum: {
        true: { text: '启用', status: 'Success' },
        false: { text: '禁用', status: 'Error' },
      },
      render: (_, record) => (
        <Access
          accessible={access.canAdminRoleEdit}
          fallback={
            <Tag color={record.is_enabled ? 'success' : 'error'}>
              {record.is_enabled ? '启用' : '禁用'}
            </Tag>
          }
        >
          <Tooltip title={record.is_system ? '系统内置管理员角色不可禁用' : ''}>
            <Switch
              checked={record.is_enabled}
              disabled={record.is_system}
              onChange={async (checked) => {
                try {
                  await patchRole(record.id, { is_enabled: checked });
                  message.success(checked ? '已启用' : '已禁用');
                  actionRef.current?.reload();
                } catch (error: any) {
                  message.error(getFriendlyErrorMessage(error, '操作失败'));
                }
              }}
            />
          </Tooltip>
        </Access>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      render: (_, record) => (
        <Space>
          <Access accessible={access.canAdminRoleEdit} fallback={null}>
            <Button
              type="link"
              size="small"
              icon={<SafetyOutlined />}
              onClick={() => handleManagePermissions(record)}
            >
              权限
            </Button>
          </Access>
          <Access accessible={access.canAdminRoleEdit} fallback={null}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setCurrentRow(record);
                setIsEdit(true);
                setModalVisible(true);
              }}
            >
              编辑
            </Button>
          </Access>
          <Access accessible={access.canAdminRoleEdit} fallback={null}>
            {record.is_system ? (
              <Tooltip title="系统内置管理员角色不可删除">
                <Button
                  type="link"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled
                >
                  删除
                </Button>
              </Tooltip>
            ) : (
              <Popconfirm
                title="确定要删除这个管理员角色吗？"
                description="删除后无法恢复"
                onConfirm={async () => {
                  try {
                    await deleteRole(record.id);
                    message.success('删除成功');
                    actionRef.current?.reload();
                  } catch (error: any) {
                    message.error(getFriendlyErrorMessage(error, '删除失败'));
                  }
                }}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="link"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                >
                  删除
                </Button>
              </Popconfirm>
            )}
          </Access>
        </Space>
      ),
    },
  ];

  /** 提交表单 */
  const handleSubmit = async (values: RoleFormValues) => {
    try {
      if (isEdit && currentRow) {
        await updateRole(currentRow.id, values);
        message.success('更新成功');
      } else {
        await createRole(values);
        message.success('创建成功');
      }
      actionRef.current?.reload();
      setModalVisible(false);
      setCurrentRow(undefined);
      setIsEdit(false);
      return true;
    } catch (error: any) {
      message.error(
        getFriendlyErrorMessage(error, isEdit ? '更新失败' : '创建失败'),
      );
      return false;
    }
  };

  /** 打开权限管理弹窗 */
  const handleManagePermissions = async (role: RoleTableItem) => {
    setCurrentRow(role);
    setPermissionModalVisible(true);

    try {
      // 加载该角色的权限
      const rolePerms = await getPermissionList({
        page: 1,
        page_size: 1000,
        role_id: role.id,
      });
      setRolePermissions(rolePerms.items);

      // 加载所有可用权限（从所有角色中汇总）
      const allPerms = await getPermissionList({
        page: 1,
        page_size: 1000,
      });
      setAllPermissions(allPerms.items);
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '加载权限失败'));
    }
  };

  /** 切换权限 */
  const handleTogglePermission = async (
    resource: string,
    action: string,
    checked: boolean,
  ) => {
    if (!currentRow) return;

    try {
      if (checked) {
        // 添加权限
        await createPermission({
          role_id: currentRow.id,
          resource,
          action,
        });
        message.success('权限已添加');
      } else {
        // 删除权限
        await deletePermission({
          role_id: currentRow.id,
          resource,
          action,
        });
        message.success('权限已移除');
      }

      // 刷新权限列表
      const rolePerms = await getPermissionList({
        page: 1,
        page_size: 1000,
        role_id: currentRow.id,
      });
      setRolePermissions(rolePerms.items);
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '操作失败'));
    }
  };

  /** 检查角色是否拥有某权限 */
  const hasPermission = (resource: string, action: string) => {
    return rolePermissions.some(
      (p) => p.resource === resource && p.action === action,
    );
  };

  return (
    <PageContainer>
      <ProTable<RoleTableItem>
        headerTitle="管理员角色列表"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 'auto',
        }}
        toolBarRender={() => [
          <Access
            accessible={access.canAdminRoleEdit}
            key="create"
            fallback={null}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setCurrentRow(undefined);
                setIsEdit(false);
                setModalVisible(true);
              }}
            >
              新建管理员角色
            </Button>
          </Access>,
        ]}
        request={async (params) => {
          try {
            const response = await getRoleList({
              page: params.current,
              page_size: params.pageSize,
              keyword: params.keyword,
            });
            return {
              data: response.items.map((item) => ({
                ...item,
                key: item.id,
              })),
              total: response.total,
              success: true,
            };
          } catch (error: any) {
            message.error(error?.message || '加载管理员角色列表失败');
            return {
              data: [],
              total: 0,
              success: false,
            };
          }
        }}
        columns={columns}
      />

      <ModalForm<RoleFormValues>
        title={isEdit ? '编辑管理员角色' : '新建管理员角色'}
        open={modalVisible}
        onOpenChange={setModalVisible}
        modalProps={{
          destroyOnClose: true,
          onCancel: () => {
            setCurrentRow(undefined);
            setIsEdit(false);
          },
        }}
        initialValues={
          isEdit && currentRow
            ? {
                name: currentRow.name,
                display_name: currentRow.display_name,
                description: currentRow.description,
              }
            : {}
        }
        onFinish={handleSubmit}
      >
        <ProFormText
          name="name"
          label="管理员角色名称"
          placeholder="请输入管理员角色名称（英文，如 admin）"
          rules={[
            { required: true, message: '请输入管理员角色名称' },
            { min: 3, message: '管理员角色名称至少需要 3 个字符' },
            {
              pattern: /^[a-z][a-z0-9_]*$/,
              message:
                '管理员角色名称只能包含小写字母、数字和下划线，且以字母开头',
            },
            {
              validator: async (_rule, value) => {
                if (!value || isEdit) return Promise.resolve();
                // 异步检查管理员角色名称是否已存在
                try {
                  const response = await getRoleList({
                    keyword: value,
                    page: 1,
                    page_size: 10,
                  });
                  const exists = response.items.some(
                    (item) => item.name.toLowerCase() === value.toLowerCase(),
                  );
                  if (exists) {
                    return Promise.reject(new Error('管理员角色名称已存在'));
                  }
                } catch (_error) {
                  // 忽略错误，让后端验证
                }
                return Promise.resolve();
              },
            },
          ]}
          disabled={isEdit}
          tooltip="管理员角色名称创建后不可修改"
        />
        <ProFormText
          name="display_name"
          label="显示名称"
          placeholder="请输入显示名称（如：管理员）"
          rules={[{ required: true, message: '请输入显示名称' }]}
        />
        <ProFormTextArea
          name="description"
          label="描述"
          placeholder="请输入管理员角色描述"
          fieldProps={{ rows: 4 }}
        />
      </ModalForm>

      {/* 权限管理对话框 */}
      <Modal
        title={`权限管理 - ${currentRow?.display_name || currentRow?.name}`}
        open={permissionModalVisible}
        onCancel={() => {
          setPermissionModalVisible(false);
          setCurrentRow(undefined);
          setRolePermissions([]);
          setAllPermissions([]);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setPermissionModalVisible(false);
              setCurrentRow(undefined);
              setRolePermissions([]);
              setAllPermissions([]);
            }}
          >
            关闭
          </Button>,
        ]}
        width={800}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f0f0f0' }}>
                <th style={{ textAlign: 'left', padding: '12px 8px' }}>
                  资源类型
                </th>
                <th style={{ textAlign: 'center', padding: '12px 8px' }}>
                  读取
                </th>
                <th style={{ textAlign: 'center', padding: '12px 8px' }}>
                  写入
                </th>
                <th style={{ textAlign: 'center', padding: '12px 8px' }}>
                  删除
                </th>
                <th style={{ textAlign: 'center', padding: '12px 8px' }}>
                  封禁
                </th>
              </tr>
            </thead>
            <tbody>
              {RESOURCE_TYPES.map((resource) => (
                <tr
                  key={resource.value}
                  style={{ borderBottom: '1px solid #f0f0f0' }}
                >
                  <td style={{ padding: '12px 8px' }}>
                    {resource.label}
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      {resource.value}
                    </div>
                  </td>
                  {ACTION_TYPES.map((action) => (
                    <td
                      key={action.value}
                      style={{ textAlign: 'center', padding: '12px 8px' }}
                    >
                      <Checkbox
                        checked={hasPermission(resource.value, action.value)}
                        onChange={(e) =>
                          handleTogglePermission(
                            resource.value,
                            action.value,
                            e.target.checked,
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </PageContainer>
  );
};

export default RoleListPage;
