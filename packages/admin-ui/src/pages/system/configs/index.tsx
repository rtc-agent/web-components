import { HistoryOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useAccess, useIntl } from '@umijs/max';
import { App, Button, Popconfirm, Space, Tabs, Tag } from 'antd';
import React, { useCallback, useRef, useState } from 'react';
import type {
  OptimisticLockConflictData,
  ServerConfigItem,
} from '@/services/serverConfig';
import {
  deleteServerConfig,
  getServerConfigList,
  updateServerConfig,
} from '@/services/serverConfig';
import {
  formatConfigValue,
  truncateValue,
  useConfigSourceRenderer,
} from '@/utils/configFormat';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import ConfigEditModal from './components/ConfigEditModal';
import ConfigHistoryModal from './components/ConfigHistoryModal';
import ConflictModal from './components/ConflictModal';

/**
 * 配置分类列表
 * NOTE: 这些分类应与后端 server/configs 中定义的 category 保持一致。
 * 如果后端新增/修改分类，需同步更新此列表。
 */
const CATEGORIES = [
  { key: '', labelId: 'pages.config.system.all', defaultLabel: '全部' },
  {
    key: 'llm',
    labelId: 'pages.config.system.category.llm',
    defaultLabel: 'LLM',
  },
  {
    key: 'worker',
    labelId: 'pages.config.system.category.worker',
    defaultLabel: 'Worker',
  },
  {
    key: 'feature',
    labelId: 'pages.config.system.category.feature',
    defaultLabel: '功能开关',
  },
  {
    key: 'storage',
    labelId: 'pages.config.system.category.storage',
    defaultLabel: '存储',
  },
  {
    key: 'asynq',
    labelId: 'pages.config.system.category.asynq',
    defaultLabel: 'Asynq',
  },
  {
    key: 'web_search',
    labelId: 'pages.config.system.category.webSearch',
    defaultLabel: '搜索',
  },
  {
    key: 'web_fetch',
    labelId: 'pages.config.system.category.webFetch',
    defaultLabel: '抓取',
  },
  {
    key: 'api',
    labelId: 'pages.config.system.category.api',
    defaultLabel: 'API',
  },
  {
    key: 'log',
    labelId: 'pages.config.system.category.log',
    defaultLabel: '日志',
  },
];

/**
 * 系统配置管理页面
 */
const SystemConfigsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const { message } = App.useApp();
  const renderConfigSource = useConfigSourceRenderer();
  const canEdit = access.canServerConfigEdit as boolean;
  const canDelete = access.canServerConfigDelete as boolean;

  const [activeCategory, setActiveCategory] = useState('');
  const [editingConfig, setEditingConfig] = useState<ServerConfigItem | null>(
    null,
  );
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyConfigKey, setHistoryConfigKey] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  // 乐观锁冲突
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] =
    useState<OptimisticLockConflictData | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<{
    key: string;
    value: unknown;
    changeNote?: string;
  } | null>(null);

  /** 刷新列表 */
  const reload = useCallback(() => {
    actionRef.current?.reload();
  }, []);

  /** 打开编辑 */
  const handleEdit = (record: ServerConfigItem) => {
    setEditingConfig(record);
    setEditModalOpen(true);
  };

  /** 打开历史 */
  const handleViewHistory = (record: ServerConfigItem) => {
    setHistoryConfigKey(record.key);
    setHistoryVersion(record.version);
    setHistoryModalOpen(true);
  };

  /** 处理编辑提交 */
  const handleEditFinish = async (values: {
    value: unknown;
    change_note?: string;
  }) => {
    if (!editingConfig) return false;
    try {
      await updateServerConfig(editingConfig.key, {
        value: values.value,
        version: editingConfig.version,
        change_note: values.change_note,
      });
      message.success(
        intl.formatMessage({ id: 'pages.config.system.updateSuccess' }),
      );
      setEditModalOpen(false);
      reload();
      return true;
    } catch (error: unknown) {
      const err = error as {
        info?: {
          errorCode?: string;
          data?: OptimisticLockConflictData;
        };
      };
      if (err?.info?.errorCode === 'OPTIMISTIC_LOCK_CONFLICT') {
        // 关闭编辑弹窗，弹出冲突对话框接管
        const conflictInfo = err.info.data as OptimisticLockConflictData | undefined;
        if (conflictInfo) {
          setConflictData(conflictInfo);
          setPendingOverwrite({
            key: editingConfig.key,
            value: values.value,
            changeNote: values.change_note,
          });
          setConflictModalOpen(true);
          setEditModalOpen(false);
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

  /** 处理删除 */
  const handleDelete = async (record: ServerConfigItem) => {
    try {
      await deleteServerConfig(record.key, record.version);
      message.success(
        intl.formatMessage({ id: 'pages.config.system.deleteSuccess' }),
      );
      reload();
    } catch (error: unknown) {
      // 冲突错误使用 getFriendlyErrorMessage 内部的错误码映射
      message.error(getFriendlyErrorMessage(error));
    }
  };

  /** 冲突对话框 - 重新加载 */
  const handleConflictReload = () => {
    setConflictModalOpen(false);
    setConflictData(null);
    setPendingOverwrite(null);
    reload();
  };

  /** 冲突对话框 - 强制覆盖（设计文档 §4.5：不传 version 跳过版本检查） */
  const handleForceOverwrite = async () => {
    if (!pendingOverwrite) return;
    try {
      await updateServerConfig(pendingOverwrite.key, {
        value: pendingOverwrite.value,
        change_note: pendingOverwrite.changeNote
          ? `${pendingOverwrite.changeNote} ${intl.formatMessage({ id: 'pages.config.system.forceOverwriteSuffix' })}`
          : intl.formatMessage({
              id: 'pages.config.system.forceOverwriteSuffix',
            }),
      });
      message.success(
        intl.formatMessage({ id: 'pages.config.system.forceOverwriteSuccess' }),
      );
      setConflictModalOpen(false);
      setConflictData(null);
      setPendingOverwrite(null);
      reload();
    } catch (error: unknown) {
      message.error(getFriendlyErrorMessage(error));
    }
  };

  /** 格式化配置值，bool 特殊处理 */
  const formatDisplayValue = (value: unknown, valueType: string): string => {
    if (value === null || value === undefined) return '-';
    if (valueType === 'bool') return value ? 'true' : 'false';
    return formatConfigValue(value);
  };

  /** 表格列 */
  const columns: ProColumns<ServerConfigItem>[] = [
    {
      title: 'Key',
      dataIndex: 'key',
      width: 260,
      ellipsis: true,
      render: (_, record) => (
        <code style={{ fontSize: 12, wordBreak: 'break-all' }}>
          {record.key}
        </code>
      ),
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.value' }),
      dataIndex: 'value',
      ellipsis: true,
      search: false,
      render: (_, record) => {
        const displayValue =
          record.source === 'yaml' ? record.yaml_default : record.value;
        const formatted = formatDisplayValue(displayValue, record.value_type);
        return (
          <span
            title={formatted}
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              maxWidth: 300,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {formatted}
          </span>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.yamlDefault' }),
      dataIndex: 'yaml_default',
      ellipsis: true,
      search: false,
      width: 150,
      render: (_, record) => {
        const formatted = formatDisplayValue(
          record.yaml_default,
          record.value_type,
        );
        return (
          <span
            title={formatted}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          >
            {truncateValue(formatted, 30)}
          </span>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.source' }),
      dataIndex: 'source',
      width: 100,
      search: false,
      render: (_, record) => renderConfigSource(record.source),
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.type' }),
      dataIndex: 'value_type',
      width: 80,
      search: false,
      render: (_, record) => <Tag>{record.value_type}</Tag>,
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.version' }),
      dataIndex: 'version',
      width: 70,
      search: false,
      render: (_, record) =>
        record.version > 0 ? (
          <Tag color="blue">v{record.version}</Tag>
        ) : (
          <Tag>v0</Tag>
        ),
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.updatedAt' }),
      dataIndex: 'updated_at',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: (a, b) => {
        if (!a.updated_at) return -1;
        if (!b.updated_at) return 1;
        return (
          new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        );
      },
      render: (_, record) =>
        record.updated_at ? new Date(record.updated_at).toLocaleString() : '-',
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.description' }),
      dataIndex: 'description',
      ellipsis: true,
      search: false,
      width: 200,
    },
    {
      title: intl.formatMessage({ id: 'pages.config.system.actions' }),
      dataIndex: 'option',
      width: 180,
      search: false,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          {canEdit && (
            <Button type="link" size="small" onClick={() => handleEdit(record)}>
              {intl.formatMessage({ id: 'pages.config.system.edit' })}
            </Button>
          )}
          {record.version > 0 && (
            <Button
              type="link"
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => handleViewHistory(record)}
            >
              {intl.formatMessage({ id: 'pages.config.system.history' })}
            </Button>
          )}
          {canDelete && record.source === 'system' && (
            <Popconfirm
              title={intl.formatMessage({
                id: 'pages.config.system.confirmDelete',
              })}
              description={intl.formatMessage({
                id: 'pages.config.system.confirmDeleteDesc',
              })}
              onConfirm={() => handleDelete(record)}
              okText={intl.formatMessage({ id: 'pages.config.system.confirm' })}
              cancelText={intl.formatMessage({
                id: 'pages.config.system.cancel',
              })}
            >
              <Button type="link" size="small" danger>
                {intl.formatMessage({ id: 'pages.config.system.delete' })}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <Tabs
        activeKey={activeCategory}
        onChange={(key) => {
          setActiveCategory(key);
          reload();
        }}
        items={CATEGORIES.map((cat) => ({
          key: cat.key,
          label: intl.formatMessage({
            id: cat.labelId,
            defaultMessage: cat.defaultLabel,
          }),
        }))}
        style={{ marginBottom: 16 }}
      />
      <ProTable<ServerConfigItem>
        headerTitle={intl.formatMessage({ id: 'pages.config.system.title' })}
        actionRef={actionRef}
        rowKey="key"
        search={false}
        scroll={{ x: 1400 }}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
        request={async (params) => {
          try {
            const response = await getServerConfigList({
              category: activeCategory || undefined,
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
        toolBarRender={() => [
          <Button key="refresh" onClick={reload}>
            {intl.formatMessage({ id: 'pages.config.system.refresh' })}
          </Button>,
        ]}
      />

      {/* 编辑弹窗 */}
      <ConfigEditModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        config={editingConfig}
        onFinish={handleEditFinish}
      />

      {/* 历史弹窗 */}
      <ConfigHistoryModal
        open={historyModalOpen}
        onOpenChange={setHistoryModalOpen}
        configKey={historyConfigKey}
        currentVersion={historyVersion}
        onChanged={reload}
      />

      {/* 冲突弹窗 */}
      <ConflictModal
        open={conflictModalOpen}
        onOpenChange={setConflictModalOpen}
        conflictData={conflictData}
        configKey={pendingOverwrite?.key}
        onReload={handleConflictReload}
        onForceOverwrite={handleForceOverwrite}
      />
    </PageContainer>
  );
};

export default SystemConfigsPage;
