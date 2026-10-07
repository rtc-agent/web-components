import { useIntl } from '@umijs/max';
import { App } from 'antd';
import { useState } from 'react';
import type { OptimisticLockConflictData } from '@/services/serverConfig';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

/**
 * 乐观锁冲突处理 Hook
 * 提取系统配置和用户配置页面中重复的冲突处理逻辑
 */

export interface UseOptimisticLockConflictOptions {
  /** 强制覆盖时的实际操作函数 */
  onForceOverwrite: (data: {
    key: string;
    value: unknown;
    changeNote?: string;
  }) => Promise<void>;
  /** 冲突被解决后（重新加载或强制覆盖成功）的回调 */
  onConflictResolved: () => void;
  /** 强制覆盖成功的提示消息 i18n key */
  forceOverwriteSuccessId: string;
  /** 强制覆盖后缀文本 i18n key */
  forceOverwriteSuffixId: string;
}

export interface PendingOverwriteData {
  key: string;
  value: unknown;
  changeNote?: string;
}

export const useOptimisticLockConflict = (
  options: UseOptimisticLockConflictOptions,
) => {
  const { onForceOverwrite, onConflictResolved, forceOverwriteSuccessId } =
    options;

  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] =
    useState<OptimisticLockConflictData | null>(null);
  const [pendingOverwrite, setPendingOverwrite] =
    useState<PendingOverwriteData | null>(null);

  const intl = useIntl();
  const { message } = App.useApp();

  /**
   * 处理编辑操作中的乐观锁冲突错误
   * 如果错误是冲突类型，则打开冲突对话框
   * 否则显示普通错误消息
   *
   * @param error - 捕获的错误对象
   * @param editData - 编辑的数据（key, value, changeNote）
   * @returns true 表示错误已被处理（冲突对话框已打开或已降级为普通错误），false 表示需要继续处理
   */
  const handleEditError = (
    error: unknown,
    editData: PendingOverwriteData,
  ): boolean => {
    const err = error as {
      info?: {
        errorCode?: string;
        data?: OptimisticLockConflictData;
      };
    };

    if (err?.info?.errorCode === 'OPTIMISTIC_LOCK_CONFLICT') {
      const conflictInfo = err.info.data as
        | OptimisticLockConflictData
        | undefined;
      if (conflictInfo) {
        setConflictData(conflictInfo);
        setPendingOverwrite(editData);
        setConflictModalOpen(true);
        return true;
      }
      // 后端返回冲突错误但缺少冲突详情，降级为普通错误提示
      message.error(getFriendlyErrorMessage(error));
      return true;
    }

    // 非冲突错误，返回 false 让调用方继续处理
    return false;
  };

  /** 重新加载数据，关闭冲突对话框 */
  const handleReload = () => {
    setConflictModalOpen(false);
    setConflictData(null);
    setPendingOverwrite(null);
    onConflictResolved();
  };

  /** 强制覆盖操作 */
  const handleForceOverwrite = async () => {
    if (!pendingOverwrite) return;
    try {
      await onForceOverwrite(pendingOverwrite);
      message.success(intl.formatMessage({ id: forceOverwriteSuccessId }));
      setConflictModalOpen(false);
      setConflictData(null);
      setPendingOverwrite(null);
      onConflictResolved();
    } catch (error: unknown) {
      message.error(getFriendlyErrorMessage(error));
    }
  };

  return {
    conflictModalOpen,
    setConflictModalOpen,
    conflictData,
    pendingOverwrite,
    handleEditError,
    handleReload,
    handleForceOverwrite,
  };
};
