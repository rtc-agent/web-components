import { EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess, useIntl, useSearchParams } from '@umijs/max';
import { Button, List, Modal, message, Popconfirm, Space, Tag } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
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
import type { AdminPageAPI } from './page-api';

/**
 * Admin User Management Page
 */
const AdminUserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const { roleOptions } = useRoleOptions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentRow, setCurrentRow] = useState<UserInfo>();
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [userRoles, setUserRoles] = useState<UserRoleAssignment[]>([]);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: AdminPageAPI = {
      // Read table data
      list: async (params = {}) => {
        const { current = 1, pageSize = 20, keyword } = params;

        // Sync URL (no page refresh)
        const newSearchParams = new URLSearchParams();
        if (keyword) {
          newSearchParams.set('keyword', keyword);
        }
        setSearchParams(newSearchParams, { replace: true });

        try {
          const response = await getUserList({
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
          console.error('[Admin Page API] list failed:', error);
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

      // Create admin user
      create: async (data) => {
        try {
          const result = await createAdminUser(data);
          actionRef.current?.reload();
          return { success: true, id: result.id };
        } catch (error) {
          console.error('[Admin Page API] create failed:', error);
          return { success: false };
        }
      },

      // Update admin user
      update: async (data) => {
        try {
          const { id, ...updateData } = data;
          await updateAdminUser(id, updateData);
          actionRef.current?.reload();
          return { success: true };
        } catch (error) {
          console.error('[Admin Page API] update failed:', error);
          return { success: false };
        }
      },

      // Delete admin users
      remove: async (_ids) => {
        try {
          // Note: deleteAdminUser service function is not yet implemented
          // For now, return success: false
          console.warn(
            '[Admin Page API] remove not implemented - delete API not available in service layer',
          );
          return { success: false };
        } catch (error) {
          console.error('[Admin Page API] remove failed:', error);
          return { success: false };
        }
      },

      // Query roles assigned to a user
      listUserRoles: async (userId) => {
        try {
          const response = await getUserRoles(userId);
          return {
            success: true,
            data: response.items,
            total: response.total,
          };
        } catch (error) {
          console.error('[Admin Page API] listUserRoles failed:', error);
          return {
            success: false,
            data: [],
            total: 0,
          };
        }
      },

      // Assign roles to a user
      assignRoles: async (userId, roleIds) => {
        try {
          await assignUserRoles(userId, { role_ids: roleIds });
          actionRef.current?.reload();
          return { success: true };
        } catch (error) {
          console.error('[Admin Page API] assignRoles failed:', error);
          return { success: false };
        }
      },

      // Revoke a role from a user
      revokeRole: async (userId, roleId) => {
        try {
          await revokeUserRole(userId, roleId);
          actionRef.current?.reload();
          return { success: true };
        } catch (error) {
          console.error('[Admin Page API] revokeRole failed:', error);
          return { success: false };
        }
      },
    };

    // Register to global
    window.__pages__ = window.__pages__ || {};
    window.__pages__.admin = pageAPI;

    // Dispatch ready event (notify navigation.goto that page API is registered)
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'admin' } }),
    );

    console.log('[AdminUserManagementPage] Page API registered');

    // Cleanup
    return () => {
      delete window.__pages__?.admin;
      console.log('[AdminUserManagementPage] Page API unregistered');
    };
  }, []);

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    actionRef.current?.reload();
  }, [searchParams]);

  /** Create admin user */
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

  /** Edit admin user */
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

  /** View admin user roles */
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

  /** Assign roles to admin user */
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
      // Refresh admin user role list
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

  /** Revoke admin user role */
  const handleRevokeRole = async (userId: string, roleId: string) => {
    try {
      await revokeUserRole(userId, roleId);
      message.success(
        intl.formatMessage({
          id: 'pages.adminUsers.revokeRoleSuccess',
          defaultMessage: '移除管理员角色成功',
        }),
      );
      // Refresh admin user role list
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

  /** Table column definitions */
  const columns: ProColumns<UserInfo>[] = [
    {
      title: intl.formatMessage({
        id: 'pages.adminUsers.searchPlaceholder',
        defaultMessage: '输入邮箱或姓名搜索',
      }),
      dataIndex: 'keyword',
      valueType: 'text',
      hideInTable: true,
      fieldProps: {
        placeholder: intl.formatMessage({
          id: 'pages.adminUsers.searchPlaceholder',
          defaultMessage: '输入邮箱或姓名搜索',
        }),
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.adminUsers.column.email',
        defaultMessage: '邮箱',
      }),
      dataIndex: 'email',
      valueType: 'text',
      search: false,
    },
    {
      title: intl.formatMessage({
        id: 'pages.adminUsers.column.name',
        defaultMessage: '姓名',
      }),
      dataIndex: 'name',
      valueType: 'text',
      search: false,
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
          <Access accessible={access.canAdminUserRoleEdit} fallback={null}>
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
        form={{
          initialValues: {
            keyword: searchParams.get('keyword') || '',
          },
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
          // Read params from searchParams (URL is single source of truth)
          const keyword = searchParams.get('keyword') || '';
          try {
            const response = await getUserList({
              page: params.current,
              page_size: params.pageSize,
              keyword,
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

      {/* Admin user role management dialog */}
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
            accessible={access.canAdminUserRoleEdit}
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
                  accessible={access.canAdminUserRoleEdit}
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

      {/* Assign roles dialog */}
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

      {/* Create admin user dialog */}
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

      {/* Edit admin user dialog */}
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
