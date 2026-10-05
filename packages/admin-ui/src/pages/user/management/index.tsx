import { PlusOutlined, TeamOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
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
  getUserList,
  getUserRoles,
  revokeUserRole,
} from '@/services/userRole';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

/**
 * 用户管理页面
 */
const UserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const [currentRow, setCurrentRow] = useState<UserInfo>();
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [userRoles, setUserRoles] = useState<UserRoleAssignment[]>([]);
  const [assignModalVisible, setAssignModalVisible] = useState(false);

  /** 查看用户角色 */
  const handleViewRoles = async (user: UserInfo) => {
    try {
      const response = await getUserRoles(user.id);
      setCurrentRow(user);
      setUserRoles(response.items);
      setRoleModalVisible(true);
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '加载用户角色失败'));
    }
  };

  /** 分配角色 */
  const handleAssignRoles = async (values: { role_ids: string[] }) => {
    if (!currentRow) return false;
    try {
      await assignUserRoles(currentRow.id, { role_ids: values.role_ids });
      message.success('分配角色成功');
      setAssignModalVisible(false);
      // 刷新用户角色列表
      const response = await getUserRoles(currentRow.id);
      setUserRoles(response.items);
      actionRef.current?.reload();
      return true;
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '分配角色失败'));
      return false;
    }
  };

  /** 移除用户角色 */
  const handleRevokeRole = async (userId: string, roleId: string) => {
    try {
      await revokeUserRole(userId, roleId);
      message.success('移除角色成功');
      // 刷新用户角色列表
      if (currentRow) {
        const response = await getUserRoles(currentRow.id);
        setUserRoles(response.items);
      }
      actionRef.current?.reload();
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '移除角色失败'));
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
      title: '角色',
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
          <Access accessible={access.canUserEdit} fallback={null}>
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
        headerTitle="用户列表"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 'auto',
        }}
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
            message.error(error?.message || '加载用户列表失败');
            return {
              data: [],
              total: 0,
              success: false,
            };
          }
        }}
        columns={columns}
      />

      {/* 用户角色管理对话框 */}
      <Modal
        title={`用户角色管理 - ${currentRow?.email}`}
        open={roleModalVisible}
        onCancel={() => {
          setRoleModalVisible(false);
          setCurrentRow(undefined);
          setUserRoles([]);
        }}
        footer={[
          <Access accessible={access.canUserEdit} key="assign" fallback={null}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setAssignModalVisible(true);
              }}
            >
              分配角色
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
                  accessible={access.canUserEdit}
                  key="revoke"
                  fallback={null}
                >
                  <Popconfirm
                    title="确定要移除该角色吗？"
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
          locale={{ emptyText: '暂无角色' }}
        />
      </Modal>

      {/* 分配角色对话框 */}
      <ModalForm<{ role_ids: string[] }>
        title={`分配角色 - ${currentRow?.email}`}
        open={assignModalVisible}
        onOpenChange={setAssignModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleAssignRoles}
      >
        <ProFormSelect
          name="role_ids"
          label="选择角色"
          placeholder="请选择要分配的角色"
          mode="multiple"
          rules={[{ required: true, message: '请选择至少一个角色' }]}
          request={async () => {
            try {
              // 注意：最多加载 1000 个角色，超过部分不会显示
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
    </PageContainer>
  );
};

export default UserManagementPage;
