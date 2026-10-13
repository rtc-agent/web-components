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
import { Access, useAccess, useIntl, useSearchParams } from '@umijs/max';
import {
  App,
  Button,
  Checkbox,
  Grid,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Tooltip,
  theme,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getActionTypes, getResourceTypes } from '@/constants/permissions';
import { usePermissionRefresh } from '@/hooks/usePermissionRefresh';
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
import { parseTableSort } from '../../rtc-users/shared/tableUtils';
import type { RoleFormValues, RoleTableItem } from './data.d';
import type { RolePageAPI } from './page-api';

/**
 * Admin Role Management Page
 */
const RoleListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();
  const [currentRow, setCurrentRow] = useState<RoleTableItem>();
  const [modalVisible, setModalVisible] = useState(false);
  const { token } = theme.useToken();
  const [isEdit, setIsEdit] = useState(false);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<PermissionPolicy[]>(
    [],
  );
  /** Permission toggle key (resource:action), prevents race condition on rapid clicks */
  const [togglingPermission, setTogglingPermission] = useState<string | null>(
    null,
  );
  const breakpoints = Grid.useBreakpoint();
  const isMobile = !breakpoints.sm;
  const modalWidth = isMobile ? '95vw' : 520;
  const permissionModalWidth = isMobile ? '95vw' : 800;
  const { refreshPermissions } = usePermissionRefresh();

  const RESOURCE_TYPES = getResourceTypes(intl);
  const ACTION_TYPES = getActionTypes(intl);

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: RolePageAPI = {
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
          message.error(
            getFriendlyErrorMessage(
              error,
              intl,
              intl.formatMessage({
                id: 'pages.roles.loadFailed',
                defaultMessage: 'Failed to load admin roles',
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

      // Create admin role
      create: async (data) => {
        try {
          const result = await createRole(data);
          actionRef.current?.reload();
          return { success: true, id: result.id };
        } catch (error) {
          console.error('[Role Page API] create failed:', error);
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
        try {
          const { id, ...updateData } = data;
          await updateRole(id, updateData);
          actionRef.current?.reload();
          return { success: true };
        } catch (error) {
          console.error('[Role Page API] update failed:', error);
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
          const results = await Promise.all(ids.map((id) => deleteRole(id)));
          const failures = results.filter((r) => !r.success);
          actionRef.current?.reload();
          return {
            success: failures.length === 0,
            deletedCount: ids.length - failures.length,
          };
        } catch (error) {
          console.error('[Role Page API] remove failed:', error);
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
    };

    // Register to global
    window.__pages__ = window.__pages__ || {};
    window.__pages__.role = pageAPI;

    // Dispatch ready event (notify navigation.goto that page is loaded)
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'role' } }),
    );

    console.log('[RoleListPage] Page API registered');

    // Cleanup
    return () => {
      delete window.__pages__?.role;
      console.log('[RoleListPage] Page API unregistered');
    };
  }, []);

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    actionRef.current?.reload();
  }, [searchParams]);

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
          <Space>
            <Access accessible={access.canAdminRoleEdit} fallback={null}>
              <Button
                type="link"
                size="small"
                icon={<SafetyOutlined />}
                onClick={() => handleManagePermissions(record)}
              >
                {intl.formatMessage({
                  id: 'pages.roles.permission',
                  defaultMessage: 'Permission',
                })}
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
                {intl.formatMessage({
                  id: 'pages.roles.edit',
                  defaultMessage: 'Edit',
                })}
              </Button>
            </Access>
            <Access accessible={access.canAdminRoleEdit} fallback={null}>
              {record.is_system ? (
                <Tooltip
                  title={intl.formatMessage({
                    id: 'pages.roles.systemRoleCannotDelete',
                    defaultMessage:
                      'System built-in admin role cannot be deleted',
                  })}
                >
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled
                  >
                    {intl.formatMessage({
                      id: 'pages.roles.delete',
                      defaultMessage: 'Delete',
                    })}
                  </Button>
                </Tooltip>
              ) : (
                <Popconfirm
                  title={intl.formatMessage({
                    id: 'pages.roles.confirmDelete',
                    defaultMessage:
                      'Are you sure you want to delete this admin role?',
                  })}
                  description={
                    <>
                      <p>
                        {intl.formatMessage({
                          id: 'pages.roles.confirmDeleteDesc',
                          defaultMessage: 'Cannot be recovered after deletion',
                        })}
                      </p>
                      <p style={{ color: token.colorWarning, fontWeight: 500 }}>
                        {intl.formatMessage({
                          id: 'pages.roles.confirmDeleteRoleWarning',
                          defaultMessage:
                            'All administrators under this role will lose corresponding permissions',
                        })}
                      </p>
                    </>
                  }
                  onConfirm={async () => {
                    try {
                      await deleteRole(record.id);
                      message.success(
                        intl.formatMessage({
                          id: 'pages.roles.deleteSuccess',
                          defaultMessage: 'Deleted successfully',
                        }),
                      );
                      actionRef.current?.reload();
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
                  }}
                  okText={intl.formatMessage({
                    id: 'pages.roles.confirm',
                    defaultMessage: 'Confirm',
                  })}
                  cancelText={intl.formatMessage({
                    id: 'pages.roles.cancel',
                    defaultMessage: 'Cancel',
                  })}
                >
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                  >
                    {intl.formatMessage({
                      id: 'pages.roles.delete',
                      defaultMessage: 'Delete',
                    })}
                  </Button>
                </Popconfirm>
              )}
            </Access>
          </Space>
        ),
      },
    ],
    [intl, access, token],
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
      setModalVisible(false);
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

  /** Open permission management modal */
  const handleManagePermissions = async (role: RoleTableItem) => {
    setCurrentRow(role);
    setPermissionModalVisible(true);

    try {
      // Load permissions for this role
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
    if (togglingPermission === permKey) return;
    setTogglingPermission(permKey);

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
      setTogglingPermission(null);
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
            keyword: searchParams.get('keyword') || '',
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
                setModalVisible(true);
              }}
            >
              {intl.formatMessage({
                id: 'pages.roles.createRole',
                defaultMessage: 'Create admin role',
              })}
            </Button>
          </Access>,
        ]}
        request={async (params, sort) => {
          // Read keyword from searchParams (URL is single source of truth)
          const keyword = searchParams.get('keyword') || '';
          try {
            const sortParams = parseTableSort(sort || {});
            const response = await getRoleList({
              page: params.current,
              page_size: params.pageSize,
              keyword,
              ...sortParams,
            });
            return {
              data: response.items.map((item) => ({
                ...item,
                key: item.id,
              })),
              total: response.total,
              success: true,
            };
          } catch (error: unknown) {
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.roles.loadFailed',
                  defaultMessage: 'Failed to load admin roles',
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
        open={modalVisible}
        onOpenChange={setModalVisible}
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
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.roles.nameRequired',
                defaultMessage: 'Please enter admin role name',
              }),
            },
            {
              min: 3,
              message: intl.formatMessage({
                id: 'pages.roles.nameMinLength',
                defaultMessage: 'Admin role name must be at least 3 characters',
              }),
            },
            {
              pattern: /^[a-z][a-z0-9_]*$/,
              message: intl.formatMessage({
                id: 'pages.roles.namePattern',
                defaultMessage:
                  'Admin role name can only contain lowercase letters, numbers, and underscores, and must start with a letter',
              }),
            },
            {
              validator: async (_rule, value) => {
                if (!value || isEdit) return Promise.resolve();
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
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.roles.displayNameRequired',
                defaultMessage: 'Please enter display name',
              }),
            },
            {
              max: 100,
              message: intl.formatMessage({
                id: 'pages.roles.displayNameMaxLength',
                defaultMessage: 'Display name cannot exceed 100 characters',
              }),
            },
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
            {
              whitespace: true,
              message: intl.formatMessage({
                id: 'pages.roles.descriptionWhitespace',
                defaultMessage: 'Description cannot be empty or only spaces',
              }),
            },
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
        open={permissionModalVisible}
        onCancel={() => {
          setPermissionModalVisible(false);
          setCurrentRow(undefined);
          setRolePermissions([]);
        }}
        footer={[
          <Button
            key="close"
            onClick={() => {
              setPermissionModalVisible(false);
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
                {ACTION_TYPES.map((action) => (
                  <th
                    key={action.value}
                    style={{ textAlign: 'center', padding: '12px 8px' }}
                  >
                    {action.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESOURCE_TYPES.map((resource) => (
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
                  {ACTION_TYPES.map((action) => (
                    <td
                      key={action.value}
                      style={{ textAlign: 'center', padding: '12px 8px' }}
                    >
                      <Checkbox
                        checked={hasPermission(resource.value, action.value)}
                        disabled={
                          togglingPermission ===
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
