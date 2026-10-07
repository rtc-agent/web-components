import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProTable,
} from '@ant-design/pro-components';
import { Access, useAccess, useIntl } from '@umijs/max';
import { Button, message, Popconfirm, Space, Tag } from 'antd';
import React, { useRef } from 'react';
import { getActionTypes, getResourceTypes } from '@/constants/permissions';
import { useRoleOptions } from '@/hooks/useRoleOptions';
import {
  createPermission,
  deletePermission,
  getPermissionList,
} from '@/services/permission';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import type { PermissionFormValues, PermissionTableItem } from './data.d';

/**
 * 权限管理页面
 */
const PermissionListPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const [modalVisible, setModalVisible] = React.useState(false);
  const { roleMap, roleOptions } = useRoleOptions();

  const RESOURCE_TYPES = getResourceTypes(intl);
  const ACTION_TYPES = getActionTypes(intl);

  /** 表格列定义 */
  const columns: ProColumns<PermissionTableItem>[] = [
    {
      title: intl.formatMessage({
        id: 'pages.permissions.column.role',
        defaultMessage: '管理员角色',
      }),
      dataIndex: 'role_id',
      valueType: 'text',
      search: false,
      render: (_, record) => (
        <Tag color="blue">{roleMap.get(record.role_id) || record.role_id}</Tag>
      ),
    },
    {
      title: intl.formatMessage({
        id: 'pages.permissions.column.resource',
        defaultMessage: '资源',
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
        defaultMessage: '操作',
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
        defaultMessage: '操作',
      }),
      dataIndex: 'option',
      valueType: 'option',
      render: (_, record) => (
        <Space>
          <Access accessible={access.canPermissionEdit} fallback={null}>
            <Popconfirm
              title={intl.formatMessage({
                id: 'pages.permissions.confirmDelete',
                defaultMessage: '确定要删除这个权限策略吗？',
              })}
              description={intl.formatMessage({
                id: 'pages.permissions.confirmDeleteDesc',
                defaultMessage: '删除后该管理员角色将失去对应权限',
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
                      defaultMessage: '删除成功',
                    }),
                  );
                  actionRef.current?.reload();
                } catch (error: unknown) {
                  message.error(
                    getFriendlyErrorMessage(
                      error,
                      intl.formatMessage({
                        id: 'pages.permissions.deleteFailed',
                        defaultMessage: '删除失败',
                      }),
                    ),
                  );
                }
              }}
              okText={intl.formatMessage({
                id: 'pages.permissions.confirm',
                defaultMessage: '确定',
              })}
              cancelText={intl.formatMessage({
                id: 'pages.permissions.cancel',
                defaultMessage: '取消',
              })}
            >
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                {intl.formatMessage({
                  id: 'pages.permissions.delete',
                  defaultMessage: '删除',
                })}
              </Button>
            </Popconfirm>
          </Access>
        </Space>
      ),
    },
  ];

  /** 提交表单 */
  const handleSubmit = async (values: PermissionFormValues) => {
    try {
      await createPermission(values);
      message.success(
        intl.formatMessage({
          id: 'pages.permissions.createSuccess',
          defaultMessage: '创建成功',
        }),
      );
      actionRef.current?.reload();
      setModalVisible(false);
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.permissions.createFailed',
            defaultMessage: '创建失败',
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
          defaultMessage: '权限策略列表',
        })}
        actionRef={actionRef}
        rowKey={(record) =>
          `${record.role_id}-${record.resource}-${record.action}`
        }
        search={{
          labelWidth: 'auto',
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
                defaultMessage: '新建权限策略',
              })}
            </Button>
          </Access>,
        ]}
        request={async (params) => {
          try {
            const response = await getPermissionList({
              page: params.current,
              page_size: params.pageSize,
              role_id: params.role_id,
              resource: params.resource,
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
                intl.formatMessage({
                  id: 'pages.permissions.loadFailed',
                  defaultMessage: '加载权限列表失败',
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
          defaultMessage: '新建权限策略',
        })}
        open={modalVisible}
        onOpenChange={setModalVisible}
        modalProps={{
          destroyOnClose: true,
        }}
        onFinish={handleSubmit}
      >
        <ProFormSelect
          name="role_id"
          label={intl.formatMessage({
            id: 'pages.permissions.roleLabel',
            defaultMessage: '管理员角色',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.permissions.rolePlaceholder',
            defaultMessage: '请选择管理员角色',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.permissions.roleRequired',
                defaultMessage: '请选择管理员角色',
              }),
            },
          ]}
          options={roleOptions}
        />
        <ProFormSelect
          name="resource"
          label={intl.formatMessage({
            id: 'pages.permissions.resourceLabel',
            defaultMessage: '资源',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.permissions.resourcePlaceholder',
            defaultMessage: '请选择资源类型',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.permissions.resourceRequired',
                defaultMessage: '请选择资源类型',
              }),
            },
          ]}
          options={RESOURCE_TYPES}
        />
        <ProFormSelect
          name="action"
          label={intl.formatMessage({
            id: 'pages.permissions.actionLabel',
            defaultMessage: '操作',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.permissions.actionPlaceholder',
            defaultMessage: '请选择操作类型',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.permissions.actionRequired',
                defaultMessage: '请选择操作类型',
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
