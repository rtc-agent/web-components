import React from 'react';
import {
  getServerConfigHistory,
  rollbackServerConfig,
} from '@/services/serverConfig';
import ConfigHistoryTable from './ConfigHistoryTable';

export interface ConfigHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configKey: string | null;
  currentVersion: number;
  onChanged: () => void;
}

/**
 * 系统配置历史 + 回滚对话框
 * 使用 ConfigHistoryTable 共享组件
 */
const ConfigHistoryModal: React.FC<ConfigHistoryModalProps> = ({
  open,
  onOpenChange,
  configKey,
  currentVersion,
  onChanged,
}) => {
  const fetchHistory = async (
    key: string,
    params: { page?: number; page_size?: number },
  ) => {
    const response = await getServerConfigHistory(key, params);
    return { items: response.items, total: response.total };
  };

  const doRollback = async (
    key: string,
    targetVersion: number,
    version: number,
    changeNote?: string,
  ) => {
    await rollbackServerConfig(key, {
      target_version: targetVersion,
      version,
      change_note: changeNote,
    });
  };

  if (!configKey) return null;

  return (
    <ConfigHistoryTable
      open={open}
      onOpenChange={onOpenChange}
      configKey={configKey}
      currentVersion={currentVersion}
      fetchHistory={fetchHistory}
      doRollback={doRollback}
      onRollbackSuccess={onChanged}
      modalTitleId="pages.config.system.historyTitle"
      rollbackTitleId="pages.config.system.rollbackTitle"
      rollbackConfirmId="pages.config.system.rollbackConfirm"
      rollbackToVersionId="pages.config.system.rollbackToVersion"
      rollbackDefaultNoteId="pages.config.system.rollbackDefaultNote"
    />
  );
};

export default ConfigHistoryModal;
