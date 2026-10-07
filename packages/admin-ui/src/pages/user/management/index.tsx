import { EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess, useIntl } from '@umijs/max';
import { Button, List, Modal, message, Popconfirm, Space, Tag } from 'antd';
import React, { useRef, useState } from 'react';
import { useRoleOptions } from '@/hooks/useRoleOptions';
import type { UserInfo } from '@/services/admin-auth';
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
  const intl = useIntl();
  const { roleOptions } = useRoleOptions();
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
      message.success(
        intl.formatMessage({
          id: 'pages.adminUsers.createSuccess',
          defaultMessage: '创建管理员成功',
        }),
      );
      setCreateModalVisible(false);
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.adminUsers.createFailed',
            defaultMessage: '创建管理员失败',
          }),
        ),
      );
      return false;
    }
  };

  /** 编辑管理员 */
  const handleUpdateUser = async (values: {
    name?: string;
    password?: string;
  }) => {
    if (!currentRow) return false;
    try {
      await updateAdminUser(currentRow.id, {
        name: values.name,
        password: values.password,
      });
      message.success(
        intl.formatMessage({
          id: 'pages.adminUsers.updateSuccess',
          defaultMessage: '更新管理员成功',
        }),
      );
      setEditModalVisible(false);
      setCurrentRow(undefined);
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.adminUsers.updateFailed',
            defaultMessage: '更新管理员失败',
          }),
        ),
      );
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
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.adminUsers.loadRolesFailed',
            defaultMessage: '加载管理员角色失败',
          }),
        ),
      );
    }
  };

  /** 分配管理员角色 */
  const handleAssignRoles = async (values: { role_ids: string[] }) => {
    if (!currentRow) return false;
    try {
      await assignUserRoles(currentRow.id, { role_ids: values.role_ids });
      message.success(
        intl.formatMessage({
          id: 'pages.adminUsers.assignRoleSuccess',
          defaultMessage: '分配管理员角色成功',
        }),
      );
      setAssignModalVisible(false);
      // 刷新管理员角色列表
      const response = await getUserRoles(currentRow.id);
      setUserRoles(response.items);
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.adminUsers.assignRoleFailed',
            defaultMessage: '分配管理员角色失败',
          }),
        ),
      );
      return false;
    }
  };

  /** 移除管理员角色 */
  const handleRevokeRole = async (userId: string, roleId: string) => {
    try {
      await revokeUserRole(userId, roleId);
      message.success(
        intl.formatMessage({
          id: 'pages.adminUsers.revokeRoleSuccess',
          defaultMessage: '移除管理员角色成功',
        }),
      );
      // 刷新管理员角色列表
      if (currentRow) {
        const response = await getUserRoles(currentRow.id);
        setUserRoles(response.items);
      }
      actionRef.current?.reload();
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.adminUsers.revokeRoleFailed',
            defaultMessage: '移除管理员角色失败',
          }),
        ),
      );
    }
  };

  /** 表格列定义 */
  const columns: ProColumns<UserInfo>[] = [
    {
      title: intl.formatMessage({
        id: 'pages.adminUsers.column.email',
        defaultMessage: '邮箱',
      }),
      dataIndex: 'email',
      valueType: 'text',
    },
    {
      title: intl.formatMessage({
        id: 'pages.adminUsers.column.name',
        defaultMessage: '姓名',
      }),
      dataIndex: 'name',
      valueType: 'text',
    },
    {
      title: intl.formatMessage({
        id: 'pages.adminUsers.column.roles',
        defaultMessage: '管理员角色',
      }),
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
      title: intl.formatMessage({
        id: 'pages.adminUsers.column.actions',
        defaultMessage: '操作',
      }),
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
              {intl.formatMessage({
                id: 'pages.adminUsers.edit',
                defaultMessage: '编辑',
              })}
            </Button>
          </Access>
          <Access accessible={access.canAdminUserEdit} fallback={null}>
            <Button
              type="link"
              size="small"
              icon={<TeamOutlined />}
              onClick={() => handleViewRoles(record)}
            >
              {intl.formatMessage({
                id: 'pages.adminUsers.manageRoles',
                defaultMessage: '管理角色',
              })}
            </Button>
          </Access>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<UserInfo>
        headerTitle={intl.formatMessage({
          id: 'pages.adminUsers.headerTitle',
          defaultMessage: '管理员列表',
        })}
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
              {intl.formatMessage({
                id: 'pages.adminUsers.create',
                defaultMessage: '创建管理员',
              })}
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
          } catch (error: unknown) {
            message.error(
              getFriendlyErrorMessage(
                error,
                intl.formatMessage({
                  id: 'pages.adminUsers.loadFailed',
                  defaultMessage: '加载管理员列表失败',
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

      {/* 管理员角色管理对话框 */}
      <Modal
        title={intl.formatMessage(
          {
            id: 'pages.adminUsers.roleManagementTitle',
            defaultMessage: '管理员角色管理 - {email}',
          },
          { email: currentRow?.email },
        )}
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
              {intl.formatMessage({
                id: 'pages.adminUsers.assignRole',
                defaultMessage: '分配管理员角色',
              })}
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
            {intl.formatMessage({
              id: 'pages.adminUsers.close',
              defaultMessage: '关闭',
            })}
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
                    title={intl.formatMessage({
                      id: 'pages.adminUsers.confirmRevokeRole',
                      defaultMessage: '确定要移除该管理员角色吗？',
                    })}
                    onConfirm={() => {
                      if (currentRow) {
                        handleRevokeRole(currentRow.id, assignment.role_id);
                      }
                    }}
                    okText={intl.formatMessage({
                      id: 'pages.adminUsers.confirm',
                      defaultMessage: '确定',
                    })}
                    cancelText={intl.formatMessage({
                      id: 'pages.adminUsers.cancel',
                      defaultMessage: '取消',
                    })}
                  >
                    <Button type="link" danger size="small">
                      {intl.formatMessage({
                        id: 'pages.adminUsers.revoke',
                        defaultMessage: '移除',
                      })}
                    </Button>
                  </Popconfirm>
                </Access>,
              ]}
            >
              <List.Item.Meta
                title={assignment.role_name}
                description={intl.formatMessage(
                  {
                    id: 'pages.adminUsers.assignedAt',
                    defaultMessage: '分配时间：{time}',
                  },
                  {
                    time: new Intl.DateTimeFormat(intl.locale, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    }).format(new Date(assignment.assigned_at)),
                  },
                )}
              />
            </List.Item>
          )}
          locale={{
            emptyText: intl.formatMessage({
              id: 'pages.adminUsers.noRoles',
              defaultMessage: '暂无管理员角色',
            }),
          }}
        />
      </Modal>

      {/* 分配管理员角色对话框 */}
      <ModalForm<{ role_ids: string[] }>
        title={intl.formatMessage(
          {
            id: 'pages.adminUsers.assignRoleTitle',
            defaultMessage: '分配管理员角色 - {email}',
          },
          { email: currentRow?.email },
        )}
        open={assignModalVisible}
        onOpenChange={setAssignModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleAssignRoles}
      >
        <ProFormSelect
          name="role_ids"
          label={intl.formatMessage({
            id: 'pages.adminUsers.selectRoles',
            defaultMessage: '选择管理员角色',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.selectRolesPlaceholder',
            defaultMessage: '请选择要分配的管理员角色',
          })}
          mode="multiple"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.adminUsers.selectRolesRequired',
                defaultMessage: '请选择至少一个管理员角色',
              }),
            },
          ]}
          options={roleOptions}
        />
      </ModalForm>

      {/* 创建管理员对话框 */}
      <ModalForm<{
        email: string;
        password: string;
        name?: string;
        role_ids?: string[];
      }>
        title={intl.formatMessage({
          id: 'pages.adminUsers.createTitle',
          defaultMessage: '创建管理员',
        })}
        open={createModalVisible}
        onOpenChange={setCreateModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleCreateUser}
      >
        <ProFormText
          name="email"
          label={intl.formatMessage({
            id: 'pages.adminUsers.emailLabel',
            defaultMessage: '邮箱',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.emailPlaceholder',
            defaultMessage: '请输入邮箱',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.adminUsers.emailRequired',
                defaultMessage: '请输入邮箱',
              }),
            },
            {
              type: 'email',
              message: intl.formatMessage({
                id: 'pages.adminUsers.emailInvalid',
                defaultMessage: '请输入有效的邮箱地址',
              }),
            },
          ]}
        />
        <ProFormText.Password
          name="password"
          label={intl.formatMessage({
            id: 'pages.adminUsers.passwordLabel',
            defaultMessage: '密码',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.passwordPlaceholder',
            defaultMessage: '请输入密码（至少6位）',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.adminUsers.passwordRequired',
                defaultMessage: '请输入密码',
              }),
            },
            {
              min: 6,
              message: intl.formatMessage({
                id: 'pages.adminUsers.passwordMin',
                defaultMessage: '密码至少6位',
              }),
            },
          ]}
        />
        <ProFormText
          name="name"
          label={intl.formatMessage({
            id: 'pages.adminUsers.nameLabel',
            defaultMessage: '姓名',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.namePlaceholder',
            defaultMessage: '请输入姓名（可选）',
          })}
        />
        <ProFormSelect
          name="role_ids"
          label={intl.formatMessage({
            id: 'pages.adminUsers.rolesLabel',
            defaultMessage: '角色',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.rolesPlaceholder',
            defaultMessage: '请选择角色（可选）',
          })}
          mode="multiple"
          options={roleOptions}
        />
      </ModalForm>

      {/* 编辑管理员对话框 */}
      <ModalForm<{ name?: string; password?: string }>
        title={intl.formatMessage(
          {
            id: 'pages.adminUsers.updateTitle',
            defaultMessage: '编辑管理员 - {email}',
          },
          { email: currentRow?.email },
        )}
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
          label={intl.formatMessage({
            id: 'pages.adminUsers.nameLabel',
            defaultMessage: '姓名',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.nameEditPlaceholder',
            defaultMessage: '请输入姓名',
          })}
        />
        <ProFormText.Password
          name="password"
          label={intl.formatMessage({
            id: 'pages.adminUsers.newPasswordLabel',
            defaultMessage: '新密码',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.newPasswordPlaceholder',
            defaultMessage: '留空则不修改密码',
          })}
          rules={[
            {
              min: 6,
              message: intl.formatMessage({
                id: 'pages.adminUsers.passwordMin',
                defaultMessage: '密码至少6位',
              }),
            },
          ]}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default AdminUserManagementPage;
