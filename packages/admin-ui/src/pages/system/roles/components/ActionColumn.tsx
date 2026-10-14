import {
  DeleteOutlined,
  EditOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { Access } from '@umijs/max';
import { Button, Popconfirm, Space, Tooltip } from 'antd';
import React from 'react';
import type { RoleTableItem } from '../data';
import type { IntlShape } from '@/types/intl';

interface AccessShape {
  canAdminRoleEdit: boolean;
}

export interface ActionColumnProps {
  record: RoleTableItem;
  intl: IntlShape;
  access: AccessShape;
  /** Warning color token for the delete description highlight. */
  warningColor: string;
  onPermission: (record: RoleTableItem) => void;
  onEdit: (record: RoleTableItem) => void;
  onDelete: (record: RoleTableItem) => void;
}

/**
 * Action column component for admin role table.
 * Memoized to prevent unnecessary re-renders when other columns change.
 */
const ActionColumn = React.memo<ActionColumnProps>(
  ({ record, intl, access, warningColor, onPermission, onEdit, onDelete }) => (
    <Space>
      <Access accessible={access.canAdminRoleEdit} fallback={null}>
        <Button
          type="link"
          size="small"
          icon={<SafetyOutlined />}
          onClick={() => onPermission(record)}
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
          onClick={() => onEdit(record)}
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
              defaultMessage: 'System built-in admin role cannot be deleted',
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
                <p style={{ color: warningColor, fontWeight: 500 }}>
                  {intl.formatMessage({
                    id: 'pages.roles.confirmDeleteRoleWarning',
                    defaultMessage:
                      'All administrators under this role will lose corresponding permissions',
                  })}
                </p>
              </>
            }
            onConfirm={() => onDelete(record)}
            okText={intl.formatMessage({
              id: 'pages.roles.confirm',
              defaultMessage: 'Confirm',
            })}
            cancelText={intl.formatMessage({
              id: 'pages.roles.cancel',
              defaultMessage: 'Cancel',
            })}
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
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
);

ActionColumn.displayName = 'RoleActionColumn';

export default ActionColumn;
