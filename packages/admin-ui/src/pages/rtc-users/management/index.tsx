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
import { history, useAccess, useIntl, useSearchParams } from '@umijs/max';
import {
  App,
  Button,
  Dropdown,
  Grid,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
} from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
import { parseTableSort } from '../shared/tableUtils';
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

const { useBreakpoint } = Grid;

/**
 * Modal state interface for better organization
 */
interface ModalState {
  ban: { visible: boolean; user?: RtcUserInfo };
  config: { open: boolean; user: RtcUserInfo | null };
  detail: { open: boolean; user: RtcUserInfo | null };
}

/**
 * Action column component with memoization to prevent unnecessary re-renders
 */
const ActionColumn = React.memo<{
  record: RtcUserInfo;
  intl: any;
  access: any;
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
          defaultMessage: 'Configuration',
        }),
        icon: <SettingOutlined />,
        onClick: () => onConfig(record),
      },
      {
        key: 'sessions',
        label: intl.formatMessage({
          id: 'pages.rtcUsers.viewSessions',
          defaultMessage: 'Conversation',
        }),
        icon: <MessageOutlined />,
        onClick: () => history.push(`/rtc-users/sessions?user_id=${record.id}`),
      },
    ];

    return allMoreItems.filter((item) => {
      if (item.key === 'config') {
        return access.canServerConfigEdit;
      }
      if (item.key === 'sessions') {
        return access.canRtcSessionView;
      }
      return true;
    });
  }, [record, intl, access, onConfig]);

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
          })}
          onClick={() => onDetail(record)}
        />
      </Tooltip>
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
              })}
            />
          </Tooltip>
        </Popconfirm>
      )}
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
            })}
          />
        </Tooltip>
      </Dropdown>
    </Space>
  );
});

ActionColumn.displayName = 'ActionColumn';

/**
 * RTC User Management Page
 */
const RtcUserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [modalState, setModalState] = useState<ModalState>({
    ban: { visible: false },
    config: { open: false, user: null },
    detail: { open: false, user: null },
  });
  const access = useAccess();
  const intl = useIntl();
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const breakpoints = useBreakpoint();
  const isMobile = !breakpoints.md; // < 768px
  const canBan = access.canRtcUserBan;
  // NOTE: User config permissions reuse system config permissions (as per design doc)
  // This is intentional: user config management uses system config's edit/delete permission points
  // See access.ts for canServerConfigEdit/canServerConfigDelete definitions
  const canConfigEdit = access.canServerConfigEdit as boolean;
  const canConfigDelete = access.canServerConfigDelete as boolean;

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: RtcUserPageAPI = {
      // Sync URL filters and trigger table reload
      list: async (params = {}) => {
        const { search, status } = params;

        // Sync filters to URL (no page refresh). Pagination is transient state, not synced.
        const newSearchParams = new URLSearchParams();
        if (search) {
          newSearchParams.set('search', search);
        }
        if (status) {
          newSearchParams.set('status', status);
        }
        setSearchParams(newSearchParams, { replace: true });

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
          console.error('[RtcUser Page API] ban failed:', error);
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
          console.error('[RtcUser Page API] unban failed:', error);
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
          console.error('[RtcUser Page API] devices failed:', error);
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
          console.error('[RtcUser Page API] tokenStats failed:', error);
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
    };

    // Register to global
    window.__pages__ = window.__pages__ || {};
    window.__pages__.rtcUser = pageAPI;

    // Dispatch ready event
    window.dispatchEvent(
      new CustomEvent('page-api-ready', { detail: { page: 'rtcUser' } }),
    );

    console.log('[RtcUserManagementPage] Page API registered');

    // Cleanup
    return () => {
      delete window.__pages__?.rtcUser;
      console.log('[RtcUserManagementPage] Page API unregistered');
    };
  }, []);

  // Listen for URL changes, auto-reload table
  useEffect(() => {
    actionRef.current?.reload();
  }, [searchParams]);

  /** Ban user */
  const handleBanUser = async (values: { reason: string }) => {
    if (!modalState.ban.user) return false;
    try {
      await banRtcUser(modalState.ban.user.id, { reason: values.reason });
      message.success(
        intl.formatMessage({
          id: 'pages.rtcUsers.banSuccess',
          defaultMessage: 'User banned successfully',
        }),
      );
      setModalState((prev) => ({
        ...prev,
        ban: { visible: false },
      }));
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
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
  const handleUnbanUser = async (userId: string) => {
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
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.rtcUsers.unbanFailed',
            defaultMessage: 'Failed to unban user',
          }),
        ),
      );
    }
  };

  // Memoized handlers for action column
  const handleBanClick = useCallback((user: RtcUserInfo) => {
    setModalState((prev) => ({
      ...prev,
      ban: { visible: true, user },
    }));
  }, []);

  const handleConfigClick = useCallback((user: RtcUserInfo) => {
    setModalState((prev) => ({
      ...prev,
      config: { open: true, user },
    }));
  }, []);

  const handleDetailClick = useCallback((user: RtcUserInfo) => {
    setModalState((prev) => ({
      ...prev,
      detail: { open: true, user },
    }));
  }, []);

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
              defaultMessage: 'Normal',
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
                    defaultMessage: 'Normal',
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
        request={async (params, sort) => {
          // Read params from searchParams (URL is single source of truth)
          const search = searchParams.get('search') || '';
          const status = searchParams.get('status') || '';
          const current = params.current || 1;
          const pageSize = params.pageSize || 10;
          try {
            const sortParams = parseTableSort(sort || {});
            const response = await getRtcUserList({
              page: current,
              page_size: pageSize,
              search: search || undefined,
              status: status || undefined,
              ...sortParams,
            });
            return {
              data: response.items,
              total: response.total,
              success: true,
            };
          } catch (error: unknown) {
            message.error(
              getFriendlyErrorMessage(
                error,
                intl.formatMessage({
                  id: 'pages.rtcUsers.loadFailed',
                  defaultMessage: 'Failed to load users',
                }),
              ),
            );
            return {
              data: [],
              total: 0,
              success: false,
            };
          }
        }}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
        search={{
          labelWidth: 'auto',
        }}
        form={{
          initialValues: {
            search: searchParams.get('search') || '',
            status: searchParams.get('status') || undefined,
          },
        }}
        toolBarRender={() => [
          <Button key="refresh" onClick={() => actionRef.current?.reload()}>
            {intl.formatMessage({
              id: 'pages.rtcUsers.refresh',
              defaultMessage: 'Refresh',
            })}
          </Button>,
        ]}
      />

      {/* Ban user modal */}
      <ModalForm
        title={intl.formatMessage({
          id: 'pages.rtcUsers.banUser',
          defaultMessage: 'Ban user',
        })}
        open={modalState.ban.visible}
        onOpenChange={(visible) =>
          setModalState((prev) => ({
            ...prev,
            ban: { visible, user: visible ? prev.ban.user : undefined },
          }))
        }
        width={isMobile ? '95vw' : 520}
        modalProps={{
          destroyOnClose: true,
          onCancel: () =>
            setModalState((prev) => ({
              ...prev,
              ban: { visible: false },
            })),
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
                id: 'pages.rtcUsers.banReasonNoWhitespace',
                defaultMessage: 'Ban reason cannot be blank',
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
        open={modalState.config.open}
        onClose={() =>
          setModalState((prev) => ({
            ...prev,
            config: { open: false, user: null },
          }))
        }
        user={modalState.config.user}
        canEdit={canConfigEdit}
        canDelete={canConfigDelete}
      />

      {/* User detail drawer */}
      <UserDetailDrawer
        open={modalState.detail.open}
        user={modalState.detail.user}
        onClose={() =>
          setModalState((prev) => ({
            ...prev,
            detail: { open: false, user: null },
          }))
        }
      />
    </PageContainer>
  );
};

export default RtcUserManagementPage;
