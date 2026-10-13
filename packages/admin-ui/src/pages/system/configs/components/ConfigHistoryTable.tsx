import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { App, Button, Tag } from 'antd';
import React, { useMemo, useRef, useState } from 'react';
import type { ConfigHistoryItem } from '@/services/server-config';
import { formatConfigValue, truncateValue } from '@/utils/configFormat';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface ConfigHistoryTableProps {
  /** Whether the modal is open */
  open: boolean;
  /** Modal open/close callback */
  onOpenChange: (open: boolean) => void;
  /** Configuration key name */
  configKey: string;
  /** Current version number, used for highlighting */
  currentVersion: number;
  /** Fetch history list */
  fetchHistory: (
    key: string,
    params: { page?: number; page_size?: number },
  ) => Promise<{
    items: ConfigHistoryItem[];
    total: number;
  }>;
  /** Execute rollback operation */
  doRollback: (
    key: string,
    targetVersion: number,
    currentVersion: number,
    changeNote?: string,
  ) => Promise<void>;
  /** Callback after successful rollback */
  onRollbackSuccess?: () => void;
  /** History modal title i18n id */
  modalTitleId: string;
  /** Rollback confirm modal title i18n id */
  rollbackTitleId: string;
  /** Rollback confirm text i18n id */
  rollbackConfirmId: string;
  /** Rollback to version text i18n id */
  rollbackToVersionId: string;
  /** Rollback default change note i18n id */
  rollbackDefaultNoteId: string;
  /** Rollback success message i18n id */
  rollbackSuccessId: string;
}

/**
 * Configuration History Table Component
 * Displays config change history and supports rollback operations
 */
const ConfigHistoryTable: React.FC<ConfigHistoryTableProps> = ({
  open,
  onOpenChange,
  configKey,
  currentVersion,
  fetchHistory,
  doRollback,
  onRollbackSuccess,
  modalTitleId,
  rollbackTitleId,
  rollbackConfirmId,
  rollbackToVersionId,
  rollbackDefaultNoteId,
  rollbackSuccessId,
}) => {
  const actionRef = useRef<ActionType>(null);
  const [rollbackTarget, setRollbackTarget] =
    useState<ConfigHistoryItem | null>(null);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const intl = useIntl();
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const modalWidth = isMobile ? '95vw' : 800;

  const columns = useMemo<ProColumns<ConfigHistoryItem>[]>(
    () => [
      {
        title: intl.formatMessage({ id: 'pages.config.system.historyVersion' }),
        dataIndex: 'version',
        width: 80,
        render: (_, record) => (
          <Tag color={record.version === currentVersion ? 'blue' : 'default'}>
            v{record.version}
          </Tag>
        ),
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.historyOldValue',
        }),
        dataIndex: 'old_value',
        ellipsis: true,
        render: (_, record) => {
          const text = formatConfigValue(record.old_value);
          return (
            <span
              title={text}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            >
              {truncateValue(text, 50)}
            </span>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.historyNewValue',
        }),
        dataIndex: 'new_value',
        ellipsis: true,
        render: (_, record) => {
          const text = formatConfigValue(record.new_value);
          return (
            <span
              title={text}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            >
              {truncateValue(text, 50)}
            </span>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.historyChangedBy',
        }),
        dataIndex: 'changed_by',
        width: 150,
        ellipsis: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.historyChangeNote',
        }),
        dataIndex: 'change_note',
        ellipsis: true,
        render: (_, record) => record.change_note || '-',
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.historyChangedAt',
        }),
        dataIndex: 'changed_at',
        valueType: 'dateTime',
        width: 180,
        sorter: (a, b) =>
          new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime(),
        defaultSortOrder: 'descend',
      },
      {
        title: intl.formatMessage({ id: 'pages.config.system.historyActions' }),
        dataIndex: 'option',
        width: 80,
        render: (_, record) => (
          <Button
            type="link"
            size="small"
            onClick={() => {
              setRollbackTarget(record);
              setRollbackModalOpen(true);
            }}
          >
            {intl.formatMessage({ id: 'pages.config.system.historyRollback' })}
          </Button>
        ),
      },
    ],
    [intl, currentVersion],
  );

  if (!configKey) return null;

  return (
    <>
      <ModalForm
        title={`${intl.formatMessage({ id: modalTitleId })}${configKey}`}
        open={open}
        onOpenChange={onOpenChange}
        width={modalWidth}
        modalProps={{
          destroyOnClose: true,
          style: { maxWidth: modalWidth },
        }}
        submitter={false}
      >
        <ProTable<ConfigHistoryItem>
          actionRef={actionRef}
          // NOTE: version is guaranteed unique per configKey by the backend (auto-increment),
          // but use composite key for defensive programming.
          rowKey={(record) =>
            `${record.version}-${record.changed_at}-${record.changed_by}`
          }
          search={false}
          options={false}
          pagination={{ defaultPageSize: 10, showSizeChanger: false }}
          request={async (params) => {
            try {
              const response = await fetchHistory(configKey, {
                page: params.current,
                page_size: params.pageSize,
              });
              return {
                data: response.items,
                total: response.total,
                success: true,
              };
            } catch (error: unknown) {
              message.error(
                getFriendlyErrorMessage(
                  error,
                  intl,
                  intl.formatMessage({
                    id: 'pages.config.system.historyLoadFailed',
                    defaultMessage: 'Failed to load history',
                  }),
                ),
              );
              return { data: [], total: 0, success: false };
            }
          }}
          columns={columns}
        />
      </ModalForm>

      {/* Rollback confirmation modal */}
      <ModalForm
        title={intl.formatMessage({ id: rollbackTitleId })}
        open={rollbackModalOpen}
        onOpenChange={setRollbackModalOpen}
        modalProps={{ destroyOnClose: true }}
        onFinish={async (values: { change_note?: string }) => {
          if (!rollbackTarget) return false;
          try {
            await doRollback(
              configKey,
              rollbackTarget.version,
              currentVersion,
              values.change_note ||
                intl.formatMessage(
                  { id: rollbackDefaultNoteId },
                  { version: rollbackTarget.version },
                ),
            );
            message.success(intl.formatMessage({ id: rollbackSuccessId }));
            setRollbackModalOpen(false);
            onRollbackSuccess?.();
            actionRef.current?.reload();
            return true;
          } catch (error: unknown) {
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.config.system.rollbackFailed',
                  defaultMessage: 'Failed to rollback configuration',
                }),
              ),
            );
            return false;
          }
        }}
      >
        <p>
          {intl.formatMessage({ id: rollbackConfirmId })}{' '}
          <code>{configKey}</code>{' '}
          {intl.formatMessage({ id: rollbackToVersionId })}{' '}
          <Tag color="blue">v{rollbackTarget?.version}</Tag> ?
        </p>
        <ProFormTextArea
          name="change_note"
          label={intl.formatMessage({ id: 'pages.config.system.changeNote' })}
          placeholder={intl.formatMessage({
            id: 'pages.config.system.rollbackNotePlaceholder',
          })}
          fieldProps={{ rows: 2, maxLength: 500, showCount: true }}
        />
      </ModalForm>
    </>
  );
};

export default ConfigHistoryTable;
