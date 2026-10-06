import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { App, Button, Tag } from 'antd';
import React, { useRef, useState } from 'react';
import type { ConfigHistoryItem } from '@/services/serverConfig';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

export interface ConfigHistoryTableProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 弹窗开关回调 */
  onOpenChange: (open: boolean) => void;
  /** 配置键名 */
  configKey: string;
  /** 当前版本号，用于高亮显示 */
  currentVersion: number;
  /** 获取历史记录列表 */
  fetchHistory: (
    key: string,
    params: { page?: number; page_size?: number },
  ) => Promise<{
    items: ConfigHistoryItem[];
    total: number;
  }>;
  /** 执行回滚操作 */
  doRollback: (
    key: string,
    targetVersion: number,
    currentVersion: number,
    changeNote?: string,
  ) => Promise<void>;
  /** 回滚成功后的回调 */
  onRollbackSuccess?: () => void;
  /** 历史弹窗标题 i18n id */
  modalTitleId: string;
  /** 回滚确认弹窗标题 i18n id */
  rollbackTitleId: string;
  /** 回滚确认文本 i18n id */
  rollbackConfirmId: string;
  /** 回滚到版本文本 i18n id */
  rollbackToVersionId: string;
  /** 回滚默认变更说明 i18n id */
  rollbackDefaultNoteId: string;
}

/**
 * 配置历史表格组件
 * 展示配置变更历史并支持回滚操作
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
}) => {
  const actionRef = useRef<ActionType>(null);
  const [rollbackTarget, setRollbackTarget] =
    useState<ConfigHistoryItem | null>(null);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const intl = useIntl();
  const { message } = App.useApp();

  const columns: ProColumns<ConfigHistoryItem>[] = [
    {
      title: intl.formatMessage({ id: 'pages.config.system.historyVersion' }),
      dataIndex: 'version',
      width: 80,
      render: (_, record) => (
        <Tag
          color={record.version === currentVersion ? 'blue' : 'default'}
        >
          v{record.version}
        </Tag>
      ),
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.historyOldValue' }),
      dataIndex: 'old_value',
      ellipsis: true,
      render: (_, record) => {
        const val = record.old_value;
        if (val === null || val === undefined) return '-';
        const text =
          typeof val === 'object' ? JSON.stringify(val) : String(val);
        return (
          <span
            title={text}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          >
            {text.length > 50 ? `${text.slice(0, 50)}...` : text}
          </span>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.historyNewValue' }),
      dataIndex: 'new_value',
      ellipsis: true,
      render: (_, record) => {
        const val = record.new_value;
        if (val === null || val === undefined) return '-';
        const text =
          typeof val === 'object' ? JSON.stringify(val) : String(val);
        return (
          <span
            title={text}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          >
            {text.length > 50 ? `${text.slice(0, 50)}...` : text}
          </span>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.historyChangedBy' }),
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
      title: intl.formatMessage({ id: 'pages.config.system.historyChangedAt' }),
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
  ];

  if (!configKey) return null;

  return (
    <>
      <ModalForm
        title={`${intl.formatMessage({ id: modalTitleId })}${configKey}`}
        open={open}
        onOpenChange={onOpenChange}
        modalProps={{
          destroyOnClose: true,
          style: { minWidth: 800 },
        }}
        submitter={false}
      >
        <ProTable<ConfigHistoryItem>
          actionRef={actionRef}
          // NOTE: version 在单个 configKey 范围内由后端保证唯一性（自增），
          // 但为防御性编程使用复合 key。
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
              message.error(getFriendlyErrorMessage(error));
              return { data: [], total: 0, success: false };
            }
          }}
          columns={columns}
        />
      </ModalForm>

      {/* 回滚确认弹窗 */}
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
            message.success(
              intl.formatMessage({ id: 'pages.config.system.rollbackSuccess' }),
            );
            setRollbackModalOpen(false);
            onRollbackSuccess?.();
            actionRef.current?.reload();
            return true;
          } catch (error: unknown) {
            message.error(getFriendlyErrorMessage(error));
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
