import { PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormText,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import { useQueryClient } from '@tanstack/react-query';
import { Access, useAccess, useIntl } from '@umijs/max';
import {
  App,
  Button,
  Checkbox,
  Modal,
  Switch,
  Tag,
  Tooltip,
  theme,
} from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getMaxLengthRule,
  getMinLengthRule,
  getPatternRule,
  getRequiredRule,
  getWhitespaceRule,
} from '@/constants/form-rules';
import { getActionTypes, getResourceTypes } from '@/constants/permissions';
import { useModalState } from '@/hooks/useModalState';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { usePermissionRefresh } from '@/hooks/usePermissionRefresh';
import { useProTableLocale } from '@/hooks/useProTableLocale';
import { useResponsiveModalWidth } from '@/hooks/useResponsiveModalWidth';
import { useTableSearchParams } from '@/hooks/useTableSearchParams';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { queryKeys } from '@/utils/queryKeys';
import { createTableRequest, parseTableSort } from '@/utils/tableUtils';
import ActionColumn from './components/ActionColumn';
import type { RoleFormValues, RoleTableItem } from './data';
import type { RolePageAPI } from './page-api';
import type { PermissionPolicy } from './service';
import {
  createPermission,
  createRole,
  deletePermission,
  deleteRole,
  getPermissionList,
  getRoleList,
  patchRole,
  updateRole,
} from './service';

/**
 * Admin Role Management Page
 */
const RoleListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const tableParams = useTableSearchParams<{ keyword?: string }>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [currentRow, setCurrentRow] = useState<RoleTableItem>();
  const { token } = theme.useToken();
  const [isEdit, setIsEdit] = useState(false);

  // Modal state management using useModalState hook
  const roleModal = useModalState<RoleTableItem>();
  const permissionModal = useModalState<RoleTableItem>();

  const [rolePermissions, setRolePermissions] = useState<PermissionPolicy[]>(
    [],
  );
  /** Permission toggle key (resource:action), prevents race condition on rapid clicks */
  const togglingPermissionRef = useRef<string | null>(null);
  const modalWidth = useResponsiveModalWidth(520);
  const permissionModalWidth = useResponsiveModalWidth(800);
  const { refreshPermissions } = usePermissionRefresh();
  const tableLocale = useProTableLocale(
    'pages.roles.empty',
    'No admin roles found',
  );
  /** Debounce timer ref for async role name validation (prevents excessive API calls) */
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const RESOURCE_TYPES = getResourceTypes(intl);
  const ACTION_TYPES = getActionTypes(intl);

  // === Register Page API ===
  usePageAPIRegistration(
    'role',
    useCallback(
      (): RolePageAPI => ({
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

        // Create admin role
        create: async (data) => {
          try {
            const result = await createRole(data);
            actionRef.current?.reload();
            // Invalidate role list cache so other pages (e.g., user management) see the new role
            queryClient.invalidateQueries({ queryKey: queryKeys.roleList.all });
            return { success: true, id: result.id };
          } catch (error) {
            console.error('[Role Page API] create failed:', {
              data,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.roles.createFailed',
                  defaultMessage: 'Creation failed',
                }),
              ),
            );
            return { success: false };
          }
        },

        // Update admin role
        update: async (data) => {
          const { id, ...updateData } = data;
          try {
            await updateRole(id, updateData);
            actionRef.current?.reload();
            // Invalidate role list cache so other pages see the updated role
            queryClient.invalidateQueries({ queryKey: queryKeys.roleList.all });
            return { success: true };
          } catch (error) {
            console.error('[Role Page API] update failed:', {
              id,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.roles.updateFailed',
                  defaultMessage: 'Update failed',
                }),
              ),
            );
            return { success: false };
          }
        },

        // Delete admin roles (parallel execution)
        remove: async (ids) => {
          try {
            await Promise.all(ids.map((id) => deleteRole(id)));
            actionRef.current?.reload();
            // Invalidate role list cache so other pages see the deletion
            queryClient.invalidateQueries({ queryKey: queryKeys.roleList.all });
            return {
              success: true,
              deletedCount: ids.length,
            };
          } catch (error) {
            console.error('[Role Page API] remove failed:', {
              ids,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.roles.deleteFailed',
                  defaultMessage: 'Deletion failed',
                }),
              ),
            );
            return { success: false };
          }
        },
      }),
      [],
    ),
  );

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    actionRef.current?.reload();
  }, [tableParams]);

  /** Handle role edit button click */
  const handleEditRole = useCallback((record: RoleTableItem) => {
    setCurrentRow(record);
    setIsEdit(true);
    roleModal.open(record);
  }, []);

  /** Handle role delete with optimistic feedback and cache invalidation */
  const handleDeleteRole = useCallback(
    async (record: RoleTableItem) => {
      // Refresh permissions before sensitive operation to ensure they are current
      await refreshPermissions({ showErrorMessage: true });

      // Re-check permission after refresh
      if (!access.canAdminRoleEdit) {
        message.error(
          intl.formatMessage({
            id: 'pages.permission.denied',
            defaultMessage: 'Permission denied',
          }),
        );
        return;
      }

      try {
        await deleteRole(record.id);
        message.success(
          intl.formatMessage({
            id: 'pages.roles.deleteSuccess',
            defaultMessage: 'Deleted successfully',
          }),
        );
        actionRef.current?.reload();
        // Invalidate role list cache so other pages see the deletion
        queryClient.invalidateQueries({
          queryKey: queryKeys.roleList.all,
        });
        // Refresh current user permissions (deleted role may have been assigned to current user)
        await refreshPermissions();
      } catch (error: unknown) {
        message.error(
          getFriendlyErrorMessage(
            error,
            intl,
            intl.formatMessage({
              id: 'pages.roles.deleteFailed',
              defaultMessage: 'Deletion failed',
            }),
          ),
        );
      }
    },
    [intl, message, queryClient, refreshPermissions, access],
  );

  /** Open permission management modal */
  const handleManagePermissions = useCallback(
    async (role: RoleTableItem) => {
      setCurrentRow(role);
      permissionModal.open(role);

      try {
        // NOTE: page_size=1000 is safe because permission count = RESOURCE_TYPES.length × ACTION_TYPES.length,
        // which is much smaller than 1000 (currently ~50 permissions)
        const rolePerms = await getPermissionList({
          page: 1,
          page_size: 1000,
          role_id: role.id,
        });
        setRolePermissions(rolePerms.items);
      } catch (error: unknown) {
        message.error(
          getFriendlyErrorMessage(
            error,
            intl,
            intl.formatMessage({
              id: 'pages.roles.loadPermissionFailed',
              defaultMessage: 'Failed to load permission',
            }),
          ),
        );
      }
    },
    [intl, message],
  );

  /** Table column definitions */
  const columns: ProColumns<RoleTableItem>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.roles.searchPlaceholder',
          defaultMessage: 'Enter admin role name, display name, or description',
        }),
        dataIndex: 'keyword',
        valueType: 'text',
        hideInTable: true,
        fieldProps: {
          placeholder: intl.formatMessage({
            id: 'pages.roles.searchPlaceholder',
            defaultMessage:
              'Enter admin role name, display name, or description',
          }),
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.roles.column.name',
          defaultMessage: 'Admin role name',
        }),
        dataIndex: 'name',
        valueType: 'text',
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.roles.column.displayName',
          defaultMessage: 'Display name',
        }),
        dataIndex: 'display_name',
        valueType: 'text',
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.roles.column.description',
          defaultMessage: 'Description',
        }),
        dataIndex: 'description',
        valueType: 'text',
        search: false,
        ellipsis: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.roles.column.isSystem',
          defaultMessage: 'System administrator role',
        }),
        dataIndex: 'is_system',
        valueType: 'select',
        search: false,
        valueEnum: {
          true: {
            text: intl.formatMessage({
              id: 'pages.roles.yes',
              defaultMessage: 'Yes',
            }),
            status: 'Default',
          },
          false: {
            text: intl.formatMessage({
              id: 'pages.roles.no',
              defaultMessage: 'No',
            }),
            status: 'Processing',
          },
        },
        render: (_, record) => (
          <Tag color={record.is_system ? 'default' : 'processing'}>
            {record.is_system
              ? intl.formatMessage({
                  id: 'pages.roles.systemRole',
                  defaultMessage: 'System administrator role',
                })
              : intl.formatMessage({
                  id: 'pages.roles.customRole',
                  defaultMessage: 'Custom admin role',
                })}
          </Tag>
        ),
      },
      {
        title: intl.formatMessage({
          id: 'pages.roles.column.status',
          defaultMessage: 'Status',
        }),
        dataIndex: 'is_enabled',
        valueType: 'select',
        search: false,
        valueEnum: {
          true: {
            text: intl.formatMessage({
              id: 'pages.roles.statusEnabled',
              defaultMessage: 'Enable',
            }),
            status: 'Success',
          },
          false: {
            text: intl.formatMessage({
              id: 'pages.roles.statusDisabled',
              defaultMessage: 'Disable',
            }),
            status: 'Error',
          },
        },
        render: (_, record) => (
          <Access
            accessible={access.canAdminRoleEdit}
            fallback={
              <Tag color={record.is_enabled ? 'success' : 'error'}>
                {record.is_enabled
                  ? intl.formatMessage({
                      id: 'pages.roles.statusEnabled',
                      defaultMessage: 'Enable',
                    })
                  : intl.formatMessage({
                      id: 'pages.roles.statusDisabled',
                      defaultMessage: 'Disable',
                    })}
              </Tag>
            }
          >
            <Tooltip
              title={
                record.is_system
                  ? intl.formatMessage({
                      id: 'pages.roles.systemRoleCannotDisable',
                      defaultMessage:
                        'System built-in admin role cannot be disabled',
                    })
                  : ''
              }
            >
              <Switch
                checked={record.is_enabled}
                disabled={record.is_system}
                onChange={async (checked) => {
                  try {
                    await patchRole(record.id, { is_enabled: checked });
                    message.success(
                      checked
                        ? intl.formatMessage({
                            id: 'pages.roles.statusEnabled',
                            defaultMessage: 'Enabled',
                          })
                        : intl.formatMessage({
                            id: 'pages.roles.statusDisabled',
                            defaultMessage: 'Disabled',
                          }),
                    );
                    actionRef.current?.reload();
                    // Refresh current user permissions (role status change may affect access)
                    await refreshPermissions();
                  } catch (error: unknown) {
                    message.error(
                      getFriendlyErrorMessage(
                        error,
                        intl,
                        intl.formatMessage({
                          id: 'pages.roles.operationFailed',
                          defaultMessage: 'Operation failed',
                        }),
                      ),
                    );
                  }
                }}
              />
            </Tooltip>
          </Access>
        ),
      },
      {
        title: intl.formatMessage({
          id: 'pages.roles.column.createdAt',
          defaultMessage: 'Created at',
        }),
        dataIndex: 'created_at',
        valueType: 'dateTime',
        search: false,
        sorter: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.roles.column.actions',
          defaultMessage: 'Action',
        }),
        dataIndex: 'option',
        valueType: 'option',
        render: (_, record) => (
          <ActionColumn
            record={record}
            intl={intl}
            access={access}
            warningColor={token.colorWarning}
            onPermission={handleManagePermissions}
            onEdit={handleEditRole}
            onDelete={handleDeleteRole}
          />
        ),
      },
    ],
    [
      intl,
      access,
      token,
      handleManagePermissions,
      handleEditRole,
      handleDeleteRole,
    ],
  );

  /** Submit form */
  const handleSubmit = async (values: RoleFormValues) => {
    try {
      if (isEdit && currentRow) {
        await updateRole(currentRow.id, values);
        message.success(
          intl.formatMessage({
            id: 'pages.roles.updateSuccess',
            defaultMessage: 'Updated successfully',
          }),
        );
      } else {
        await createRole(values);
        message.success(
          intl.formatMessage({
            id: 'pages.roles.createSuccess',
            defaultMessage: 'Created successfully',
          }),
        );
      }
      actionRef.current?.reload();
      // Invalidate role list cache so other pages see the changes
      queryClient.invalidateQueries({ queryKey: queryKeys.roleList.all });
      roleModal.close();
      setCurrentRow(undefined);
      setIsEdit(false);
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          isEdit
            ? intl.formatMessage({
                id: 'pages.roles.updateFailed',
                defaultMessage: 'Update failed',
              })
            : intl.formatMessage({
                id: 'pages.roles.createFailed',
                defaultMessage: 'Creation failed',
              }),
        ),
      );
      return false;
    }
  };

  /** Toggle permission */
  const handleTogglePermission = async (
    resource: string,
    action: string,
    checked: boolean,
  ) => {
    if (!currentRow) return;

    const permKey = `${resource}:${action}`;
    // Prevent race condition: if already toggling, return early
    if (togglingPermissionRef.current === permKey) return;
    togglingPermissionRef.current = permKey;

    try {
      if (checked) {
        // Add permission
        await createPermission({
          role_id: currentRow.id,
          resource,
          action,
        });
        message.success(
          intl.formatMessage({
            id: 'pages.roles.permissionAdded',
            defaultMessage: 'Permission added',
          }),
        );
      } else {
        // Remove permission
        await deletePermission({
          role_id: currentRow.id,
          resource,
          action,
        });
        message.success(
          intl.formatMessage({
            id: 'pages.roles.permissionRemoved',
            defaultMessage: 'Permission removed',
          }),
        );
      }

      // Refresh permission list
      // NOTE: page_size=1000 is safe because permission count = RESOURCE_TYPES.length × ACTION_TYPES.length,
      // which is much smaller than 1000 (currently ~50 permissions)
      const rolePerms = await getPermissionList({
        page: 1,
        page_size: 1000,
        role_id: currentRow.id,
      });
      setRolePermissions(rolePerms.items);

      // Refresh current user permissions (permission change may affect access)
      await refreshPermissions();
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.roles.operationFailed',
            defaultMessage: 'Operation failed',
          }),
        ),
      );
    } finally {
      togglingPermissionRef.current = null;
    }
  };

  /** Check if role has a specific permission */
  const hasPermission = (resource: string, action: string) => {
    return rolePermissions.some(
      (p) => p.resource === resource && p.action === action,
    );
  };

  return (
    <PageContainer>
      <ProTable<RoleTableItem>
        headerTitle={intl.formatMessage({
          id: 'pages.roles.headerTitle',
          defaultMessage: 'Admin role list',
        })}
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 'auto',
        }}
        form={{
          initialValues: {
            keyword: tableParams.getParam('keyword') || '',
          },
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
                roleModal.open();
              }}
            >
              {intl.formatMessage({
                id: 'pages.roles.createRole',
                defaultMessage: 'Create admin role',
              })}
            </Button>
          </Access>,
        ]}
        request={createTableRequest(
          async (params, sort) => {
            // Read keyword from tableParams (URL is single source of truth)
            const keyword = tableParams.getParam('keyword') || '';
            const sortParams = parseTableSort(sort || {});
            const response = await getRoleList({
              page: params.current,
              page_size: params.pageSize,
              keyword,
              ...sortParams,
            });
            return {
              items: response.items.map((item) => ({
                ...item,
                key: item.id,
              })),
              total: response.total,
            };
          },
          message,
          intl,
          {
            id: 'pages.roles.loadFailed',
            defaultMessage: 'Failed to load admin roles',
          },
        )}
        columns={columns}
        locale={tableLocale}
      />

      <ModalForm<RoleFormValues>
        title={
          isEdit
            ? intl.formatMessage({
                id: 'pages.roles.editRole',
                defaultMessage: 'Edit admin role',
              })
            : intl.formatMessage({
                id: 'pages.roles.createRole',
                defaultMessage: 'Create admin role',
              })
        }
        open={roleModal.state.open}
        onOpenChange={(visible) => {
          if (visible) {
            roleModal.open();
          } else {
            roleModal.close();
          }
        }}
        width={modalWidth}
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
          label={intl.formatMessage({
            id: 'pages.roles.nameLabel',
            defaultMessage: 'Admin role name',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.roles.namePlaceholder',
            defaultMessage:
              'Please enter admin role name (English, e.g., admin)',
          })}
          rules={[
            getRequiredRule(intl.formatMessage, {
              id: 'pages.roles.nameRequired',
              defaultMessage: 'Please enter admin role name',
            }),
            getWhitespaceRule(intl.formatMessage, {
              id: 'pages.roles.nameNoWhitespace',
              defaultMessage: 'Admin role name cannot be only spaces',
            }),
            getMinLengthRule(3, intl.formatMessage, {
              id: 'pages.roles.nameMinLength',
              defaultMessage:
                'Admin role name must be at least {min} characters',
            }),
            getPatternRule(/^[a-z][a-z0-9_]*$/, intl.formatMessage, {
              id: 'pages.roles.namePattern',
              defaultMessage:
                'Admin role name can only contain lowercase letters, numbers, and underscores, and must start with a letter',
            }),
            {
              validator: async (_rule, value) => {
                if (!value || isEdit) return Promise.resolve();
                // Debounce async validation (300ms) to reduce API calls during rapid typing.
                // Uses a shared timer per component instance via closure.
                await new Promise<void>((resolve) => {
                  if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                  }
                  debounceTimerRef.current = setTimeout(resolve, 300);
                });
                // Async check if role name already exists
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
                    return Promise.reject(
                      new Error(
                        intl.formatMessage({
                          id: 'pages.roles.nameExists',
                          defaultMessage: 'Admin role name already exists',
                        }),
                      ),
                    );
                  }
                } catch (_error) {
                  // 网络错误或 API 调用失败时，选择放行而不是阻止用户提交。
                  // 原因：
                  // 1. 这是前端的前置校验，后端会有最终的唯一性校验
                  // 2. 网络问题不应阻止用户尝试提交
                  // 3. 如果后端也失败，会在那时显示更准确的错误信息
                  // 因此这里选择静默放行，让后端做最终校验
                }
                return Promise.resolve();
              },
            },
          ]}
          disabled={isEdit}
          tooltip={intl.formatMessage({
            id: 'pages.roles.nameTooltip',
            defaultMessage: 'Admin role name cannot be modified after creation',
          })}
        />
        <ProFormText
          name="display_name"
          label={intl.formatMessage({
            id: 'pages.roles.displayNameLabel',
            defaultMessage: 'Display name',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.roles.displayNamePlaceholder',
            defaultMessage: 'Please enter display name (e.g., Administrator)',
          })}
          rules={[
            getRequiredRule(intl.formatMessage, {
              id: 'pages.roles.displayNameRequired',
              defaultMessage: 'Please enter display name',
            }),
            getWhitespaceRule(intl.formatMessage, {
              id: 'pages.roles.displayNameWhitespace',
              defaultMessage: 'Display name cannot be only spaces',
            }),
            getMaxLengthRule(100, intl.formatMessage, {
              id: 'pages.roles.displayNameMaxLength',
              defaultMessage: 'Display name cannot exceed {max} characters',
            }),
          ]}
        />
        <ProFormTextArea
          name="description"
          label={intl.formatMessage({
            id: 'pages.roles.descriptionLabel',
            defaultMessage: 'Description',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.roles.descriptionPlaceholder',
            defaultMessage: 'Please enter admin role description',
          })}
          fieldProps={{ rows: 4, maxLength: 500, showCount: true }}
          rules={[
            getRequiredRule(intl.formatMessage, {
              id: 'pages.roles.descriptionRequired',
              defaultMessage: 'Please enter admin role description',
            }),
            getWhitespaceRule(intl.formatMessage, {
              id: 'pages.roles.descriptionWhitespace',
              defaultMessage: 'Description cannot be empty or only spaces',
            }),
            getMaxLengthRule(500, intl.formatMessage, {
              id: 'pages.roles.descriptionMaxLength',
              defaultMessage: 'Description cannot exceed {max} characters',
            }),
          ]}
        />
      </ModalForm>

      {/* Permission management dialog */}
      <Modal
        title={intl.formatMessage(
          {
            id: 'pages.roles.permissionManagement',
            defaultMessage: 'Permission management - {name}',
          },
          { name: currentRow?.display_name || currentRow?.name },
        )}
        open={permissionModal.state.open}
        onCancel={() => {
          permissionModal.close();
          setCurrentRow(undefined);
          setRolePermissions([]);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              permissionModal.close();
              setCurrentRow(undefined);
              setRolePermissions([]);
            }}
          >
            {intl.formatMessage({
              id: 'pages.roles.close',
              defaultMessage: 'Close',
            })}
          </Button>,
        ]}
        width={permissionModalWidth}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {/*
           * Use native table instead of antd Table:
           * This is a permission matrix with complex merged cell layout (resource type rows x action type columns).
           * antd Table's column model cannot naturally express this matrix structure,
           * and Checkbox cells need precise center alignment control.
           */}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  borderBottom: `2px solid ${token.colorBorderSecondary}`,
                }}
              >
                <th style={{ textAlign: 'left', padding: '12px 8px' }}>
                  {intl.formatMessage({
                    id: 'pages.roles.resourceTypeHeader',
                    defaultMessage: 'Resource type',
                  })}
                </th>
                {ACTION_TYPES.map(
                  (action: { value: string; label: string }) => (
                    <th
                      key={action.value}
                      style={{ textAlign: 'center', padding: '12px 8px' }}
                    >
                      {action.label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {RESOURCE_TYPES.map(
                (resource: { value: string; label: string }) => (
                  <tr
                    key={resource.value}
                    style={{
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <td style={{ padding: '12px 8px' }}>
                      {resource.label}
                      <div
                        style={{
                          fontSize: '12px',
                          color: token.colorTextSecondary,
                        }}
                      >
                        {resource.value}
                      </div>
                    </td>
                    {ACTION_TYPES.map(
                      (action: { value: string; label: string }) => (
                        <td
                          key={action.value}
                          style={{ textAlign: 'center', padding: '12px 8px' }}
                        >
                          <Checkbox
                            checked={hasPermission(
                              resource.value,
                              action.value,
                            )}
                            disabled={
                              togglingPermissionRef.current ===
                              `${resource.value}:${action.value}`
                            }
                            onChange={(e) =>
                              handleTogglePermission(
                                resource.value,
                                action.value,
                                e.target.checked,
                              )
                            }
                          />
                        </td>
                      ),
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Modal>
    </PageContainer>
  );
};

export default RoleListPage;
