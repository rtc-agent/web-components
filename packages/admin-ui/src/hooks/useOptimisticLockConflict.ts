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
  /** 强制删除时的实际操作函数 */
  onForceDelete?: (data: { key: string }) => Promise<void>;
  /** 冲突被解决后（重新加载或强制覆盖成功）的回调 */
  onConflictResolved: () => void;
  /** 强制覆盖成功的提示消息 i18n key */
  forceOverwriteSuccessId: string;
  /** 强制覆盖后缀文本 i18n key */
  forceOverwriteSuffixId: string;
  /** 强制删除成功的提示消息 i18n key */
  forceDeleteSuccessId?: string;
}

export interface PendingOverwriteData {
  key: string;
  value: unknown;
  changeNote?: string;
}

export interface PendingDeleteData {
  key: string;
}

export type PendingAction =
  | { type: 'overwrite'; data: PendingOverwriteData }
  | { type: 'delete'; data: PendingDeleteData };

export const useOptimisticLockConflict = (
  options: UseOptimisticLockConflictOptions,
) => {
  const {
    onForceOverwrite,
    onForceDelete,
    onConflictResolved,
    forceOverwriteSuccessId,
    forceDeleteSuccessId,
  } = options;

  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] =
    useState<OptimisticLockConflictData | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );

  const intl = useIntl();
  const { message } = App.useApp();

  /**
   * Check if error is an optimistic lock conflict
   * @param error - The error to check
   * @returns The conflict data if it's a conflict error, null otherwise
   */
  const getOptimisticLockConflictData = (
    error: unknown,
  ): OptimisticLockConflictData | null => {
    const err = error as {
      info?: {
        errorCode?: string;
        data?: OptimisticLockConflictData;
      };
    };

    if (err?.info?.errorCode === 'OPTIMISTIC_LOCK_CONFLICT') {
      return (err.info.data as OptimisticLockConflictData | undefined) || null;
    }
    return null;
  };

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
    const conflictInfo = getOptimisticLockConflictData(error);

    if (conflictInfo) {
      setConflictData(conflictInfo);
      setPendingAction({ type: 'overwrite', data: editData });
      setConflictModalOpen(true);
      return true;
    }

    // 非冲突错误，返回 false 让调用方继续处理
    return false;
  };

  /**
   * 处理删除操作中的乐观锁冲突错误
   * 如果错误是冲突类型，则打开冲突对话框
   *
   * @param error - 捕获的错误对象
   * @param deleteData - 删除的数据（key）
   * @returns true 表示错误已被处理（冲突对话框已打开），false 表示需要继续处理
   */
  const handleDeleteError = (
    error: unknown,
    deleteData: PendingDeleteData,
  ): boolean => {
    const conflictInfo = getOptimisticLockConflictData(error);

    if (conflictInfo) {
      setConflictData(conflictInfo);
      setPendingAction({ type: 'delete', data: deleteData });
      setConflictModalOpen(true);
      return true;
    }

    // 非冲突错误，返回 false 让调用方继续处理
    return false;
  };

  /** 重新加载数据，关闭冲突对话框 */
  const handleReload = () => {
    setConflictModalOpen(false);
    setConflictData(null);
    setPendingAction(null);
    onConflictResolved();
  };

  /** 强制覆盖或删除操作 */
  const handleForceAction = async () => {
    if (!pendingAction) return;

    try {
      if (pendingAction.type === 'overwrite') {
        await onForceOverwrite(pendingAction.data);
        message.success(intl.formatMessage({ id: forceOverwriteSuccessId }));
      } else if (pendingAction.type === 'delete') {
        if (onForceDelete) {
          await onForceDelete(pendingAction.data);
          const successId =
            forceDeleteSuccessId || 'pages.config.system.deleteSuccess';
          message.success(intl.formatMessage({ id: successId }));
        }
      }
      setConflictModalOpen(false);
      setConflictData(null);
      setPendingAction(null);
      onConflictResolved();
    } catch (error: unknown) {
      message.error(getFriendlyErrorMessage(error));
    }
  };

  return {
    conflictModalOpen,
    setConflictModalOpen,
    conflictData,
    pendingAction,
    getOptimisticLockConflictData,
    handleEditError,
    handleDeleteError,
    handleReload,
    handleForceAction,
  };
};
