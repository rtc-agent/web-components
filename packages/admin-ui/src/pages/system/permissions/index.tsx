import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess, useIntl } from '@umijs/max';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Popconfirm, Space, Tag } from 'antd';
import React, { useCallback, useMemo, useRef } from 'react';
import TableEmptyState from '@/components/TableEmptyState';
import { getActionTypes, getResourceTypes } from '@/constants/permissions';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useModalState } from '@/hooks/useModalState';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { usePermissionRefresh } from '@/hooks/usePermissionRefresh';
import { useRoleOptions } from '@/hooks/useRoleOptions';
import { useTableSearchParams } from '@/hooks/useTableSearchParams';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { queryKeys } from '@/utils/queryKeys';
import { createTableRequest } from '@/utils/tableUtils';
import type { PermissionFormValues, PermissionTableItem } from './data';
import type { PermissionPageAPI } from './page-api';
import {
  createPermission,
  deletePermission,
  getPermissionList,
} from './service';

/**
 * Permission Management Page
 */
const PermissionListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const tableParams = useTableSearchParams<{
    role_id?: string;
    resource?: string;
  }>();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const modal = useModalState();
  const { roleMap, roleOptions } = useRoleOptions();
  const isMobile = useIsMobile();
  const modalWidth = isMobile ? '95vw' : 520;
  const { refreshPermissions } = usePermissionRefresh();

  const RESOURCE_TYPES = getResourceTypes(intl);
  const ACTION_TYPES = getActionTypes(intl);

  // === Register Page API ===
  usePageAPIRegistration(
    'permission',
    useCallback(
      (): PermissionPageAPI => ({
        // Read table data
        list: async (params = {}) => {
          const { current = 1, pageSize = 20, role_id, resource } = params;

          // Sync URL (no page refresh)
          tableParams.set({ role_id, resource });

          try {
            const response = await getPermissionList({
              page: current,
              page_size: pageSize,
              role_id,
              resource,
            });

            return {
              success: true,
              data: response.items,
              total: response.total,
            };
          } catch (error) {
            console.error('[Permission Page API] list failed:', {
              params,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.permissions.loadFailed',
                  defaultMessage: 'Failed to load permissions',
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

        // Create permission policy
        create: async (data) => {
          try {
            await createPermission(data);
            actionRef.current?.reload();
            // Invalidate role list cache so other pages see the updated permissions
            queryClient.invalidateQueries({ queryKey: queryKeys.roleList.all });
            return { success: true };
          } catch (error) {
            console.error('[Permission Page API] create failed:', {
              data,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.permissions.createFailed',
                  defaultMessage: 'Creation failed',
                }),
              ),
            );
            return { success: false };
          }
        },

        // Remove permission policies (parallel execution)
        remove: async (items) => {
          try {
            await Promise.all(
              items.map((item) => deletePermission(item)),
            );
            actionRef.current?.reload();
            // Invalidate role list cache so other pages see the updated permissions
            queryClient.invalidateQueries({ queryKey: queryKeys.roleList.all });
            return {
              success: true,
              deletedCount: items.length,
            };
          } catch (error) {
            console.error('[Permission Page API] remove failed:', {
              itemCount: items.length,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.permissions.deleteFailed',
                  defaultMessage: 'Deletion failed',
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

  /** Table column definitions */
  const columns: ProColumns<PermissionTableItem>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.permissions.column.role',
          defaultMessage: 'Admin role',
        }),
        dataIndex: 'role_id',
        valueType: 'text',
        search: false,
        render: (_, record) => (
          <Tag color="blue">
            {roleMap.get(record.role_id) || record.role_id}
          </Tag>
        ),
      },
      {
        title: intl.formatMessage({
          id: 'pages.permissions.column.resource',
          defaultMessage: 'Resource',
        }),
        dataIndex: 'resource',
        valueType: 'select',
        valueEnum: RESOURCE_TYPES.reduce(
          (acc: Record<string, { text: string }>, cur: { value: string; label: string }) => {
            acc[cur.value] = { text: cur.label };
            return acc;
          },
          {} as Record<string, { text: string }>,
        ),
        render: (_, record) => {
          const resource = RESOURCE_TYPES.find(
            (r: { value: string; label: string }) => r.value === record.resource,
          );
          return <Tag color="green">{resource?.label || record.resource}</Tag>;
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.permissions.column.action',
          defaultMessage: 'Action',
        }),
        dataIndex: 'action',
        valueType: 'select',
        valueEnum: ACTION_TYPES.reduce(
          (acc: Record<string, { text: string }>, cur: { value: string; label: string }) => {
            acc[cur.value] = { text: cur.label };
            return acc;
          },
          {} as Record<string, { text: string }>,
        ),
        render: (_, record) => {
          const action = ACTION_TYPES.find((a: { value: string; label: string }) => a.value === record.action);
          return <Tag color="orange">{action?.label || record.action}</Tag>;
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.permissions.column.actions',
          defaultMessage: 'Action',
        }),
        dataIndex: 'option',
        valueType: 'option',
        render: (_, record) => (
          <Space>
            <Access accessible={access.canPermissionEdit} fallback={null}>
              <Popconfirm
                title={intl.formatMessage({
                  id: 'pages.permissions.confirmDelete',
                  defaultMessage:
                    'Are you sure you want to delete this permission policy?',
                })}
                description={intl.formatMessage({
                  id: 'pages.permissions.confirmDeleteDesc',
                  defaultMessage:
                    'The admin role will lose corresponding permissions after deletion',
                })}
                onConfirm={async () => {
                  try {
                    await deletePermission({
                      role_id: record.role_id,
                      resource: record.resource,
                      action: record.action,
                    });
                    message.success(
                      intl.formatMessage({
                        id: 'pages.permissions.deleteSuccess',
                        defaultMessage: 'Deleted successfully',
                      }),
                    );
                    actionRef.current?.reload();
                    // Invalidate role list cache so other pages see the updated permissions
                    queryClient.invalidateQueries({
                      queryKey: queryKeys.roleList.all,
                    });
                    // Refresh current user permissions (permission removal may affect access)
                    await refreshPermissions();
                  } catch (error: unknown) {
                    message.error(
                      getFriendlyErrorMessage(
                        error,
                        intl,
                        intl.formatMessage({
                          id: 'pages.permissions.deleteFailed',
                          defaultMessage: 'Deletion failed',
                        }),
                      ),
                    );
                  }
                }}
                okText={intl.formatMessage({
                  id: 'pages.permissions.confirm',
                  defaultMessage: 'Confirm',
                })}
                cancelText={intl.formatMessage({
                  id: 'pages.permissions.cancel',
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
                    id: 'pages.permissions.delete',
                    defaultMessage: 'Delete',
                  })}
                </Button>
              </Popconfirm>
            </Access>
          </Space>
        ),
      },
    ],
    [intl, access, roleMap, RESOURCE_TYPES, ACTION_TYPES],
  );

  /** Submit form */
  const handleSubmit = async (values: PermissionFormValues) => {
    try {
      await createPermission(values);
      message.success(
        intl.formatMessage({
          id: 'pages.permissions.createSuccess',
          defaultMessage: 'Created successfully',
        }),
      );
      actionRef.current?.reload();
      modal.close();
      // Invalidate role list cache so other pages see the updated permissions
      queryClient.invalidateQueries({ queryKey: queryKeys.roleList.all });
      // Refresh current user permissions (new permission may grant additional access)
      await refreshPermissions();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.permissions.createFailed',
            defaultMessage: 'Creation failed',
          }),
        ),
      );
      return false;
    }
  };

  return (
    <PageContainer>
      <ProTable<PermissionTableItem>
        headerTitle={intl.formatMessage({
          id: 'pages.permissions.headerTitle',
          defaultMessage: 'Permission policy list',
        })}
        actionRef={actionRef}
        rowKey={(record) =>
          `${record.role_id}-${record.resource}-${record.action}`
        }
        locale={{ emptyText: <TableEmptyState /> }}
        search={{
          labelWidth: 'auto',
        }}
        form={{
          initialValues: tableParams.get(),
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
                modal.open();
              }}
            >
              {intl.formatMessage({
                id: 'pages.permissions.createPermission',
                defaultMessage: 'Create permission policy',
              })}
            </Button>
          </Access>,
        ]}
        request={createTableRequest(
          async (params) => {
            // Read all query params from URL (single source of truth)
            const urlParams = tableParams.get();
            const roleId = urlParams.role_id || undefined;
            const resource = urlParams.resource || undefined;
            const response = await getPermissionList({
              page: params.current,
              page_size: params.pageSize,
              role_id: roleId,
              resource,
            });
            // Return { items, total } format for createTableRequest
            return {
              items: response.items.map((item) => ({
                ...item,
                key: `${item.role_id}-${item.resource}-${item.action}`,
              })),
              total: response.total,
            };
          },
          message,
          intl,
          {
            id: 'pages.permissions.loadFailed',
            defaultMessage: 'Failed to load permissions',
          },
        )}
        columns={columns}
      />

      <ModalForm<PermissionFormValues>
        title={intl.formatMessage({
          id: 'pages.permissions.createPermission',
          defaultMessage: 'Create permission policy',
        })}
        open={modal.state.open}
        onOpenChange={(visible) => {
          if (visible) {
            modal.open();
          } else {
            modal.close();
          }
        }}
        width={modalWidth}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleSubmit}
      >
        <ProFormSelect
          name="role_id"
          label={intl.formatMessage({
            id: 'pages.permissions.roleLabel',
            defaultMessage: 'Admin role',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.permissions.rolePlaceholder',
            defaultMessage: 'Please select admin role',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.permissions.roleRequired',
                defaultMessage: 'Please select admin role',
              }),
            },
          ]}
          options={roleOptions}
        />
        <ProFormSelect
          name="resource"
          label={intl.formatMessage({
            id: 'pages.permissions.resourceLabel',
            defaultMessage: 'Resource',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.permissions.resourcePlaceholder',
            defaultMessage: 'Please select resource type',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.permissions.resourceRequired',
                defaultMessage: 'Please select resource type',
              }),
            },
          ]}
          options={RESOURCE_TYPES}
        />
        <ProFormSelect
          name="action"
          label={intl.formatMessage({
            id: 'pages.permissions.actionLabel',
            defaultMessage: 'Action',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.permissions.actionPlaceholder',
            defaultMessage: 'Please select operation type',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.permissions.actionRequired',
                defaultMessage: 'Please select operation type',
              }),
            },
          ]}
          options={ACTION_TYPES}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default PermissionListPage;
