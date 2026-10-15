import {
  CheckCircleOutlined,
  DownOutlined,
  EyeOutlined,
  MessageOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ModalForm,
  PageContainer,
  ProFormTextArea,
  ProTable,
} from '@ant-design/pro-components';
import {
  Access,
  history,
  useAccess,
  useIntl,
} from '@umijs/max';
import { App, Button, Dropdown, Popconfirm, Space, Tag, Tooltip } from 'antd';
import React, {
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { TableEmptyState } from '@/components';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useModalState } from '@/hooks/useModalState';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { useTableSearchParams } from '@/hooks/useTableSearchParams';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { createTableRequest, parseTableSort } from '@/utils/tableUtils';
import UserConfigDrawer from './components/UserConfigDrawer';
import UserDetailDrawer from './components/UserDetailDrawer';
import type { RtcUserInfo } from './data';
import type { RtcUserPageAPI } from './page-api';
import {
  banRtcUser,
  getRtcUserList,
  getUserDevices,
  getUserTokenStats,
  unbanRtcUser,
} from './service';

/**
 * Action column component with memoization to prevent unnecessary re-renders
 */
const ActionColumn = React.memo<{
  record: RtcUserInfo;
  intl: {
    formatMessage: (descriptor: {
      id: string;
      defaultMessage?: string;
    }) => string;
  };
  access: ReturnType<typeof useAccess>;
  canBan: boolean;
  onBan: (user: RtcUserInfo) => void;
  onUnban: (userId: string) => void;
  onConfig: (user: RtcUserInfo) => void;
  onDetail: (user: RtcUserInfo) => void;
}>(({ record, intl, access, canBan, onBan, onUnban, onConfig, onDetail }) => {
  const isBanned = record.status === 'banned';

  // Memoize filtered menu items based on permissions
  const moreItems = useMemo(() => {
    const allMoreItems = [
      {
        key: 'config',
        label: intl.formatMessage({
          id: 'pages.rtcUsers.config',
          defaultMessage: 'Config',
        }),
        icon: <SettingOutlined />,
        onClick: () => onConfig(record),
      },
      {
        key: 'sessions',
        label: intl.formatMessage({
          id: 'pages.rtcUsers.viewSessions',
          defaultMessage: 'Sessions',
        }),
        icon: <MessageOutlined />,
        onClick: () => history.push(`/rtc-users/sessions?user_id=${record.id}`),
      },
    ];

    return allMoreItems.filter((item) => {
      if (item.key === 'config') {
        /**
         * Permission Reuse:
         * RTC user config uses canServerConfigEdit (server_config:write) permission.
         * Audit logs will record this as "server_config" write operation with
         * context field indicating "rtc_user_config" resource type.
         *
         * See: src/access.ts for permission reuse design rationale
         */
        return access.canServerConfigEdit;
      }
      if (item.key === 'sessions') {
        return access.canRtcSessionView;
      }
      return true;
    });
  }, [record, intl, access, onConfig]);

  // Check if any dropdown item is visible (union of child permissions)
  const hasDropdownAccess = moreItems.length > 0;

  return (
    <Space size={0}>
      <Tooltip
        title={intl.formatMessage({
          id: 'pages.rtcUsers.detail.viewDetail',
          defaultMessage: 'View details',
        })}
      >
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined />}
          aria-label={intl.formatMessage({
            id: 'pages.rtcUsers.detail.viewDetail',
            defaultMessage: 'View details',
          })}
          onClick={() => onDetail(record)}
        />
      </Tooltip>
      <Access accessible={access.canRtcUserBan} fallback={null}>
        {!isBanned && canBan && (
          <Tooltip
            title={intl.formatMessage({
              id: 'pages.rtcUsers.ban',
              defaultMessage: 'Ban',
            })}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<StopOutlined />}
              aria-label={intl.formatMessage({
                id: 'pages.rtcUsers.ban',
                defaultMessage: 'Ban',
              })}
              onClick={() => onBan(record)}
            />
          </Tooltip>
        )}
        {isBanned && canBan && (
          <Popconfirm
            title={intl.formatMessage({
              id: 'pages.rtcUsers.confirmUnban',
              defaultMessage: 'Are you sure you want to unban this user?',
            })}
            onConfirm={() => onUnban(record.id)}
            okText={intl.formatMessage({
              id: 'pages.rtcUsers.confirm',
              defaultMessage: 'Confirm',
            })}
            cancelText={intl.formatMessage({
              id: 'pages.rtcUsers.cancel',
              defaultMessage: 'Cancel',
            })}
          >
            <Tooltip
              title={intl.formatMessage({
                id: 'pages.rtcUsers.unban',
                defaultMessage: 'Unban',
              })}
            >
              <Button
                type="text"
                size="small"
                icon={<CheckCircleOutlined />}
                aria-label={intl.formatMessage({
                  id: 'pages.rtcUsers.unban',
                  defaultMessage: 'Unban',
                })}
              />
            </Tooltip>
          </Popconfirm>
        )}
      </Access>
      {hasDropdownAccess && (
        <Dropdown menu={{ items: moreItems }} trigger={['click']}>
          <Tooltip
            title={intl.formatMessage({
              id: 'pages.rtcUsers.more',
              defaultMessage: 'More',
            })}
          >
            <Button
              type="text"
              size="small"
              icon={<DownOutlined />}
              aria-label={intl.formatMessage({
                id: 'pages.rtcUsers.more',
                defaultMessage: 'More',
              })}
            />
          </Tooltip>
        </Dropdown>
      )}
    </Space>
  );
});

