import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import {
  ModalForm,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Form,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ConfigHistoryTable from '@/pages/system/configs/components/ConfigHistoryTable';
import ConfigValueInput from '@/pages/system/configs/components/ConfigValueInput';
import ConflictModal from '@/pages/system/configs/components/ConflictModal';
import type { OptimisticLockConflictData } from '@/services/serverConfig';
import type { UserConfigItem } from '@/services/userConfig';
import {
  deleteUserConfig,
  getUserConfigHistory,
  getUserConfigs,
  rollbackUserConfig,
  setUserConfig,
} from '@/services/userConfig';
import {
  formatConfigValue,
  useConfigSourceRenderer,
} from '@/utils/configFormat';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import type { RtcUserInfo } from '../data.d';

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
  const [configs, setConfigs] = useState<UserConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingConfig, setEditingConfig] = useState<UserConfigItem | null>(
    null,
  );
  const [editModalVisible, setEditModalVisible] = useState(false);

  // 历史弹窗
  const [historyItem, setHistoryItem] = useState<UserConfigItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 乐观锁冲突
  const [conflictData, setConflictData] =
    useState<OptimisticLockConflictData | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pendingOverwrite, setPendingOverwrite] = useState<{
    key: string;
    value: unknown;
    changeNote?: string;
  } | null>(null);

  const userId = user?.id;
  const intl = useIntl();
  const { message } = App.useApp();
  const renderConfigSource = useConfigSourceRenderer();

  /** 加载用户配置 */
  const loadConfigs = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await getUserConfigs(userId);
      setConfigs(response.items);
    } catch (error: unknown) {
      message.error(getFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [userId, message]);

  useEffect(() => {
    if (open && userId) {
      loadConfigs();
    }
  }, [open, userId, loadConfigs]);

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
      message.error(getFriendlyErrorMessage(error));
    }
  };

  /** 打开编辑 */
  const handleEdit = (item: UserConfigItem) => {
    setEditingConfig(item);
    setEditModalVisible(true);
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
      setEditModalVisible(false);
      loadConfigs();
      return true;
    } catch (error: unknown) {
      const err = error as {
        info?: {
          errorCode?: string;
          data?: OptimisticLockConflictData;
        };
      };
      if (err?.info?.errorCode === 'OPTIMISTIC_LOCK_CONFLICT') {
        const conflictInfo = err.info.data as OptimisticLockConflictData | undefined;
        if (conflictInfo) {
          setConflictData(conflictInfo);
          setPendingOverwrite({
            key: editingConfig.key,
            value: values.value,
            changeNote: values.change_note,
          });
          setConflictOpen(true);
          setEditModalVisible(false);
          return true;
        }
        // 后端返回冲突错误但缺少冲突详情，降级为普通错误提示
        message.error(getFriendlyErrorMessage(error));
        return false;
      }
      message.error(getFriendlyErrorMessage(error));
      return false;
    }
  };

  /** 强制覆盖 */
  const handleForceOverwrite = async () => {
    if (!pendingOverwrite || !userId) return;
    try {
      await setUserConfig(userId, pendingOverwrite.key, {
        value: pendingOverwrite.value,
        change_note: pendingOverwrite.changeNote
          ? `${pendingOverwrite.changeNote} ${intl.formatMessage({ id: 'pages.config.system.forceOverwriteSuffix' })}`
          : intl.formatMessage({
              id: 'pages.config.system.forceOverwriteSuffix',
            }),
      });
      message.success(
        intl.formatMessage({ id: 'pages.config.user.forceOverwriteSuccess' }),
      );
      setConflictOpen(false);
      setConflictData(null);
      setPendingOverwrite(null);
      loadConfigs();
    } catch (error: unknown) {
      message.error(getFriendlyErrorMessage(error));
    }
  };

  /** 打开历史 */
  const handleViewHistory = (item: UserConfigItem) => {
    setHistoryItem(item);
    setHistoryOpen(true);
  };

  if (!user) return null;

  return (
    <>
      <Drawer
        title={`${intl.formatMessage({ id: 'pages.config.user.drawerTitle' })}${user.name || user.email || user.id}`}
        open={open}
        onClose={onClose}
        styles={{ wrapper: { width: 900 } }}
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
                columns={[
                  {
                    title: 'Key',
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
                      const formatted = formatConfigValue(
                        record.effective_value,
                      );
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
                    width: 160,
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
                          <>
                            <Button
                              type="link"
                              size="small"
                              onClick={() => handleViewHistory(record)}
                            >
                              {intl.formatMessage({
                                id: 'pages.config.user.history',
                              })}
                            </Button>
                            {canDelete && (
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
                                <Button
                                  type="link"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                >
                                  {intl.formatMessage({
                                    id: 'pages.config.user.deleteOverride',
                                  })}
                                </Button>
                              </Popconfirm>
                            )}
                          </>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          }))}
        />
      </Drawer>

      {/* 编辑弹窗 */}
      {editingConfig && (
        <UserConfigEditModal
          open={editModalVisible}
          onOpenChange={setEditModalVisible}
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
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        conflictData={conflictData}
        configKey={pendingOverwrite?.key}
        onReload={() => {
          setConflictOpen(false);
          setConflictData(null);
          setPendingOverwrite(null);
          loadConfigs();
        }}
        onForceOverwrite={handleForceOverwrite}
      />
    </>
  );
};

