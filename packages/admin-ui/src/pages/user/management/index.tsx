import { PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess, useIntl } from '@umijs/max';
import { App, Button, List, Modal, Popconfirm, Space, Tag } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useModalState } from '@/hooks/useModalState';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { usePermissionRefresh } from '@/hooks/usePermissionRefresh';
import { useProTableLocale } from '@/hooks/useProTableLocale';
import { useRoleOptions } from '@/hooks/useRoleOptions';
import { useTableSearchParams } from '@/hooks/useTableSearchParams';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { createTableRequest } from '@/utils/tableUtils';
import { getEmailRules, getPasswordRules } from '@/utils/validation';
import ActionColumn from './components/ActionColumn';
import type { AdminPageAPI } from './page-api';
import type { UserInfo, UserRoleAssignment } from './service';
import {
  assignUserRoles,
  createAdminUser,
  deleteAdminUser,
  getUserList,
  getUserRoles,
  revokeUserRole,
  updateAdminUser,
} from './service';

/**
 * Admin User Management Page
 */
const AdminUserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const {
    roleOptions,
    loading: rolesLoading,
    error: rolesError,
  } = useRoleOptions();
  const { message } = App.useApp();
  const tableParams = useTableSearchParams<{ keyword?: string }>();
  const [currentRow, setCurrentRow] = useState<UserInfo>();

  // Show error message when role options fail to load
  useEffect(() => {
    if (rolesError) {
      message.error(
        intl.formatMessage({
          id: 'pages.user.roleLoadError',
          defaultMessage:
            'Failed to load role options. Some features may be limited.',
        }),
      );
    }
  }, [rolesError, message, intl]);

  // Modal state management using useModalState hook
  // Each modal is independent - they don't share state transitions
  const roleModal = useModalState<UserInfo>();
  const assignModal = useModalState();
  const createModal = useModalState();
  const editModal = useModalState<UserInfo>();

  // Legacy state for role management (needs additional data)
  const [userRoles, setUserRoles] = useState<UserRoleAssignment[]>([]);
  const isMobile = useIsMobile();
  const tableLocale = useProTableLocale(
    'pages.adminUsers.noData',
    'No administrators found',
  );
  const modalWidth = isMobile ? '95vw' : 520;
  const roleModalWidth = isMobile ? '95vw' : 600;
  const { refreshPermissions } = usePermissionRefresh();

  // Cache DateTimeFormat instance to avoid re-creating on every render
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(intl.locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    [intl.locale],
  );

  // === Register Page API ===
  usePageAPIRegistration(
    'admin',
    useCallback(
      (): AdminPageAPI => ({
        // Sync URL filters and trigger table reload
        list: async (params = {}) => {
          const { keyword } = params;

          // Sync filters to URL (no page refresh). Pagination is transient state, not synced.
          tableParams.set({ keyword });

          // Trigger table reload via actionRef (ProTable request will handle data fetching)
          actionRef.current?.reload();

          return {
            success: true,
            data: [],
            total: 0,
          };
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
            console.error('[Admin Page API] create failed:', {
              data,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.adminUsers.createFailed',
                  defaultMessage: 'Failed to create administrator',
                }),
              ),
            );
            return { success: false };
          }
        },

        // Update admin user
        update: async (data) => {
          const { id, ...updateData } = data;
          try {
            await updateAdminUser(id, updateData);
            actionRef.current?.reload();
            return { success: true };
          } catch (error) {
            console.error('[Admin Page API] update failed:', {
              id,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.adminUsers.updateFailed',
                  defaultMessage: 'Failed to update administrator',
                }),
              ),
            );
            return { success: false };
          }
        },

        // Delete admin users (parallel execution)
        // Note: deleteAdminUser returns void (interceptor throws on error)
        remove: async (ids) => {
          try {
            await Promise.all(ids.map((id) => deleteAdminUser(id)));
            actionRef.current?.reload();
            // Refresh current user permissions if needed
            await refreshPermissions({
              auditContext: {
                action: 'delete_admin_user',
                details: { deletedUserIds: ids },
              },
            });
            return {
              success: true,
              deletedCount: ids.length,
            };
          } catch (error) {
            console.error('[Admin Page API] remove failed:', {
              ids,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.adminUsers.deleteFailed',
                  defaultMessage: 'Failed to delete administrator',
                }),
              ),
            );
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
            console.error('[Admin Page API] listUserRoles failed:', {
              userId,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.adminUsers.loadRolesFailed',
                  defaultMessage: 'Failed to load user roles',
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

        // Assign roles to a user
        assignRoles: async (userId, roleIds) => {
          try {
            await assignUserRoles(userId, { role_ids: roleIds });
            actionRef.current?.reload();
            return { success: true };
          } catch (error) {
            console.error('[Admin Page API] assignRoles failed:', {
              userId,
              roleIds,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.adminUsers.assignRolesFailed',
                  defaultMessage: 'Failed to assign roles',
                }),
              ),
            );
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
            console.error('[Admin Page API] revokeRole failed:', {
              userId,
              roleId,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.adminUsers.revokeRoleFailed',
                  defaultMessage: 'Failed to revoke role',
                }),
              ),
            );
            return { success: false };
          }
        },
      }),
      [tableParams],
    ),
  );

  // Listen for URL changes, auto-reload table
  // Note: actionRef is a ref and doesn't change, so only tableParams is needed in dependencies.
  // Unlike the messages page, there's no derived state (like sessionId) that needs to be tracked.
  useEffect(() => {
    actionRef.current?.reload();
  }, [tableParams]);

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
          defaultMessage: 'Administrator created successfully',
        }),
      );
      createModal.close();
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.adminUsers.createFailed',
            defaultMessage: 'Failed to create administrator',
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
          defaultMessage: 'Administrator updated successfully',
        }),
      );
      editModal.close();
      setCurrentRow(undefined);
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.adminUsers.updateFailed',
            defaultMessage: 'Failed to update administrator',
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
      roleModal.open(user);
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.adminUsers.loadRolesFailed',
            defaultMessage: 'Failed to load admin role',
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
          defaultMessage: 'Admin role assigned successfully',
        }),
      );
      assignModal.close();
      // Refresh table data (role modal will get roles from table data)
      actionRef.current?.reload();
      // Refresh current user permissions (may have assigned roles to self)
      await refreshPermissions({
        auditContext: {
          action: 'assign_roles',
          target: currentRow.id,
          details: { roleIds: values.role_ids },
        },
      });
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.adminUsers.assignRoleFailed',
            defaultMessage: 'Failed to assign admin role',
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
          defaultMessage: 'Admin role removed successfully',
        }),
      );
      // Refresh table data (role modal will get roles from table data)
      actionRef.current?.reload();
      // Refresh current user permissions (may have revoked roles from self)
      await refreshPermissions({
        auditContext: {
          action: 'revoke_role',
          target: userId,
          details: { roleId },
        },
      });
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.adminUsers.revokeRoleFailed',
            defaultMessage: 'Failed to remove admin role',
          }),
        ),
      );
    }
  };

  /** Handle admin user edit button click */
  const handleEditUser = useCallback((record: UserInfo) => {
    setCurrentRow(record);
    editModal.open(record);
  }, []);

  /** Handle admin user delete with permission refresh */
  const handleDeleteUser = useCallback(
    async (record: UserInfo) => {
      // Refresh permissions before sensitive operation to ensure they are current
      await refreshPermissions({ showErrorMessage: true });

      // Re-check permission after refresh
      if (!access.canAdminUserDelete) {
        message.error(
          intl.formatMessage({
            id: 'pages.permission.denied',
            defaultMessage: 'Permission denied',
          }),
        );
        return;
      }

      try {
        await deleteAdminUser(record.id);
        message.success(
          intl.formatMessage({
            id: 'pages.adminUsers.deleteSuccess',
            defaultMessage: 'Admin deleted successfully',
          }),
        );
        actionRef.current?.reload();
        // Refresh current user permissions in case of self-deletion or role changes
        await refreshPermissions({
          auditContext: {
            action: 'delete_admin_user',
            target: record.id,
          },
        });
      } catch (error: unknown) {
        message.error(
          getFriendlyErrorMessage(
            error,
            intl,
            intl.formatMessage({
              id: 'pages.adminUsers.deleteFailed',
              defaultMessage: 'Failed to delete admin',
            }),
          ),
        );
      }
    },
    [intl, message, refreshPermissions, access],
  );

  /** Table column definitions */
  const columns: ProColumns<UserInfo>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.adminUsers.searchPlaceholder',
          defaultMessage: 'Enter email or name to search',
        }),
        dataIndex: 'keyword',
        valueType: 'text',
        hideInTable: true,
        fieldProps: {
          placeholder: intl.formatMessage({
            id: 'pages.adminUsers.searchPlaceholder',
            defaultMessage: 'Enter email or name to search',
          }),
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.adminUsers.column.email',
          defaultMessage: 'Email',
        }),
        dataIndex: 'email',
        valueType: 'text',
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.adminUsers.column.name',
          defaultMessage: 'Name',
        }),
        dataIndex: 'name',
        valueType: 'text',
        search: false,
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.adminUsers.column.roles',
          defaultMessage: 'Admin role',
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
          defaultMessage: 'Action',
        }),
        dataIndex: 'option',
        valueType: 'option',
        render: (_, record) => (
          <ActionColumn
            record={record}
            intl={intl}
            access={access}
            onEdit={handleEditUser}
            onManageRoles={handleViewRoles}
            onDelete={handleDeleteUser}
          />
        ),
      },
    ],
    [intl, access, isMobile, handleEditUser, handleViewRoles, handleDeleteUser],
  );

  return (
    <PageContainer>
      <ProTable<UserInfo>
        headerTitle={intl.formatMessage({
          id: 'pages.adminUsers.headerTitle',
          defaultMessage: 'Administrator list',
        })}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
        locale={tableLocale}
        search={{
          labelWidth: 'auto',
        }}
        form={{
          initialValues: {
            keyword: tableParams.getParam('keyword') || '',
          },
        }}
        toolBarRender={() => [
          <Access accessible={access.canAdminUserEdit} key="create">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => createModal.open()}
            >
              {intl.formatMessage({
                id: 'pages.adminUsers.create',
                defaultMessage: 'Create administrator',
              })}
            </Button>
          </Access>,
        ]}
        request={createTableRequest(
          async (params) => {
            // Read params from tableParams (URL is single source of truth)
            const keyword = tableParams.getParam('keyword') || '';
            const response = await getUserList({
              page: params.current,
              page_size: params.pageSize,
              keyword,
            });
            return {
              items: response.items,
              total: response.total,
            };
          },
          message,
          intl,
          {
            id: 'pages.adminUsers.loadFailed',
            defaultMessage: 'Failed to load administrators',
          },
        )}
        columns={columns}
      />

      {/* Admin user role management dialog */}
      <Modal
        title={intl.formatMessage(
          {
            id: 'pages.adminUsers.roleManagementTitle',
            defaultMessage: 'Admin role management - {email}',
          },
          { email: currentRow?.email },
        )}
        open={roleModal.state.open}
        onCancel={() => {
          roleModal.close();
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
                assignModal.open();
              }}
            >
              {intl.formatMessage({
                id: 'pages.adminUsers.assignRole',
                defaultMessage: 'Assign admin role',
              })}
            </Button>
          </Access>,
          <Button
            key="close"
            onClick={() => {
              roleModal.close();
              setCurrentRow(undefined);
              setUserRoles([]);
            }}
          >
            {intl.formatMessage({
              id: 'pages.adminUsers.close',
              defaultMessage: 'Close',
            })}
          </Button>,
        ]}
        width={roleModalWidth}
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
                      defaultMessage:
                        'Are you sure you want to remove this admin role?',
                    })}
                    onConfirm={() => {
                      if (currentRow) {
                        handleRevokeRole(currentRow.id, assignment.role_id);
                      }
                    }}
                    okText={intl.formatMessage({
                      id: 'pages.adminUsers.confirm',
                      defaultMessage: 'Confirm',
                    })}
                    cancelText={intl.formatMessage({
                      id: 'pages.adminUsers.cancel',
                      defaultMessage: 'Cancel',
                    })}
                  >
                    <Button type="link" danger size="small">
                      {intl.formatMessage({
                        id: 'pages.adminUsers.revoke',
                        defaultMessage: 'Remove',
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
                    defaultMessage: 'Assigned time: {time}',
                  },
                  {
                    time: dateTimeFormatter.format(
                      new Date(assignment.assigned_at),
                    ),
                  },
                )}
              />
            </List.Item>
          )}
          locale={{
            emptyText: intl.formatMessage({
              id: 'pages.adminUsers.noRoles',
              defaultMessage: 'No admin roles',
            }),
          }}
        />
      </Modal>

      {/* Assign roles dialog */}
      <ModalForm<{ role_ids: string[] }>
        title={intl.formatMessage(
          {
            id: 'pages.adminUsers.assignRoleTitle',
            defaultMessage: 'Assign admin role - {email}',
          },
          { email: currentRow?.email },
        )}
        open={assignModal.state.open}
        onOpenChange={(visible) => {
          if (visible) {
            assignModal.open();
          } else {
            assignModal.close();
          }
        }}
        width={modalWidth}
        modalProps={{
          destroyOnHidden: true,
        }}
        onFinish={handleAssignRoles}
      >
        <ProFormSelect
          name="role_ids"
          label={intl.formatMessage({
            id: 'pages.adminUsers.selectRoles',
            defaultMessage: 'Select admin role',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.selectRolesPlaceholder',
            defaultMessage: 'Please select admin role to assign',
          })}
          mode="multiple"
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.adminUsers.selectRolesRequired',
                defaultMessage: 'Please select at least one admin role',
              }),
            },
            {
              validator: async (_, value) => {
                if (!value || value.length === 0) {
                  return Promise.reject(
                    new Error(
                      intl.formatMessage({
                        id: 'pages.adminUsers.selectRolesRequired',
                        defaultMessage: 'Please select at least one admin role',
                      }),
                    ),
                  );
                }
              },
            },
          ]}
          options={roleOptions}
          fieldProps={{
            loading: rolesLoading,
          }}
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
          defaultMessage: 'Create administrator',
        })}
        open={createModal.state.open}
        onOpenChange={(visible) => {
          if (visible) {
            createModal.open();
          } else {
            createModal.close();
          }
        }}
        width={modalWidth}
        modalProps={{
          destroyOnHidden: true,
        }}
        onFinish={handleCreateUser}
      >
        <ProFormText
          name="email"
          label={intl.formatMessage({
            id: 'pages.adminUsers.emailLabel',
            defaultMessage: 'Email',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.emailPlaceholder',
            defaultMessage: 'Please enter email',
          })}
          rules={[
            ...getEmailRules(intl.formatMessage),
            {
              whitespace: true,
              message: intl.formatMessage({
                id: 'pages.adminUsers.emailWhitespace',
                defaultMessage: 'Email cannot be only spaces',
              }),
            },
          ]}
        />
        <ProFormText.Password
          name="password"
          label={intl.formatMessage({
            id: 'pages.adminUsers.passwordLabel',
            defaultMessage: 'Password',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.passwordPlaceholder',
            defaultMessage: 'Please enter password (at least 6 characters)',
          })}
          rules={getPasswordRules(intl.formatMessage)}
        />
        <ProFormText
          name="name"
          label={intl.formatMessage({
            id: 'pages.adminUsers.nameLabel',
            defaultMessage: 'Name',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.namePlaceholder',
            defaultMessage: 'Please enter name (optional)',
          })}
          rules={[
            {
              whitespace: true,
              message: intl.formatMessage({
                id: 'pages.adminUsers.nameWhitespace',
                defaultMessage: 'Name cannot be all spaces',
              }),
            },
            {
              max: 100,
              message: intl.formatMessage({
                id: 'pages.adminUsers.nameMax',
                defaultMessage: 'Name cannot exceed 100 characters',
              }),
            },
          ]}
        />
        <ProFormSelect
          name="role_ids"
          label={intl.formatMessage({
            id: 'pages.adminUsers.rolesLabel',
            defaultMessage: 'Role',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.rolesPlaceholder',
            defaultMessage: 'Please select role (optional)',
          })}
          mode="multiple"
          options={roleOptions}
          fieldProps={{
            loading: rolesLoading,
          }}
        />
      </ModalForm>

      {/* Edit admin user dialog */}
      <ModalForm<{ name?: string; password?: string }>
        title={intl.formatMessage(
          {
            id: 'pages.adminUsers.updateTitle',
            defaultMessage: 'Edit administrator - {email}',
          },
          { email: currentRow?.email },
        )}
        open={editModal.state.open}
        onOpenChange={(visible) => {
          if (visible) {
            editModal.open();
          } else {
            editModal.close();
          }
        }}
        width={modalWidth}
        modalProps={{
          destroyOnHidden: true,
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
            defaultMessage: 'Name',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.nameEditPlaceholder',
            defaultMessage: 'Please enter name',
          })}
          rules={[
            {
              whitespace: true,
              message: intl.formatMessage({
                id: 'pages.adminUsers.nameWhitespace',
                defaultMessage: 'Name cannot be all spaces',
              }),
            },
            {
              max: 100,
              message: intl.formatMessage({
                id: 'pages.adminUsers.nameMax',
                defaultMessage: 'Name cannot exceed 100 characters',
              }),
            },
          ]}
        />
        <ProFormText.Password
          name="password"
          label={intl.formatMessage({
            id: 'pages.adminUsers.newPasswordLabel',
            defaultMessage: 'New password',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.adminUsers.newPasswordPlaceholder',
            defaultMessage: 'Leave blank to keep password unchanged',
          })}
          rules={getPasswordRules(intl.formatMessage, { required: false })}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default AdminUserManagementPage;
