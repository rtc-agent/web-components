import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Grid, Popconfirm, Space, Tag } from 'antd';
import React, { useEffect, useMemo, useRef } from 'react';
import { getActionTypes, getResourceTypes } from '@/constants/permissions';
import { usePermissionRefresh } from '@/hooks/usePermissionRefresh';
import { useRoleOptions } from '@/hooks/useRoleOptions';
import {
  createPermission,
  deletePermission,
  getPermissionList,
} from '@/services/permission';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import type { PermissionFormValues, PermissionTableItem } from './data';
import type { PermissionPageAPI } from './page-api';

/**
 * Permission Management Page
 */
const PermissionListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();
  const [modalVisible, setModalVisible] = React.useState(false);
  const { roleMap, roleOptions } = useRoleOptions();
  const breakpoints = Grid.useBreakpoint();
  const isMobile = !breakpoints.sm;
  const modalWidth = isMobile ? '95vw' : 520;
  const { refreshPermissions } = usePermissionRefresh();

  const RESOURCE_TYPES = getResourceTypes(intl);
  const ACTION_TYPES = getActionTypes(intl);

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: PermissionPageAPI = {
      // Read table data
      list: async (params = {}) => {
        const { current = 1, pageSize = 20, role_id, resource } = params;

        // Sync URL (no page refresh)
        const newSearchParams = new URLSearchParams();
        if (role_id) {
          newSearchParams.set('role_id', role_id);
        }
        if (resource) {
          newSearchParams.set('resource', resource);
        }
        setSearchParams(newSearchParams, { replace: true });

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
          console.error('[Permission Page API] list failed:', error);
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
          return { success: true };
        } catch (error) {
          console.error('[Permission Page API] create failed:', error);
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
          const results = await Promise.all(
            items.map((item) => deletePermission(item)),
          );
          const failures = results.filter((r) => !r.success);
          actionRef.current?.reload();
          return {
            success: failures.length === 0,
            deletedCount: items.length - failures.length,
          };
        } catch (error) {
          console.error('[Permission Page API] remove failed:', error);
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
    };

    // Register to global
    window.__pages__ = window.__pages__ || {};
    window.__pages__.permission = pageAPI;

    // Dispatch ready event (notify navigation.goto that page is loaded)
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'permission' } }),
    );

    console.log('[PermissionListPage] Page API registered');

    // Cleanup
    return () => {
      delete window.__pages__?.permission;
      console.log('[PermissionListPage] Page API unregistered');
    };
  }, []);

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    actionRef.current?.reload();
  }, [searchParams]);

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
          (acc, cur) => {
            acc[cur.value] = { text: cur.label };
            return acc;
          },
          {} as Record<string, { text: string }>,
        ),
        render: (_, record) => {
          const resource = RESOURCE_TYPES.find(
            (r) => r.value === record.resource,
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
          (acc, cur) => {
            acc[cur.value] = { text: cur.label };
            return acc;
          },
          {} as Record<string, { text: string }>,
        ),
        render: (_, record) => {
          const action = ACTION_TYPES.find((a) => a.value === record.action);
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
      setModalVisible(false);
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
        search={{
          labelWidth: 'auto',
        }}
        form={{
          initialValues: {
            resource: searchParams.get('resource') || undefined,
          },
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
                setModalVisible(true);
              }}
            >
              {intl.formatMessage({
                id: 'pages.permissions.createPermission',
                defaultMessage: 'Create permission policy',
              })}
            </Button>
          </Access>,
        ]}
        request={async (params) => {
          try {
            // Read all query params from searchParams (URL is single source of truth)
            const roleId = searchParams.get('role_id') || undefined;
            const resource = searchParams.get('resource') || undefined;
            const response = await getPermissionList({
              page: params.current,
              page_size: params.pageSize,
              role_id: roleId,
              resource,
            });
            return {
              data: response.items.map((item) => ({
                ...item,
                key: `${item.role_id}-${item.resource}-${item.action}`,
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
                  id: 'pages.permissions.loadFailed',
                  defaultMessage: 'Failed to load permissions',
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

      <ModalForm<PermissionFormValues>
        title={intl.formatMessage({
          id: 'pages.permissions.createPermission',
          defaultMessage: 'Create permission policy',
        })}
        open={modalVisible}
        onOpenChange={setModalVisible}
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
