import {
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { useIntl, useRequest } from '@umijs/max';
import {
  App,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Dropdown,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import React, { useCallback, useMemo, useState } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOptimisticLockConflict } from '@/hooks/useOptimisticLockConflict';
import ConflictModal from '@/pages/system/configs/components/ConflictModal';
import {
  formatConfigValue,
  useConfigSourceRenderer,
} from '@/utils/configFormat';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import type { RtcUserInfo } from '../data';
import type { UserConfigItem } from '../service';
import { deleteUserConfig, getUserConfigs, setUserConfig } from '../service';
import UserConfigEditModal from './UserConfigEditModal';
import UserConfigHistoryModal from './UserConfigHistoryModal';

const { Text } = Typography;

export interface UserConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  user: RtcUserInfo | null;
  // NOTE: 用户配置权限复用系统配置权限（设计文档明确说明）
  // 使用 canServerConfigEdit/canServerConfigDelete 是有意为之的设计
  canEdit?: boolean;
  canDelete?: boolean;
}

/**
 * 用户配置 Drawer
 */
const UserConfigDrawer: React.FC<UserConfigDrawerProps> = ({
  open,
  onClose,
  user,
  canEdit = false,
  canDelete = false,
}) => {
  const [editingConfig, setEditingConfig] = useState<UserConfigItem | null>(
    null,
  );
  const [editModalOpen, setEditModalOpen] = useState(false);

  // 历史弹窗
  const [historyItem, setHistoryItem] = useState<UserConfigItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const userId = user?.id;
  const intl = useIntl();
  const { message } = App.useApp();
  const renderConfigSource = useConfigSourceRenderer();
  const isMobile = useIsMobile();

  /** 加载用户配置 */
  // NOTE: umi 内置的 useRequest 默认 formatResult: result => result?.data，
  // 而 request() 已经通过响应拦截器解包了 { success, data } 结构，
  // 所以此处需要用恒等函数覆盖，避免二次解包导致 data 为 undefined。
  const {
    data: configsData,
    loading,
    run: runLoadConfigs,
  } = useRequest(() => (userId ? getUserConfigs(userId) : Promise.reject()), {
    ready: open && !!userId,
    refreshDeps: [open, userId],
    formatResult: (res: unknown) => res,
    onError: (error) => {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({ id: 'pages.roles.operationFailed' }),
        ),
      );
    },
  }) as {
    data: { items: UserConfigItem[] } | undefined;
    loading: boolean;
    run: () => void;
  };

  const configs = configsData?.items || [];

  /** 手动刷新配置（用于操作后重新加载） */
  const loadConfigs = useCallback(() => {
    runLoadConfigs();
  }, [runLoadConfigs]);

  /** 强制覆盖操作 */
  const doForceOverwrite = async (data: {
    key: string;
    value: unknown;
    changeNote?: string;
  }) => {
    if (!userId) {
      message.error(
        intl.formatMessage({ id: 'pages.config.user.contextLost' }),
      );
      return;
    }
    const changeNote = data.changeNote
      ? `${data.changeNote} ${intl.formatMessage({ id: 'pages.config.system.forceOverwriteSuffix' })}`
      : intl.formatMessage({
          id: 'pages.config.system.forceOverwriteSuffix',
        });
    await setUserConfig(userId, data.key, {
      value: data.value,
      change_note: changeNote,
    });
  };

  /** 强制删除操作 */
  const doForceDelete = async (data: { key: string; version?: number }) => {
    if (!userId) {
      message.error(
        intl.formatMessage({ id: 'pages.config.user.contextLost' }),
      );
      return;
    }
    // version 应该总是存在的（从冲突数据或原始数据中获取）
    if (!data.version) {
      message.error(
        intl.formatMessage({ id: 'pages.config.user.versionRequired' }),
      );
      return;
    }
    await deleteUserConfig(userId, data.key, data.version);
  };

  // 乐观锁冲突处理
  const {
    conflictModalOpen,
    setConflictModalOpen,
    conflictData,
    pendingAction,
    handleEditError,
    handleDeleteError,
    handleReload: handleConflictReload,
    handleForceAction,
  } = useOptimisticLockConflict({
    onForceOverwrite: doForceOverwrite,
    onForceDelete: doForceDelete,
    onConflictResolved: loadConfigs,
    forceOverwriteSuccessId: 'pages.config.user.forceOverwriteSuccess',
    forceOverwriteSuffixId: 'pages.config.system.forceOverwriteSuffix',
    forceDeleteSuccessId: 'pages.config.user.forceDeleteSuccess',
  });

  /** 按 category 分组 */
  const groupedConfigs = useMemo(
    () =>
      configs.reduce<Record<string, UserConfigItem[]>>((acc, item) => {
        const cat = item.category || 'other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(item);
        return acc;
      }, {}),
    [configs],
  );

  /** 删除用户覆盖 */
  const handleDelete = async (item: UserConfigItem) => {
    if (!userId) return;
    try {
      await deleteUserConfig(userId, item.key, item.version);
      message.success(
        intl.formatMessage({ id: 'pages.config.user.deleteSuccess' }),
      );
      loadConfigs();
    } catch (error: unknown) {
      // Check if it's an optimistic lock conflict
      const handled = handleDeleteError(error, {
        key: item.key,
        version: item.version,
      });
      if (!handled) {
        // Non-conflict error, show normal error message
        message.error(
          getFriendlyErrorMessage(
            error,
            intl,
            intl.formatMessage({ id: 'pages.roles.operationFailed' }),
          ),
        );
      }
    }
  };

  /** 打开编辑 */
  const handleEdit = (item: UserConfigItem) => {
    setEditingConfig(item);
    setEditModalOpen(true);
  };

  /** 提交编辑 */
  const handleEditFinish = async (values: {
    value: unknown;
    change_note?: string;
  }) => {
    if (!editingConfig || !userId) return false;
    try {
      await setUserConfig(userId, editingConfig.key, {
        value: values.value,
        version: editingConfig.version,
        change_note: values.change_note,
      });
      message.success(
        intl.formatMessage({ id: 'pages.config.user.updateSuccess' }),
      );
      setEditModalOpen(false);
      loadConfigs();
      return true;
    } catch (error: unknown) {
      // 使用 hook 处理乐观锁冲突
      const handled = handleEditError(error, {
        key: editingConfig.key,
        value: values.value,
        changeNote: values.change_note,
      });
      if (handled) {
        setEditModalOpen(false);
        return true;
      }
      // 非冲突错误，显示普通错误消息
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({ id: 'pages.roles.operationFailed' }),
        ),
      );
      return false;
    }
  };

  /** 打开历史 */
  const handleViewHistory = (item: UserConfigItem) => {
    setHistoryItem(item);
    setHistoryOpen(true);
  };

  /** Table columns */
  const columns = useMemo<ProColumns<UserConfigItem>[]>(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.config.user.key',
        }),
        dataIndex: 'key',
        width: 220,
        render: (_, record) => (
          <code style={{ fontSize: 12 }}>{record.key}</code>
        ),
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.user.effectiveValue',
        }),
        dataIndex: 'effective_value',
        ellipsis: true,
        render: (_, record) => {
          const formatted = formatConfigValue(record.effective_value);
          return (
            <span
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              title={formatted}
            >
              {formatted.length > 50
                ? `${formatted.slice(0, 50)}...`
                : formatted}
            </span>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.source',
        }),
        dataIndex: 'source',
        width: 100,
        render: (_, record) => renderConfigSource(record.source),
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.user.systemValue',
        }),
        dataIndex: 'system_value',
        width: 120,
        ellipsis: true,
        render: (_, record) => {
          const formatted = formatConfigValue(record.system_value);
          return (
            <span
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              title={formatted}
            >
              {formatted !== '-' && formatted.length > 20
                ? `${formatted.slice(0, 20)}...`
                : formatted}
            </span>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.actions',
        }),
        dataIndex: 'option',
        width: 120,
        fixed: 'right',
        render: (_, record) => (
          <Space>
            {canEdit && (
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              >
                {intl.formatMessage({
                  id: 'pages.config.user.edit',
                })}
              </Button>
            )}
            {record.source === 'user' && (
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'history',
                      icon: <HistoryOutlined />,
                      label: intl.formatMessage({
                        id: 'pages.config.user.history',
                      }),
                      onClick: () => handleViewHistory(record),
                    },
                    ...(canDelete
                      ? [
                          {
                            key: 'delete',
                            icon: <DeleteOutlined />,
                            label: (
                              <Popconfirm
                                title={intl.formatMessage({
                                  id: 'pages.config.user.confirmDelete',
                                })}
                                description={intl.formatMessage({
                                  id: 'pages.config.user.confirmDeleteDesc',
                                })}
                                onConfirm={() => handleDelete(record)}
                                okText={intl.formatMessage({
                                  id: 'pages.config.user.confirm',
                                })}
                                cancelText={intl.formatMessage({
                                  id: 'pages.config.user.cancel',
                                })}
                              >
                                <span className="text-red-500">
                                  {intl.formatMessage({
                                    id: 'pages.config.user.deleteOverride',
                                  })}
                                </span>
                              </Popconfirm>
                            ),
                            danger: true,
                          },
                        ]
                      : []),
                  ],
                }}
                trigger={['click']}
              >
                <Button
                  type="link"
                  size="small"
                  icon={<MoreOutlined />}
                  aria-label={intl.formatMessage({
                    id: 'pages.config.user.moreActions',
                    defaultMessage: 'More actions',
                  })}
                />
              </Dropdown>
            )}
          </Space>
        ),
      },
    ],
    [intl, renderConfigSource, canEdit, canDelete],
  );

  if (!user) return null;

  return (
    <>
      <Drawer
        title={`${intl.formatMessage({ id: 'pages.config.user.drawerTitle' })}${user.name || user.email || user.id}`}
        open={open}
        onClose={onClose}
        width={isMobile ? '90%' : 900}
        destroyOnHidden
      >
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item
            label={intl.formatMessage({ id: 'pages.config.user.userId' })}
          >
            <Text copyable>{user.id}</Text>
          </Descriptions.Item>
          <Descriptions.Item
            label={intl.formatMessage({ id: 'pages.config.user.email' })}
          >
            {user.email || '-'}
          </Descriptions.Item>
        </Descriptions>

        <Collapse
          defaultActiveKey={Object.keys(groupedConfigs)}
          items={Object.entries(groupedConfigs).map(([category, items]) => ({
            key: category,
            label: (
              <Space>
                <Text strong>{category}</Text>
                <Tag>{items.length}</Tag>
              </Space>
            ),
            children: (
              <ProTable<UserConfigItem>
                dataSource={items}
                rowKey="key"
                search={false}
                options={false}
                pagination={false}
                loading={loading}
                size="small"
                columns={columns}
              />
            ),
          }))}
        />
      </Drawer>

      {/* 编辑弹窗 */}
      {editingConfig && (
        <UserConfigEditModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          item={editingConfig}
          onFinish={handleEditFinish}
        />
      )}

      {/* 历史弹窗 */}
      {historyItem && userId && (
        <UserConfigHistoryModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          userId={userId}
          item={historyItem}
          onRollbackSuccess={() => {
            setHistoryOpen(false);
            loadConfigs();
          }}
        />
      )}

      {/* 冲突弹窗 */}
      <ConflictModal
        open={conflictModalOpen}
        onOpenChange={setConflictModalOpen}
        conflictData={conflictData}
        configKey={pendingAction?.data.key}
        actionType={pendingAction?.type}
        onReload={handleConflictReload}
        onForceAction={handleForceAction}
      />
    </>
  );
};

export default UserConfigDrawer;
