import { EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess } from '@umijs/max';
import { Button, List, Modal, message, Popconfirm, Space, Tag } from 'antd';
import React, { useRef, useState } from 'react';
import type { UserInfo } from '@/services/admin-auth';
import { getRoleList } from '@/services/role';
import type { UserRoleAssignment } from '@/services/userRole';
import {
  assignUserRoles,
  createAdminUser,
  getUserList,
  getUserRoles,
  revokeUserRole,
  updateAdminUser,
} from '@/services/userRole';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

/**
 * 管理员管理页面
 */
const AdminUserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const [currentRow, setCurrentRow] = useState<UserInfo>();
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [userRoles, setUserRoles] = useState<UserRoleAssignment[]>([]);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);

  /** 创建管理员 */
  const handleCreateUser = async (values: {
    email: string;
    password: string;
    name?: string;
    role_ids?: string[];
  }) => {
    try {
      await createAdminUser({
        email: values.email,
        password: values.password,
        name: values.name,
        role_ids: values.role_ids,
      });
      message.success('创建管理员成功');
      setCreateModalVisible(false);
      actionRef.current?.reload();
      return true;
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '创建管理员失败'));
      return false;
    }
  };

  /** 编辑管理员 */
  const handleUpdateUser = async (values: { name?: string; password?: string }) => {
    if (!currentRow) return false;
    try {
      await updateAdminUser(currentRow.id, {
        name: values.name,
        password: values.password,
      });
      message.success('更新管理员成功');
      setEditModalVisible(false);
      setCurrentRow(undefined);
      actionRef.current?.reload();
      return true;
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '更新管理员失败'));
      return false;
    }
  };

  /** 查看管理员角色 */
  const handleViewRoles = async (user: UserInfo) => {
    try {
      const response = await getUserRoles(user.id);
      setCurrentRow(user);
      setUserRoles(response.items);
      setRoleModalVisible(true);
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '加载管理员角色失败'));
    }
  };

  /** 分配管理员角色 */
  const handleAssignRoles = async (values: { role_ids: string[] }) => {
    if (!currentRow) return false;
    try {
      await assignUserRoles(currentRow.id, { role_ids: values.role_ids });
      message.success('分配管理员角色成功');
      setAssignModalVisible(false);
      // 刷新管理员角色列表
      const response = await getUserRoles(currentRow.id);
      setUserRoles(response.items);
      actionRef.current?.reload();
      return true;
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '分配管理员角色失败'));
      return false;
    }
  };

  /** 移除管理员角色 */
  const handleRevokeRole = async (userId: string, roleId: string) => {
    try {
      await revokeUserRole(userId, roleId);
      message.success('移除管理员角色成功');
      // 刷新管理员角色列表
      if (currentRow) {
        const response = await getUserRoles(currentRow.id);
        setUserRoles(response.items);
      }
      actionRef.current?.reload();
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '移除管理员角色失败'));
    }
  };

  /** 表格列定义 */
  const columns: ProColumns<UserInfo>[] = [
    {
      title: '邮箱',
      dataIndex: 'email',
      valueType: 'text',
    },
    {
      title: '姓名',
      dataIndex: 'name',
      valueType: 'text',
    },
    {
      title: '管理员角色',
      dataIndex: 'roles',
      valueType: 'select',
      search: false,
      render: (_, record) => (
        <Space>
          {record.roles?.map((role) => (
            <Tag key={role.id} color="blue">
              {role.display_name || role.name}
            </Tag>
          )) || '-'}
        </Space>
      ),
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      render: (_, record) => (
        <Space>
          <Access accessible={access.canAdminUserEdit} fallback={null}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setCurrentRow(record);
                setEditModalVisible(true);
              }}
            >
              编辑
            </Button>
          </Access>
          <Access accessible={access.canAdminUserEdit} fallback={null}>
            <Button
              type="link"
              size="small"
              icon={<TeamOutlined />}
              onClick={() => handleViewRoles(record)}
            >
              管理角色
            </Button>
          </Access>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<UserInfo>
        headerTitle="管理员列表"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 'auto',
        }}
        toolBarRender={() => [
          <Access accessible={access.canAdminUserEdit} key="create">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              创建管理员
            </Button>
          </Access>,
        ]}
        request={async (params) => {
          try {
            const response = await getUserList({
              page: params.current,
              page_size: params.pageSize,
              keyword: params.keyword,
            });
            return {
              data: response.items,
              total: response.total,
              success: true,
            };
          } catch (error: any) {
            message.error(error?.message || '加载管理员列表失败');
            return {
              data: [],
              total: 0,
              success: false,
            };
          }
        }}
        columns={columns}
      />

      {/* 管理员角色管理对话框 */}
      <Modal
        title={`管理员角色管理 - ${currentRow?.email}`}
        open={roleModalVisible}
        onCancel={() => {
          setRoleModalVisible(false);
          setCurrentRow(undefined);
          setUserRoles([]);
        }}
        footer={[
          <Access
            accessible={access.canAdminUserEdit}
            key="assign"
            fallback={null}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setAssignModalVisible(true);
              }}
            >
              分配管理员角色
            </Button>
          </Access>,
          <Button
            key="close"
            onClick={() => {
              setRoleModalVisible(false);
              setCurrentRow(undefined);
              setUserRoles([]);
            }}
          >
            关闭
          </Button>,
        ]}
        width={600}
      >
        <List
          dataSource={userRoles}
          renderItem={(assignment) => (
            <List.Item
              actions={[
                <Access
                  accessible={access.canAdminUserEdit}
                  key="revoke"
                  fallback={null}
                >
                  <Popconfirm
                    title="确定要移除该管理员角色吗？"
                    onConfirm={() => {
                      if (currentRow) {
                        handleRevokeRole(currentRow.id, assignment.role_id);
                      }
                    }}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button type="link" danger size="small">
                      移除
                    </Button>
                  </Popconfirm>
                </Access>,
              ]}
            >
              <List.Item.Meta
                title={assignment.role_name}
                description={`分配时间：${new Date(assignment.assigned_at).toLocaleString()}`}
              />
            </List.Item>
          )}
          locale={{ emptyText: '暂无管理员角色' }}
        />
      </Modal>

      {/* 分配管理员角色对话框 */}
      <ModalForm<{ role_ids: string[] }>
        title={`分配管理员角色 - ${currentRow?.email}`}
        open={assignModalVisible}
        onOpenChange={setAssignModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleAssignRoles}
      >
        <ProFormSelect
          name="role_ids"
          label="选择管理员角色"
          placeholder="请选择要分配的管理员角色"
          mode="multiple"
          rules={[{ required: true, message: '请选择至少一个管理员角色' }]}
          request={async () => {
            try {
              // 注意：最多加载 1000 个管理员角色，超过部分不会显示
              const response = await getRoleList({ page: 1, page_size: 1000 });
              return response.items.map((item) => ({
                label: `${item.display_name} (${item.name})`,
                value: item.id,
              }));
            } catch (_error) {
              return [];
            }
          }}
        />
      </ModalForm>

      {/* 创建管理员对话框 */}
      <ModalForm<{
        email: string;
        password: string;
        name?: string;
        role_ids?: string[];
      }>
        title="创建管理员"
        open={createModalVisible}
        onOpenChange={setCreateModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleCreateUser}
      >
        <ProFormText
          name="email"
          label="邮箱"
          placeholder="请输入邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        />
        <ProFormText.Password
          name="password"
          label="密码"
          placeholder="请输入密码（至少6位）"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码至少6位' },
          ]}
        />
        <ProFormText
          name="name"
          label="姓名"
          placeholder="请输入姓名（可选）"
        />
        <ProFormSelect
          name="role_ids"
          label="角色"
          placeholder="请选择角色（可选）"
          mode="multiple"
          request={async () => {
            try {
              const response = await getRoleList({ page: 1, page_size: 1000 });
              return response.items.map((item) => ({
                label: `${item.display_name} (${item.name})`,
                value: item.id,
              }));
            } catch (_error) {
              return [];
            }
          }}
        />
      </ModalForm>

      {/* 编辑管理员对话框 */}
      <ModalForm<{ name?: string; password?: string }>
        title={`编辑管理员 - ${currentRow?.email}`}
        open={editModalVisible}
        onOpenChange={setEditModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleUpdateUser}
        initialValues={{
          name: currentRow?.name,
        }}
      >
        <ProFormText
          name="name"
          label="姓名"
          placeholder="请输入姓名"
        />
        <ProFormText.Password
          name="password"
          label="新密码"
          placeholder="留空则不修改密码"
          rules={[
            { min: 6, message: '密码至少6位' },
          ]}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default AdminUserManagementPage;
