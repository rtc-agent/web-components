import { ModalForm } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Alert, Button, Space } from 'antd';
import React from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { OptimisticLockConflictData } from '@/services/server-config';

export interface ConflictModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflictData: OptimisticLockConflictData | null;
  configKey?: string;
  /** Action type: 'overwrite' for edit, 'delete' for delete */
  actionType?: 'overwrite' | 'delete';
  onReload: () => void;
  onForceAction: () => void;
}

/**
 * Optimistic Lock Conflict Dialog (supports both edit and delete operations)
 */
const ConflictModal: React.FC<ConflictModalProps> = ({
  open,
  onOpenChange,
  conflictData,
  actionType = 'overwrite',
  onReload,
  onForceAction,
}) => {
  const intl = useIntl();
  const isMobile = useIsMobile();
  const modalWidth = isMobile ? '95vw' : 480;

  if (!conflictData) return null;

  const isDeleteAction = actionType === 'delete';

  return (
    <ModalForm
      title={intl.formatMessage({
        id: isDeleteAction
          ? 'pages.config.system.conflict.deleteTitle'
          : 'pages.config.system.conflict.title',
      })}
      open={open}
      onOpenChange={onOpenChange}
      width={modalWidth}
      modalProps={{
        destroyOnHidden: true,
        style: { maxWidth: modalWidth },
      }}
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
                defaultMessage: 'Reload',
              })}
            </Button>
            <Button
              type="primary"
              danger
              loading={false} // Will be controlled by parent if needed
              onClick={() => {
                // Let handleForceAction control modal lifecycle
                // It will call setConflictModalOpen(false) on success
                onForceAction();
              }}
            >
              {intl.formatMessage({
                id: isDeleteAction
                  ? 'pages.config.system.conflict.forceDelete'
                  : 'pages.config.system.conflict.forceOverwrite',
              })}
            </Button>
          </Space>
        ),
      }}
    >
      <Alert
        type="warning"
        showIcon
        message={intl.formatMessage({
          id: 'pages.config.system.conflict.warningTitle',
          defaultMessage: 'Config has been modified by another admin',
        })}
        description={intl.formatMessage({
          id: isDeleteAction
            ? 'pages.config.system.conflict.deleteWarningDesc'
            : 'pages.config.system.conflict.warningDesc',
        })}
        style={{ marginBottom: 16 }}
      />
    </ModalForm>
  );
};

export default ConflictModal;
