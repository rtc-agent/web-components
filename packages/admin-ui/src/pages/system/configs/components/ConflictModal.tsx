import { ModalForm } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Alert, Button, Descriptions, Space, Tag, theme } from 'antd';
import React from 'react';
import type { OptimisticLockConflictData } from '@/services/serverConfig';

export interface ConflictModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflictData: OptimisticLockConflictData | null;
  configKey?: string;
  onReload: () => void;
  onForceOverwrite: () => void;
}

/**
 * Optimistic Lock Conflict Dialog
 */
const ConflictModal: React.FC<ConflictModalProps> = ({
  open,
  onOpenChange,
  conflictData,
  configKey,
  onReload,
  onForceOverwrite,
}) => {
  const intl = useIntl();
  const { token } = theme.useToken();

  if (!conflictData) return null;

  const formatValue = (value: unknown) => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <ModalForm
      title={intl.formatMessage({ id: 'pages.config.system.conflict.title' })}
      open={open}
      onOpenChange={onOpenChange}
      modalProps={{ destroyOnClose: true }}
      submitter={{
        render: () => (
          <Space>
            <Button
              onClick={() => {
                onOpenChange(false);
                onReload();
              }}
            >
              {intl.formatMessage({
                id: 'pages.config.system.conflict.reload',
              })}
            </Button>
            <Button
              type="primary"
              danger
              onClick={() => {
                onOpenChange(false);
                onForceOverwrite();
              }}
            >
              {intl.formatMessage({
                id: 'pages.config.system.conflict.forceOverwrite',
              })}
            </Button>
          </Space>
        ),
      }}
    >
      <Alert
        type="warning"
        showIcon
        title={intl.formatMessage({
          id: 'pages.config.system.conflict.warningTitle',
        })}
        description={intl.formatMessage({
          id: 'pages.config.system.conflict.warningDesc',
        })}
        style={{ marginBottom: 16 }}
      />
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item
          label={intl.formatMessage({
            id: 'pages.config.system.conflict.configKey',
          })}
        >
          <code
            style={{
              fontSize: 12,
              background: token.colorBgTextHover,
              padding: token.paddingXXS,
              borderRadius: token.borderRadiusSM,
            }}
          >
            {configKey}
          </code>
        </Descriptions.Item>
        <Descriptions.Item
          label={intl.formatMessage({
            id: 'pages.config.system.conflict.currentVersion',
          })}
        >
          <Tag color="blue">v{conflictData.current_version}</Tag>
        </Descriptions.Item>
        <Descriptions.Item
          label={intl.formatMessage({
            id: 'pages.config.system.conflict.currentValue',
          })}
        >
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 200,
              overflow: 'auto',
              background: token.colorBgTextHover,
              color: token.colorText,
              padding: token.paddingSM,
              borderRadius: token.borderRadiusSM,
            }}
          >
            {formatValue(conflictData.current_value)}
          </pre>
        </Descriptions.Item>
        <Descriptions.Item
          label={intl.formatMessage({
            id: 'pages.config.system.conflict.changedBy',
          })}
        >
          {conflictData.changed_by}
        </Descriptions.Item>
        <Descriptions.Item
          label={intl.formatMessage({
            id: 'pages.config.system.conflict.changedAt',
          })}
        >
          {new Intl.DateTimeFormat(intl.locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          }).format(new Date(conflictData.changed_at))}
        </Descriptions.Item>
      </Descriptions>
    </ModalForm>
  );
};

export default ConflictModal;