ActionColumn.displayName = 'ActionColumn';

/**
 * RTC User Management Page
 */
const RtcUserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  // Use separate useModalState hooks for each modal for better type safety and cleaner API
  const banModal = useModalState<RtcUserInfo>();
  const configModal = useModalState<RtcUserInfo>();
  const detailModal = useModalState<RtcUserInfo>();
  const access = useAccess();
  const intl = useIntl();
  const { message } = App.useApp();
  const tableParams = useTableSearchParams<{
    search: string;
    status: string;
  }>();
  const isMobile = useIsMobile(); // < 768px
  const canBan = access.canRtcUserBan;
  /**
   * Permission Reuse Design with Audit Trail
   *
   * RTC user configuration management reuses system configuration permissions
   * (server_config:write / server_config:delete) rather than defining independent
   * permission points. This design decision is documented in access.ts.
   *
   * Audit Trail:
   * To distinguish between global system config changes and RTC user config changes
   * in audit logs, all RTC user config write operations include a context annotation
   * (see UserConfigDrawer and service calls). This ensures audit logs can trace
   * which resource type was modified, even though the permission point is shared.
   *
   * Permission Mapping:
   * - canConfigEdit   -> server_config:write (PERM_SERVER_CONFIG_WRITE)
   * - canConfigDelete -> server_config:delete (PERM_SERVER_CONFIG_DELETE)
   *
   * Related:
   * - src/access.ts: Permission reuse documentation
   * - src/pages/system/configs/index.tsx: System config page (same permissions)
   * - src/services/audit-log.ts: Audit log service (context field distinguishes resources)
   */
  const canConfigEdit = access.canServerConfigEdit as boolean;
  const canConfigDelete = access.canServerConfigDelete as boolean;

  // === Register Page API ===
  usePageAPIRegistration(
    'rtcUser',
    useCallback(
      (): RtcUserPageAPI => ({
        // Sync URL filters and trigger table reload
        list: async (params = {}) => {
          const { search, status } = params;

          // Sync filters to URL (no page refresh). Pagination is transient state, not synced.
          tableParams.set({ search, status });

          // Trigger table reload via actionRef (ProTable request will handle data fetching)
          actionRef.current?.reload();

          return {
            success: true,
            data: [],
            total: 0,
          };
        },

        // Refresh table
        refresh: async () => {
          actionRef.current?.reload();
        },

        // Ban RTC user
        ban: async (data) => {
          try {
            await banRtcUser(data.userId, { reason: data.reason });
            actionRef.current?.reload();
            return { success: true };
          } catch (error) {
            console.error('[RtcUser Page API] ban failed:', {
              userId: data.userId,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.rtcUsers.banFailed',
                  defaultMessage: 'Failed to ban user',
                }),
              ),
            );
            return { success: false, error: 'Failed to ban user' };
          }
        },

        // Unban RTC user
        unban: async (userId) => {
          try {
            await unbanRtcUser(userId);
            actionRef.current?.reload();
            return { success: true };
          } catch (error) {
            console.error('[RtcUser Page API] unban failed:', {
              userId,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.rtcUsers.unbanFailed',
                  defaultMessage: 'Failed to unban user',
                }),
              ),
            );
            return { success: false, error: 'Failed to unban user' };
          }
        },

        // Get user devices
        devices: async (userId) => {
          try {
            const response = await getUserDevices(userId);
            return {
              success: true,
              data: response.items,
            };
          } catch (error) {
            console.error('[RtcUser Page API] devices failed:', {
              userId,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.rtcUsers.devicesFailed',
                  defaultMessage: 'Failed to fetch user devices',
                }),
              ),
            );
            return {
              success: false,
              data: [],
              error: 'Failed to fetch user devices',
            };
          }
        },

        // Get token statistics
        tokenStats: async (userId, days = 30) => {
          try {
            const response = await getUserTokenStats(userId, days);
            return {
              success: true,
              data: response,
            };
          } catch (error) {
            console.error('[RtcUser Page API] tokenStats failed:', {
              userId,
              days,
              error,
            });
            message.error(
              getFriendlyErrorMessage(
                error,
                intl,
                intl.formatMessage({
                  id: 'pages.rtcUsers.tokenStatsFailed',
                  defaultMessage: 'Failed to fetch token statistics',
                }),
              ),
            );
            return {
              success: false,
              data: {
                daily_stats: [],
                summary: {
                  today_tokens: 0,
                  week_tokens: 0,
                  month_tokens: 0,
                  total_tokens: 0,
                },
                top_sessions: [],
              },
              error: 'Failed to fetch token statistics',
            };
          }
        },
      }),
      [tableParams],
    ),
  );

  /** Ban user */
  const handleBanUser = async (values: { reason: string }) => {
    if (!banModal.state.record) return false;
    try {
      await banRtcUser(banModal.state.record.id, { reason: values.reason });
      message.success(
        intl.formatMessage({
          id: 'pages.rtcUsers.banSuccess',
          defaultMessage: 'User banned successfully',
        }),
      );
      banModal.close();
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      console.error('[RtcUser Management] ban failed:', {
        userId: banModal.state.record.id,
        error,
      });
      message.error(
        getFriendlyErrorMessage(
          error,
          intl,
          intl.formatMessage({
            id: 'pages.rtcUsers.banFailed',
            defaultMessage: 'Failed to ban user',
          }),
        ),
      );
      return false;
    }
  };

  /** Unban user */
  const handleUnbanUser = useCallback(
    async (userId: string) => {
      try {
        await unbanRtcUser(userId);
        message.success(
          intl.formatMessage({
            id: 'pages.rtcUsers.unbanSuccess',
            defaultMessage: 'User unbanned successfully',
          }),
        );
        actionRef.current?.reload();
      } catch (error: unknown) {
        console.error('[RtcUser Management] unban failed:', {
          userId,
          error,
        });
        message.error(
          getFriendlyErrorMessage(
            error,
            intl,
            intl.formatMessage({
              id: 'pages.rtcUsers.unbanFailed',
              defaultMessage: 'Failed to unban user',
            }),
          ),
        );
      }
    },
    [intl, message],
  );

  // Memoized handlers for action column
  const handleBanClick = useCallback(
    (user: RtcUserInfo) => {
      banModal.open(user);
    },
    [banModal],
  );

  const handleConfigClick = useCallback(
    (user: RtcUserInfo) => {
      configModal.open(user);
    },
    [configModal],
  );

  const handleDetailClick = useCallback(
    (user: RtcUserInfo) => {
      detailModal.open(user);
    },
    [detailModal],
  );

  /** Table column definitions */
  const columns: ProColumns<RtcUserInfo>[] = useMemo(
    () => [
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.userId',
          defaultMessage: 'User ID',
        }),
        dataIndex: 'id',
        valueType: 'text',
        hideInTable: true,
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.searchPlaceholder',
          defaultMessage: 'Search by email or name',
        }),
        dataIndex: 'search',
        valueType: 'text',
        hideInTable: true,
        fieldProps: {
          placeholder: intl.formatMessage({
            id: 'pages.rtcUsers.searchPlaceholder',
            defaultMessage: 'Search by email or name',
          }),
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.email',
          defaultMessage: 'Email',
        }),
        dataIndex: 'email',
        valueType: 'text',
        copyable: true,
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.name',
          defaultMessage: 'Name',
        }),
        dataIndex: 'name',
        valueType: 'text',
        search: false,
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.provider',
          defaultMessage: 'Provider',
        }),
        dataIndex: 'provider',
        valueType: 'text',
        search: false,
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.status',
          defaultMessage: 'Status',
        }),
        dataIndex: 'status',
        valueType: 'select',
        valueEnum: {
          active: {
            text: intl.formatMessage({
              id: 'pages.rtcUsers.statusActive',
              defaultMessage: 'Active',
            }),
            status: 'Success',
          },
          banned: {
            text: intl.formatMessage({
              id: 'pages.rtcUsers.statusBanned',
              defaultMessage: 'Banned',
            }),
            status: 'Error',
          },
        },
        render: (_, record) => {
          const isBanned = record.status === 'banned';
          return (
            <Tag color={isBanned ? 'red' : 'green'}>
              {isBanned
                ? intl.formatMessage({
                    id: 'pages.rtcUsers.statusBanned',
                    defaultMessage: 'Banned',
                  })
                : intl.formatMessage({
                    id: 'pages.rtcUsers.statusActive',
                    defaultMessage: 'Active',
                  })}
            </Tag>
          );
        },
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.bannedReason',
          defaultMessage: 'Ban reason',
        }),
        dataIndex: 'banned_reason',
        valueType: 'text',
        search: false,
        ellipsis: true,
        hideInTable: isMobile,
        render: (_, record) => record.banned_reason || '-',
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.bannedAt',
          defaultMessage: 'Ban time',
        }),
        dataIndex: 'banned_at',
        valueType: 'dateTime',
        search: false,
        hideInTable: isMobile,
        render: (_, record) => record.banned_at || '-',
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.createdAt',
          defaultMessage: 'Created at',
        }),
        dataIndex: 'created_at',
        valueType: 'dateTime',
        search: false,
        sorter: true,
        defaultSortOrder: 'descend',
        hideInTable: isMobile,
      },
      {
        title: intl.formatMessage({
          id: 'pages.rtcUsers.actions',
          defaultMessage: 'Action',
        }),
        dataIndex: 'option',
        valueType: 'option',
        width: 160,
        render: (_, record) => (
          <ActionColumn
            record={record}
            intl={intl}
            access={access}
            canBan={canBan}
            onBan={handleBanClick}
            onUnban={handleUnbanUser}
            onConfig={handleConfigClick}
            onDetail={handleDetailClick}
          />
        ),
      },
    ],
    [intl, isMobile, access, canBan],
  );

  return (
    <PageContainer>
      <ProTable<RtcUserInfo>
        headerTitle={intl.formatMessage({
          id: 'pages.rtcUsers.title',
          defaultMessage: 'RTC user list',
        })}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        scroll={{ x: 'max-content' }}
        request={createTableRequest(
          async (params, sort) => {
            // Read params from URL (single source of truth)
            const { search = '', status = '' } = tableParams.get();
            const current = params.current || 1;
            const pageSize = params.pageSize || 10;
            const sortParams = parseTableSort(sort || {});
            const response = await getRtcUserList({
              page: current,
              page_size: pageSize,
              search: search || undefined,
              status: status || undefined,
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
            id: 'pages.rtcUsers.loadFailed',
            defaultMessage: 'Failed to load users',
          },
        )}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
        search={{
          labelWidth: 'auto',
        }}
        form={{
          initialValues: tableParams.get(),
        }}
        toolBarRender={() => [
          <Button key="refresh" onClick={() => actionRef.current?.reload()}>
            {intl.formatMessage({
              id: 'pages.rtcUsers.refresh',
              defaultMessage: 'Refresh',
            })}
          </Button>,
        ]}
        locale={{
          emptyText: (
            <TableEmptyState
              descriptionId="pages.rtcUsers.noData"
              defaultDescription="No users found"
            />
          ),
        }}
      />

      {/* Ban user modal */}
      <ModalForm
        title={intl.formatMessage({
          id: 'pages.rtcUsers.banUser',
          defaultMessage: 'Ban user',
        })}
        open={banModal.state.open}
        onOpenChange={(visible) => {
          if (visible) {
            // Keep the current record when opening
            banModal.open(banModal.state.record);
          } else {
            banModal.close();
          }
        }}
        width={isMobile ? '95vw' : 520}
        modalProps={{
          destroyOnClose: true,
          onCancel: () => banModal.close(),
        }}
        onFinish={handleBanUser}
      >
        <ProFormTextArea
          name="reason"
          label={intl.formatMessage({
            id: 'pages.rtcUsers.banReasonLabel',
            defaultMessage: 'Ban reason',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.rtcUsers.banReasonPlaceholder',
            defaultMessage: 'Please enter ban reason',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.rtcUsers.banReasonRequired',
                defaultMessage: 'Please enter ban reason',
              }),
            },
            {
              whitespace: true,
              message: intl.formatMessage({
                id: 'pages.rtcUsers.banReasonWhitespace',
                defaultMessage: 'Ban reason cannot be only whitespace',
              }),
            },
            {
              max: 500,
              message: intl.formatMessage({
                id: 'pages.rtcUsers.banReasonMaxLength',
                defaultMessage: 'Ban reason cannot exceed 500 characters',
              }),
            },
          ]}
          fieldProps={{
            rows: 4,
            showCount: true,
            maxLength: 500,
          }}
        />
      </ModalForm>

      {/* User config drawer */}
      <UserConfigDrawer
        open={configModal.state.open}
        onClose={() => configModal.close()}
        user={configModal.state.record ?? null}
        canEdit={canConfigEdit}
        canDelete={canConfigDelete}
      />

      {/* User detail drawer */}
      <UserDetailDrawer
        open={detailModal.state.open}
        user={detailModal.state.record ?? null}
        onClose={() => detailModal.close()}
      />
    </PageContainer>
  );
};

export default RtcUserManagementPage;
