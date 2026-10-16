import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useAccess, useIntl, useSearchParams } from '@umijs/max';
import { App, Button, Tabs, Tag, theme } from 'antd';
import React, { useCallback, useMemo, useRef } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useModalState } from '@/hooks/useModalState';
import { useOptimisticLockConflict } from '@/hooks/useOptimisticLockConflict';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { usePermissionRefresh } from '@/hooks/usePermissionRefresh';
import { useProTableLocale } from '@/hooks/useProTableLocale';
import {
  formatConfigValue,
  truncateValue,
  useConfigSourceRenderer,
} from '@/utils/configFormat';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { createTableRequest, parseTableSort } from '@/utils/tableUtils';
import ActionColumn from './components/ActionColumn';
import ConfigEditModal from './components/ConfigEditModal';
import ConfigHistoryModal from './components/ConfigHistoryModal';
import ConflictModal from './components/ConflictModal';
import type { ServerConfigPageAPI } from './page-api';
import type { ServerConfigItem } from './service';
import {
  deleteServerConfig,
  getServerConfigList,
  updateServerConfig,
} from './service';

/**
 * Configuration category list
 * NOTE: These categories should match the categories defined in the backend server/configs.
 * If the backend adds/modifies categories, this list should be updated accordingly.
 */
const CATEGORIES = [
  { key: '', labelId: 'pages.config.system.all', defaultLabel: 'All' },
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
    defaultLabel: 'Feature Flags',
  },
  {
    key: 'storage',
    labelId: 'pages.config.system.category.storage',
    defaultLabel: 'Storage',
  },
  {
    key: 'asynq',
    labelId: 'pages.config.system.category.asynq',
    defaultLabel: 'Asynq',
  },
  {
    key: 'web_search',
    labelId: 'pages.config.system.category.webSearch',
    defaultLabel: 'Search',
  },
  {
    key: 'web_fetch',
    labelId: 'pages.config.system.category.webFetch',
    defaultLabel: 'Fetch',
  },
  {
    key: 'api',
    labelId: 'pages.config.system.category.api',
    defaultLabel: 'API',
  },
  {
    key: 'log',
    labelId: 'pages.config.system.category.log',
    defaultLabel: 'Log',
  },
];

/**
 * System Configuration Management Page
 */
const SystemConfigsPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const access = useAccess();
  const intl = useIntl();
  const { message } = App.useApp();
  const renderConfigSource = useConfigSourceRenderer();
  const { token } = theme.useToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile(); // < 768px
  const locale = useProTableLocale(
    'pages.config.system.empty',
    'No configurations found',
  );
  const { refreshPermissions } = usePermissionRefresh();

  // Modal states managed by useModalState hook for consistency
  const editModal = useModalState<ServerConfigItem>();
  const historyModal = useModalState<ServerConfigItem>();

  // Derive active category directly from URL (single source of truth)
  const activeCategory = searchParams.get('category') || '';

  /** Reload table */
  const reload = useCallback(() => {
    actionRef.current?.reload();
  }, []);

  /** Force overwrite (design doc 4.5: skip version check by not passing version) */
  const doForceOverwrite = async (data: {
    key: string;
    value: unknown;
    changeNote?: string;
  }) => {
    const changeNote = data.changeNote
      ? `${data.changeNote} ${intl.formatMessage({ id: 'pages.config.system.forceOverwriteSuffix', defaultMessage: '(force overwrite)' })}`
      : intl.formatMessage({
          id: 'pages.config.system.forceOverwriteSuffix',
          defaultMessage: '(force overwrite)',
        });
    await updateServerConfig(data.key, {
      value: data.value,
      change_note: changeNote,
    });
  };

  /** Force delete (skip version check by passing version=0) */
  const doForceDelete = async (data: { key: string; version?: number }) => {
    await deleteServerConfig(data.key, data.version || 0);
  };

  // Optimistic lock conflict handling
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
    onConflictResolved: reload,
    forceOverwriteSuccessId: 'pages.config.system.forceOverwriteSuccess',
    forceOverwriteSuffixId: 'pages.config.system.forceOverwriteSuffix',
    forceDeleteSuccessId: 'pages.config.system.forceDeleteSuccess',
  });

  /** Open edit modal */
  const handleEdit = (record: ServerConfigItem) => {
    editModal.open(record);
  };

  /** Open history modal */
  const handleViewHistory = (record: ServerConfigItem) => {
    historyModal.open(record);
  };

  /** Handle edit submission */
  const handleEditFinish = async (values: {
    value: unknown;
    change_note?: string;
  }) => {
    if (!editModal.state.record) return false;
    try {
      await updateServerConfig(editModal.state.record.key, {
        value: values.value,
        version: editModal.state.record.version,
        change_note: values.change_note,
      });
      message.success(
        intl.formatMessage({
          id: 'pages.config.system.updateSuccess',
          defaultMessage: 'Config updated successfully',
        }),
      );
      editModal.close();
      reload();
      return true;
    } catch (error: unknown) {
      // Use hook to handle optimistic lock conflict.
      // When a version conflict is detected, handleEditError shows a dedicated
      // conflict modal (with force-overwrite option) and returns true.
      // We close the edit modal here because the user must re-confirm their
      // intent through the conflict resolution flow.
      // Return true to signal to ProForm that the error has been fully handled
      // — no further error processing or modal state management is needed
      // at the caller level.
      const handled = handleEditError(error, {
        key: editModal.state.record.key,
        value: values.value,
        changeNote: values.change_note,
      });
      if (handled) {
        editModal.close();
        return true;
      }
      // Non-conflict error, show normal error message
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.config.system.operationFailed',
            defaultMessage: 'Operation failed',
          }),
        ),
      );
      return false;
    }
  };

  /** Handle delete */
  const handleDelete = async (record: ServerConfigItem) => {
    // Refresh permissions before sensitive operation to ensure they are current
    await refreshPermissions({ showErrorMessage: true });

    // Re-check permission after refresh
    if (!access.canServerConfigDelete) {
      message.error(
        intl.formatMessage({
          id: 'pages.permission.denied',
          defaultMessage: 'Permission denied',
        }),
      );
      return;
    }

    try {
      await deleteServerConfig(record.key, record.version);
      message.success(
        intl.formatMessage({
          id: 'pages.config.system.deleteSuccess',
          defaultMessage: 'Config deleted, reverted to YAML default value',
        }),
      );
      reload();
    } catch (error: unknown) {
      // Check if it's an optimistic lock conflict
      const handled = handleDeleteError(error, { key: record.key });
      if (!handled) {
        // Non-conflict error, show normal error message
        message.error(
          getFriendlyErrorMessage(
            error,
            intl,
            intl.formatMessage({
              id: 'pages.config.system.operationFailed',
              defaultMessage: 'Operation failed',
            }),
          ),
        );
      }
    }
  };

  /** Format config value, special handling for bool */
  const formatDisplayValue = useCallback(
    (value: unknown, valueType: string): string => {
      if (value === null || value === undefined) return '-';
      if (valueType === 'bool') return value ? 'true' : 'false';
      return formatConfigValue(value);
    },
    [],
  );

  /** Table columns */
  const columns: ProColumns<ServerConfigItem>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.config.system.key',
          defaultMessage: 'Key',
        }),
        dataIndex: 'key',
        width: 260,
        ellipsis: true,
        render: (_, record) => (
          <code
            style={{
              fontSize: 12,
              wordBreak: 'break-all',
              background: token.colorBgTextHover,
              padding: token.paddingXXS,
              borderRadius: token.borderRadiusSM,
            }}
          >
            {record.key}
          </code>
        ),
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.value',
          defaultMessage: 'Value',
        }),
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
        title: intl.formatMessage({
          id: 'pages.config.system.yamlDefault',
          defaultMessage: 'YAML Default',
        }),
        dataIndex: 'yaml_default',
        ellipsis: true,
        search: false,
        width: 150,
        hideInTable: isMobile,
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
        title: intl.formatMessage({
          id: 'pages.config.system.source',
          defaultMessage: 'Source',
        }),
        dataIndex: 'source',
        width: 100,
        search: false,
        render: (_, record) => renderConfigSource(record.source),
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.type',
          defaultMessage: 'Type',
        }),
        dataIndex: 'value_type',
        width: 80,
        search: false,
        render: (_, record) => <Tag>{record.value_type}</Tag>,
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.version',
          defaultMessage: 'Version',
        }),
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
        title: intl.formatMessage({
          id: 'pages.config.system.updatedAt',
          defaultMessage: 'Updated At',
        }),
        dataIndex: 'updated_at',
        valueType: 'dateTime',
        width: 180,
        search: false,
        sorter: true,
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.description',
          defaultMessage: 'Description',
        }),
        dataIndex: 'description',
        ellipsis: true,
        search: false,
        width: 200,
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.config.system.actions',
          defaultMessage: 'Actions',
        }),
        dataIndex: 'option',
        width: 180,
        search: false,
        fixed: 'right',
        render: (_, record) => (
          <ActionColumn
            record={record}
            intl={intl}
            access={access}
            onEdit={handleEdit}
            onViewHistory={handleViewHistory}
            onDelete={handleDelete}
          />
        ),
      },
    ],
    [intl, token, isMobile, renderConfigSource, formatDisplayValue],
  );

  // Register Page API for function handlers
  usePageAPIRegistration(
    'serverConfig',
    useCallback(
      (): ServerConfigPageAPI => ({
        list: async (params) => {
          try {
            // Sync URL with category
            const newSearchParams = new URLSearchParams();
            if (params?.category) {
              newSearchParams.set('category', params.category);
            }
            setSearchParams(newSearchParams, { replace: true });

            const response = await getServerConfigList({
              category: params?.category,
              page: params?.current,
              page_size: params?.pageSize,
            });
            return {
              data: response.items,
              total: response.total,
              success: true,
            };
          } catch (error) {
            console.error('[ServerConfigPageAPI] list failed:', {
              params,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.config.system.loadFailed',
                  defaultMessage: 'Failed to load configuration list',
                }),
              ),
            );
            return { data: [], total: 0, success: false };
          }
        },
        refresh: async () => {
          actionRef.current?.reload();
        },
        update: async (data) => {
          try {
            await updateServerConfig(data.key, {
              value: data.value,
              version: data.version,
              change_note: data.change_note,
            });
            actionRef.current?.reload();
            return { success: true };
          } catch (error) {
            console.error('[ServerConfigPageAPI] update failed:', {
              key: data.key,
              version: data.version,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.config.system.updateFailed',
                  defaultMessage: 'Failed to update configuration',
                }),
              ),
            );
            return { success: false };
          }
        },
        remove: async (data) => {
          try {
            await deleteServerConfig(data.key, data.version);
            actionRef.current?.reload();
            return { success: true };
          } catch (error) {
            console.error('[ServerConfigPageAPI] remove failed:', {
              key: data.key,
              version: data.version,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.config.system.deleteFailed',
                  defaultMessage: 'Failed to delete configuration',
                }),
              ),
            );
            return { success: false };
          }
        },
      }),
      [],
    ),
  );

  return (
    <PageContainer>
      <Tabs
        activeKey={activeCategory}
        onChange={(key) => {
          const newSearchParams = new URLSearchParams();
          if (key) {
            newSearchParams.set('category', key);
          }
          setSearchParams(newSearchParams, { replace: true });
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
        headerTitle={intl.formatMessage({
          id: 'pages.config.system.title',
          defaultMessage: 'System Configs',
        })}
        actionRef={actionRef}
        rowKey="key"
        search={false}
        scroll={{ x: 'max-content' }}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
        request={createTableRequest(
          async (params, sort) => {
            // Read category from searchParams (URL is single source of truth)
            const category = searchParams.get('category') || '';
            const sortParams = parseTableSort(sort || {});
            const response = await getServerConfigList({
              category: category || undefined,
              page: params.current,
              page_size: params.pageSize,
              ...sortParams,
            });
            return {
              items: response.items,
              total: response.total,
            };
          },
          message,
          intl,
          {
            id: 'pages.config.system.loadFailed',
            defaultMessage: 'Failed to load configs',
          },
        )}
        columns={columns}
        toolBarRender={() => [
          <Button key="refresh" onClick={reload}>
            {intl.formatMessage({
              id: 'pages.config.system.refresh',
              defaultMessage: 'Refresh',
            })}
          </Button>,
        ]}
        locale={locale}
      />

      {/* Edit modal */}
      <ConfigEditModal
        open={editModal.state.open}
        onOpenChange={editModal.close}
        config={editModal.state.record ?? null}
        onFinish={handleEditFinish}
      />

      {/* History modal */}
      <ConfigHistoryModal
        open={historyModal.state.open}
        onOpenChange={historyModal.close}
        configKey={historyModal.state.record?.key ?? null}
        currentVersion={historyModal.state.record?.version ?? 0}
        onChanged={reload}
      />

      {/* Conflict modal */}
      <ConflictModal
        open={conflictModalOpen}
        onOpenChange={setConflictModalOpen}
        conflictData={conflictData}
        configKey={pendingAction?.data.key}
        actionType={pendingAction?.type}
        onReload={handleConflictReload}
        onForceAction={handleForceAction}
      />
    </PageContainer>
  );
};

export default SystemConfigsPage;
