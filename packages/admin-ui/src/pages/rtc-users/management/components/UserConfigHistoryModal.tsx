import {
  getUserConfigHistory,
  rollbackUserConfig,
} from '@/services/userConfig';
import ConfigHistoryTable from '@/pages/system/configs/components/ConfigHistoryTable';
import type { UserConfigItem } from '@/services/userConfig';

export interface UserConfigHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  item: UserConfigItem;
  onRollbackSuccess: () => void;
}

/**
 * 用户配置历史弹窗
 */
const UserConfigHistoryModal: React.FC<UserConfigHistoryModalProps> = ({
  open,
  onOpenChange,
  userId,
  item,
  onRollbackSuccess,
}) => {
  const fetchHistory = async (
    key: string,
    params: { page?: number; page_size?: number },
  ) => {
    const response = await getUserConfigHistory(userId, key, params);
    return { items: response.items, total: response.total };
  };

  const doRollback = async (
    key: string,
    targetVersion: number,
    version: number,
    changeNote?: string,
  ) => {
    await rollbackUserConfig(userId, key, {
      target_version: targetVersion,
      version,
      change_note: changeNote,
    });
  };

  return (
    <ConfigHistoryTable
      open={open}
      onOpenChange={onOpenChange}
      configKey={item.key}
      currentVersion={item.version}
      fetchHistory={fetchHistory}
      doRollback={doRollback}
      onRollbackSuccess={onRollbackSuccess}
      modalTitleId="pages.config.user.historyTitle"
      rollbackTitleId="pages.config.user.rollbackTitle"
      rollbackConfirmId="pages.config.user.rollbackConfirm"
      rollbackToVersionId="pages.config.user.rollbackToVersion"
      rollbackDefaultNoteId="pages.config.user.rollbackDefaultNote"
      rollbackSuccessId="pages.config.user.rollbackSuccess"
    />
  );
};

export default UserConfigHistoryModal;
