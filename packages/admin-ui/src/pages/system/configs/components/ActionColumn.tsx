import { HistoryOutlined } from '@ant-design/icons';
import { Access } from '@umijs/max';
import { Button, Popconfirm, Space } from 'antd';
import React from 'react';
import type { ServerConfigItem } from '../service';

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
  canServerConfigEdit: boolean;
  canServerConfigDelete: boolean;
}

export interface ActionColumnProps {
  record: ServerConfigItem;
  intl: IntlShape;
  access: AccessShape;
  onEdit: (record: ServerConfigItem) => void;
  onViewHistory: (record: ServerConfigItem) => void;
  onDelete: (record: ServerConfigItem) => void;
}

/**
 * Action column component for system config table.
 * Memoized to prevent unnecessary re-renders when other columns change.
 */
const ActionColumn = React.memo<ActionColumnProps>(
  ({ record, intl, access, onEdit, onViewHistory, onDelete }) => (
    <Space>
      <Access accessible={access.canServerConfigEdit} fallback={null}>
        <Button type="link" size="small" onClick={() => onEdit(record)}>
          {intl.formatMessage({ id: 'pages.config.system.edit' })}
        </Button>
      </Access>
      {record.version > 0 && (
        // History button: no explicit <Access> guard needed.
        // This button is only visible if the user can access this page,
        // which requires PERM_SERVER_CONFIG_READ (granted at route level).
        // History viewing is a read operation, covered by the read permission.
        <Button
          type="link"
          size="small"
          icon={<HistoryOutlined />}
          onClick={() => onViewHistory(record)}
        >
          {intl.formatMessage({ id: 'pages.config.system.history' })}
        </Button>
      )}
      <Access accessible={access.canServerConfigDelete} fallback={null}>
        {record.source === 'system' && (
          <Popconfirm
            title={intl.formatMessage({
              id: 'pages.config.system.confirmDelete',
            })}
            description={intl.formatMessage({
              id: 'pages.config.system.confirmDeleteDesc',
            })}
            onConfirm={() => onDelete(record)}
            okText={intl.formatMessage({
              id: 'pages.config.system.confirm',
            })}
            cancelText={intl.formatMessage({
              id: 'pages.config.system.cancel',
            })}
          >
            <Button type="link" size="small" danger>
              {intl.formatMessage({ id: 'pages.config.system.delete' })}
            </Button>
          </Popconfirm>
        )}
      </Access>
    </Space>
  ),
);

ActionColumn.displayName = 'ConfigActionColumn';

export default ActionColumn;
