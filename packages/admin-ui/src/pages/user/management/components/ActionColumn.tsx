import { DeleteOutlined, EditOutlined, TeamOutlined } from '@ant-design/icons';
import { Access } from '@umijs/max';
import { Button, Popconfirm, Space } from 'antd';
import React from 'react';
import type { UserInfo } from '../service';

/**
 * Intl descriptor shape accepted by ActionColumn.
 * Keeps the component decoupled from the exact intl implementation.
 */
interface IntlShape {
  formatMessage: (descriptor: {
    id: string;
    defaultMessage?: string;
  }) => string;
}

interface AccessShape {
  canAdminUserEdit: boolean;
  canAdminUserRoleEdit: boolean;
  canAdminUserDelete: boolean;
}

export interface ActionColumnProps {
  record: UserInfo;
  intl: IntlShape;
  access: AccessShape;
  onEdit: (record: UserInfo) => void;
  onManageRoles: (record: UserInfo) => void;
  onDelete: (record: UserInfo) => void;
}

/**
 * Action column component for admin user table.
 * Memoized to prevent unnecessary re-renders when other columns change.
 */
const ActionColumn = React.memo<ActionColumnProps>(
  ({ record, intl, access, onEdit, onManageRoles, onDelete }) => (
    <Space>
      <Access accessible={access.canAdminUserEdit} fallback={null}>
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => onEdit(record)}
        >
          {intl.formatMessage({
            id: 'pages.adminUsers.edit',
            defaultMessage: 'Edit',
          })}
        </Button>
      </Access>
      <Access accessible={access.canAdminUserRoleEdit} fallback={null}>
        <Button
          type="link"
          size="small"
          icon={<TeamOutlined />}
          onClick={() => onManageRoles(record)}
        >
          {intl.formatMessage({
            id: 'pages.adminUsers.manageRoles',
            defaultMessage: 'Manage role',
          })}
        </Button>
      </Access>
      <Access accessible={access.canAdminUserDelete} fallback={null}>
        <Popconfirm
          title={intl.formatMessage({
            id: 'pages.adminUsers.confirmDelete',
            defaultMessage: 'Are you sure you want to delete this admin?',
          })}
          description={intl.formatMessage({
            id: 'pages.adminUsers.confirmDeleteDesc',
            defaultMessage: 'This action cannot be undone',
          })}
          onConfirm={() => onDelete(record)}
          okText={intl.formatMessage({
            id: 'pages.adminUsers.confirm',
            defaultMessage: 'Confirm',
          })}
          cancelText={intl.formatMessage({
            id: 'pages.adminUsers.cancel',
            defaultMessage: 'Cancel',
          })}
        >
          <Button type="link" danger size="small" icon={<DeleteOutlined />}>
            {intl.formatMessage({
              id: 'pages.adminUsers.delete',
              defaultMessage: 'Delete',
            })}
          </Button>
        </Popconfirm>
      </Access>
    </Space>
  ),
);

ActionColumn.displayName = 'AdminUserActionColumn';

export default ActionColumn;
