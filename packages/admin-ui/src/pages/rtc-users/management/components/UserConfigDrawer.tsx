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
import React, { useCallback, useMemo } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useModalState } from '@/hooks/useModalState';
import { useOptimisticLockConflict } from '@/hooks/useOptimisticLockConflict';
import { useProTableLocale } from '@/hooks/useProTableLocale';
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
  // Modal states managed by useModalState hook for consistency
  const editModal = useModalState<UserConfigItem>();
  const historyModal = useModalState<UserConfigItem>();

  const userId = user?.id;
  const intl = useIntl();
  const { message } = App.useApp();
  const renderConfigSource = useConfigSourceRenderer();
  const isMobile = useIsMobile();
  const tableLocale = useProTableLocale(
    'pages.config.user.empty',
    'No configurations found',
  );

  /** 加载用户配置 */
  // NOTE: 此处使用 umi 内置的 useRequest 而非 @tanstack/react-query，原因如下：
  // 1. 该组件是 Drawer 内的二级数据加载（非 ProTable），需要与 Drawer 的 open 状态强绑定
  // 2. useRequest 的 ready + refreshDeps 组合能简洁表达"仅当 open && userId 时加载"的语义
  // 3. 若迁移到 useQuery，需要额外的 enabled 条件判断和独立的 cache key 管理，收益有限
  // 4. umi 内置的 useRequest 默认 formatResult: result => result?.data，
  //    而 request() 已经通过响应拦截器解包了 { success, data } 结构，
  //    所以此处需要用恒等函数覆盖，避免二次解包导致 data 为 undefined。
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
          intl.formatMessage({
            id: 'pages.roles.operationFailed',
            defaultMessage: 'Operation failed',
          }),
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
        intl.formatMessage({
          id: 'pages.config.user.contextLost',
          defaultMessage: 'User context lost, please refresh',
        }),
      );
      return;
    }
    const changeNote = data.changeNote
      ? `${data.changeNote} ${intl.formatMessage({ id: 'pages.config.system.forceOverwriteSuffix', defaultMessage: '(force overwrite)' })}`
      : intl.formatMessage({
          id: 'pages.config.system.forceOverwriteSuffix',

          defaultMessage: '(force overwrite)',
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
        intl.formatMessage({
          id: 'pages.config.user.contextLost',
          defaultMessage: 'User context lost, please refresh',
        }),
      );
      return;
    }
    // version 应该总是存在的（从冲突数据或原始数据中获取）
    if (!data.version) {
      message.error(
        intl.formatMessage({
          id: 'pages.config.user.versionRequired',
          defaultMessage: 'Version is required for force delete',
        }),
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
        intl.formatMessage({
          id: 'pages.config.user.deleteSuccess',
          defaultMessage:
            'User override deleted, reverted to system default value',
        }),
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
            intl.formatMessage({
              id: 'pages.roles.operationFailed',
              defaultMessage: 'Operation failed',
            }),
          ),
        );
      }
    }
  };

  /** 打开编辑 */
  const handleEdit = (item: UserConfigItem) => {
    editModal.open(item);
  };

  /** 提交编辑 */
  const handleEditFinish = async (values: {
    value: unknown;
    change_note?: string;
  }) => {
    if (!editModal.state.record || !userId) return false;
    try {
      await setUserConfig(userId, editModal.state.record.key, {
        value: values.value,
        version: editModal.state.record.version,
        change_note: values.change_note,
      });
      message.success(
        intl.formatMessage({
          id: 'pages.config.user.updateSuccess',
          defaultMessage: 'User config updated successfully',
        }),
      );
      editModal.close();
      loadConfigs();
      return true;
    } catch (error: unknown) {
      // 使用 hook 处理乐观锁冲突
      const handled = handleEditError(error, {
        key: editModal.state.record.key,
        value: values.value,
        changeNote: values.change_note,
      });
      if (handled) {
        editModal.close();
        return true;
      }
      // 非冲突错误，显示普通错误消息
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.roles.operationFailed',
            defaultMessage: 'Operation failed',
          }),
        ),
      );
      return false;
    }
  };

  /** 打开历史 */
  const handleViewHistory = (item: UserConfigItem) => {
    historyModal.open(item);
  };

  /** Table columns */
  const columns = useMemo<ProColumns<UserConfigItem>[]>(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.config.user.key',

          defaultMessage: 'Config Key',
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

          defaultMessage: 'Effective Value',
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

          defaultMessage: 'Source',
        }),
        dataIndex: 'source',
        width: 100,
        render: (_, record) => renderConfigSource(record.source),
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.user.systemValue',

          defaultMessage: 'System Value',
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

          defaultMessage: 'Actions',
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

                  defaultMessage: 'Edit',
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

                        defaultMessage: 'History',
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

                                  defaultMessage:
                                    'Confirm delete user override?',
                                })}
                                description={intl.formatMessage({
                                  id: 'pages.config.user.confirmDeleteDesc',

                                  defaultMessage:
                                    'After deletion, it will revert to system default value',
                                })}
                                onConfirm={() => handleDelete(record)}
                                okText={intl.formatMessage({
                                  id: 'pages.config.user.confirm',

                                  defaultMessage: 'Confirm',
                                })}
                                cancelText={intl.formatMessage({
                                  id: 'pages.config.user.cancel',

                                  defaultMessage: 'Cancel',
                                })}
                              >
                                <span className="text-red-500">
                                  {intl.formatMessage({
                                    id: 'pages.config.user.deleteOverride',

                                    defaultMessage: 'Delete Override',
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
        title={`${intl.formatMessage({ id: 'pages.config.user.drawerTitle', defaultMessage: 'User Configs: ' })}${user.name || user.email || user.id}`}
        open={open}
        onClose={onClose}
        // NOTE: Drawer 宽度未使用 useResponsiveModalWidth()，因为 Drawer 通常需要比 Modal 更宽
        // 以容纳表格等复杂内容。此处 900px 是 Drawer 的常用宽度，移动端使用 90% 保证可读性。
        width={isMobile ? '90%' : 900}
        destroyOnHidden
      >
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item
            label={intl.formatMessage({
              id: 'pages.config.user.userId',
              defaultMessage: 'User ID',
            })}
          >
            <Text copyable>{user.id}</Text>
          </Descriptions.Item>
          <Descriptions.Item
            label={intl.formatMessage({
              id: 'pages.config.user.email',
              defaultMessage: 'Email',
            })}
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
                locale={tableLocale}
              />
            ),
          }))}
        />
      </Drawer>

      {/* 编辑弹窗 */}
      {editModal.state.record && (
        <UserConfigEditModal
          open={editModal.state.open}
          onOpenChange={editModal.close}
          item={editModal.state.record}
          onFinish={handleEditFinish}
        />
      )}

      {/* 历史弹窗 */}
      {historyModal.state.record && userId && (
        <UserConfigHistoryModal
          open={historyModal.state.open}
          onOpenChange={historyModal.close}
          userId={userId}
          item={historyModal.state.record}
          onRollbackSuccess={() => {
            historyModal.close();
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
