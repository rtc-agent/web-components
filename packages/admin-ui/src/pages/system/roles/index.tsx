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
  Button,
  Checkbox,
  Modal,
  message,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Tooltip,
  theme,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { getActionTypes, getResourceTypes } from '@/constants/permissions';
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

/**
 * Admin Role Management Page
 */
const RoleListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
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
          return { success: false };
        }
      },

      // Delete admin roles
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
  const columns: ProColumns<RoleTableItem>[] = [
    {
      title: intl.formatMessage({
        id: 'pages.roles.searchPlaceholder',
        defaultMessage: '输入管理员角色名称、显示名称或描述',
      }),
      dataIndex: 'keyword',
      valueType: 'text',
      hideInTable: true,
      fieldProps: {
        placeholder: intl.formatMessage({
          id: 'pages.roles.searchPlaceholder',
          defaultMessage: '输入管理员角色名称、显示名称或描述',
        }),
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.roles.column.name',
        defaultMessage: '管理员角色名称',
      }),
      dataIndex: 'name',
      valueType: 'text',
      search: false,
    },
    {
      title: intl.formatMessage({
        id: 'pages.roles.column.displayName',
        defaultMessage: '显示名称',
      }),
      dataIndex: 'display_name',
      valueType: 'text',
      search: false,
    },
    {
      title: intl.formatMessage({
        id: 'pages.roles.column.description',
        defaultMessage: '描述',
      }),
      dataIndex: 'description',
      valueType: 'text',
      search: false,
      ellipsis: true,
    },
    {
      title: intl.formatMessage({
        id: 'pages.roles.column.isSystem',
        defaultMessage: '系统管理员角色',
      }),
      dataIndex: 'is_system',
      valueType: 'select',
      search: false,
      valueEnum: {
        true: {
          text: intl.formatMessage({
            id: 'pages.roles.yes',
            defaultMessage: '是',
          }),
          status: 'Default',
        },
        false: {
          text: intl.formatMessage({
            id: 'pages.roles.no',
            defaultMessage: '否',
          }),
          status: 'Processing',
        },
      },
      render: (_, record) => (
        <Tag color={record.is_system ? 'default' : 'processing'}>
          {record.is_system
            ? intl.formatMessage({
                id: 'pages.roles.systemRole',
                defaultMessage: '系统管理员角色',
              })
            : intl.formatMessage({
                id: 'pages.roles.customRole',
                defaultMessage: '自定义管理员角色',
              })}
        </Tag>
      ),
    },
    {
      title: intl.formatMessage({
        id: 'pages.roles.column.status',
        defaultMessage: '状态',
      }),
      dataIndex: 'is_enabled',
      valueType: 'select',
      search: false,
      valueEnum: {
        true: {
          text: intl.formatMessage({
            id: 'pages.roles.statusEnabled',
            defaultMessage: '启用',
          }),
          status: 'Success',
        },
        false: {
          text: intl.formatMessage({
            id: 'pages.roles.statusDisabled',
            defaultMessage: '禁用',
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
                    defaultMessage: '启用',
                  })
                : intl.formatMessage({
                    id: 'pages.roles.statusDisabled',
                    defaultMessage: '禁用',
                  })}
            </Tag>
          }
        >
          <Tooltip
            title={
              record.is_system
                ? intl.formatMessage({
                    id: 'pages.roles.systemRoleCannotDisable',
                    defaultMessage: '系统内置管理员角色不可禁用',
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
                          defaultMessage: '已启用',
                        })
                      : intl.formatMessage({
                          id: 'pages.roles.statusDisabled',
                          defaultMessage: '已禁用',
                        }),
                  );
                  actionRef.current?.reload();
                } catch (error: unknown) {
                  message.error(
                    getFriendlyErrorMessage(
                      error,
                      intl.formatMessage({
                        id: 'pages.roles.operationFailed',
                        defaultMessage: '操作失败',
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
        defaultMessage: '创建时间',
      }),
      dataIndex: 'created_at',
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: intl.formatMessage({
        id: 'pages.roles.column.actions',
        defaultMessage: '操作',
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
                defaultMessage: '权限',
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
                defaultMessage: '编辑',
              })}
            </Button>
          </Access>
          <Access accessible={access.canAdminRoleEdit} fallback={null}>
            {record.is_system ? (
              <Tooltip
                title={intl.formatMessage({
                  id: 'pages.roles.systemRoleCannotDelete',
                  defaultMessage: '系统内置管理员角色不可删除',
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
                    defaultMessage: '删除',
                  })}
                </Button>
              </Tooltip>
            ) : (
              <Popconfirm
                title={intl.formatMessage({
                  id: 'pages.roles.confirmDelete',
                  defaultMessage: '确定要删除这个管理员角色吗？',
                })}
                description={
                  <>
                    <p>
                      {intl.formatMessage({
                        id: 'pages.roles.confirmDeleteDesc',
                        defaultMessage: '删除后无法恢复',
                      })}
                    </p>
                    <p style={{ color: token.colorWarning, fontWeight: 500 }}>
                      {intl.formatMessage({
                        id: 'pages.roles.confirmDeleteRoleWarning',
                        defaultMessage: '该角色下的所有管理员将失去对应权限',
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
                        defaultMessage: '删除成功',
                      }),
                    );
                    actionRef.current?.reload();
                  } catch (error: unknown) {
                    message.error(
                      getFriendlyErrorMessage(
                        error,
                        intl.formatMessage({
                          id: 'pages.roles.deleteFailed',
                          defaultMessage: '删除失败',
                        }),
                      ),
                    );
                  }
                }}
                okText={intl.formatMessage({
                  id: 'pages.roles.confirm',
                  defaultMessage: '确定',
                })}
                cancelText={intl.formatMessage({
                  id: 'pages.roles.cancel',
                  defaultMessage: '取消',
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
                    defaultMessage: '删除',
                  })}
                </Button>
              </Popconfirm>
            )}
          </Access>
        </Space>
      ),
    },
  ];

  /** Submit form */
  const handleSubmit = async (values: RoleFormValues) => {
    try {
      if (isEdit && currentRow) {
        await updateRole(currentRow.id, values);
        message.success(
          intl.formatMessage({
            id: 'pages.roles.updateSuccess',
            defaultMessage: '更新成功',
          }),
        );
      } else {
        await createRole(values);
        message.success(
          intl.formatMessage({
            id: 'pages.roles.createSuccess',
            defaultMessage: '创建成功',
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
          isEdit
            ? intl.formatMessage({
                id: 'pages.roles.updateFailed',
                defaultMessage: '更新失败',
              })
            : intl.formatMessage({
                id: 'pages.roles.createFailed',
                defaultMessage: '创建失败',
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
          intl.formatMessage({
            id: 'pages.roles.loadPermissionFailed',
            defaultMessage: '加载权限失败',
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
            defaultMessage: '权限已添加',
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
            defaultMessage: '权限已移除',
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
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.roles.operationFailed',
            defaultMessage: '操作失败',
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
          defaultMessage: '管理员角色列表',
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
                defaultMessage: '新建管理员角色',
              })}
            </Button>
          </Access>,
        ]}
        request={async (params) => {
          // Read keyword from searchParams (URL is single source of truth)
          const keyword = searchParams.get('keyword') || '';
          try {
            const response = await getRoleList({
              page: params.current,
              page_size: params.pageSize,
              keyword,
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
                intl.formatMessage({
                  id: 'pages.roles.loadFailed',
                  defaultMessage: '加载管理员角色列表失败',
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
                defaultMessage: '编辑管理员角色',
              })
            : intl.formatMessage({
                id: 'pages.roles.createRole',
                defaultMessage: '新建管理员角色',
              })
        }
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
          label={intl.formatMessage({
            id: 'pages.roles.nameLabel',
            defaultMessage: '管理员角色名称',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.roles.namePlaceholder',
            defaultMessage: '请输入管理员角色名称（英文，如 admin）',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.roles.nameRequired',
                defaultMessage: '请输入管理员角色名称',
              }),
            },
            {
              min: 3,
              message: intl.formatMessage({
                id: 'pages.roles.nameMinLength',
                defaultMessage: '管理员角色名称至少需要 3 个字符',
              }),
            },
            {
              pattern: /^[a-z][a-z0-9_]*$/,
              message: intl.formatMessage({
                id: 'pages.roles.namePattern',
                defaultMessage:
                  '管理员角色名称只能包含小写字母、数字和下划线，且以字母开头',
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
                          defaultMessage: '管理员角色名称已存在',
                        }),
                      ),
                    );
                  }
                } catch (_error) {
                  // Ignore errors, let backend validate
                }
                return Promise.resolve();
              },
            },
          ]}
          disabled={isEdit}
          tooltip={intl.formatMessage({
            id: 'pages.roles.nameTooltip',
            defaultMessage: '管理员角色名称创建后不可修改',
          })}
        />
        <ProFormText
          name="display_name"
          label={intl.formatMessage({
            id: 'pages.roles.displayNameLabel',
            defaultMessage: '显示名称',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.roles.displayNamePlaceholder',
            defaultMessage: '请输入显示名称（如：管理员）',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.roles.displayNameRequired',
                defaultMessage: '请输入显示名称',
              }),
            },
          ]}
        />
        <ProFormTextArea
          name="description"
          label={intl.formatMessage({
            id: 'pages.roles.descriptionLabel',
            defaultMessage: '描述',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.roles.descriptionPlaceholder',
            defaultMessage: '请输入管理员角色描述',
          })}
          fieldProps={{ rows: 4 }}
        />
      </ModalForm>

      {/* Permission management dialog */}
      <Modal
        title={intl.formatMessage(
          {
            id: 'pages.roles.permissionManagement',
            defaultMessage: '权限管理 - {name}',
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
              defaultMessage: '关闭',
            })}
          </Button>,
        ]}
        width={800}
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
                    defaultMessage: '资源类型',
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