/** 用户配置编辑弹窗 */
interface UserConfigEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: UserConfigItem;
  onFinish: (values: {
    value: unknown;
    change_note?: string;
  }) => Promise<boolean>;
}

const UserConfigEditModal: React.FC<UserConfigEditModalProps> = ({
  open,
  onOpenChange,
  item,
  onFinish,
}) => {
  const [form] = Form.useForm<{ value: unknown; change_note?: string }>();
  const intl = useIntl();

  useEffect(() => {
    if (open) {
      const currentValue =
        item.user_value ?? item.effective_value ?? item.yaml_default;
      const formValue =
        item.value_type === 'json' && typeof currentValue === 'object'
          ? JSON.stringify(currentValue, null, 2)
          : currentValue;
      form.setFieldsValue({ value: formValue });
    }
  }, [open, item, form]);

  return (
    <ModalForm
      title={`${intl.formatMessage({ id: 'pages.config.user.editTitle' })}${item.key}`}
      form={form}
      open={open}
      onOpenChange={onOpenChange}
      modalProps={{ destroyOnClose: true }}
      onFinish={async (values: { value: unknown; change_note?: string }) => {
        let finalValue = values.value;
        if (item.value_type === 'json' && typeof values.value === 'string') {
          try {
            finalValue = JSON.parse(values.value);
          } catch {
            return false;
          }
        }
        if (item.value_type === 'int' && typeof values.value === 'string') {
          finalValue = Number.parseInt(values.value, 10);
        }
        if (item.value_type === 'float' && typeof values.value === 'string') {
          finalValue = Number.parseFloat(values.value);
        }
        return onFinish({
          value: finalValue,
          change_note: values.change_note,
        });
      }}
    >
      {item.description && (
        <Alert
          type="info"
          showIcon
          title={item.description}
          style={{ marginBottom: 16 }}
        />
      )}
      <ConfigValueInput
        valueType={item.value_type}
        configKey={item.key}
        promptRows={8}
        jsonRows={6}
      />
      <ProFormTextArea
        name="change_note"
        label={intl.formatMessage({ id: 'pages.config.system.changeNote' })}
        placeholder={intl.formatMessage({
          id: 'pages.config.system.changeNotePlaceholder',
        })}
        fieldProps={{ rows: 2, maxLength: 500, showCount: true }}
      />
    </ModalForm>
  );
};

/** 用户配置历史弹窗 */
interface UserConfigHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  item: UserConfigItem;
  onRollbackSuccess: () => void;
}

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
    />
  );
};

export default UserConfigDrawer;
