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
import { App, Button, Dropdown, Popconfirm, Space, Tag, Tooltip } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';
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
 * RTC User Management Page
 */
const RtcUserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [currentRow, setCurrentRow] = useState<RtcUserInfo>();
  const [banModalVisible, setBanModalVisible] = useState(false);
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [configUser, setConfigUser] = useState<RtcUserInfo | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailUser, setDetailUser] = useState<RtcUserInfo | null>(null);
  const access = useAccess();
  const intl = useIntl();
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const canBan = access.canRtcUserBan;
  // NOTE: User config permissions reuse system config permissions (as per design doc)
  // This is intentional: user config management uses system config's edit/delete permission points
  // See access.ts for canServerConfigEdit/canServerConfigDelete definitions
  const canConfigEdit = access.canServerConfigEdit as boolean;
  const canConfigDelete = access.canServerConfigDelete as boolean;

  // === Register Page API ===
  useEffect(() => {
    const pageAPI: RtcUserPageAPI = {
      // Read table data
      list: async (params = {}) => {
        const { current = 1, pageSize = 10, search, status } = params;

        // Sync URL (no page refresh)
        const newSearchParams = new URLSearchParams();
        if (search) {
          newSearchParams.set('search', search);
        }
        if (status) {
          newSearchParams.set('status', status);
        }
        newSearchParams.set('current', String(current));
        newSearchParams.set('pageSize', String(pageSize));
        setSearchParams(newSearchParams, { replace: true });

        try {
          const response = await getRtcUserList({
            page: current,
            page_size: pageSize,
            search,
            status,
          });

          return {
            success: true,
            data: response.items,
            total: response.total,
          };
        } catch (error) {
          console.error('[RtcUser Page API] list failed:', error);
          return {
            success: false,
            data: [],
            total: 0,
            error: 'Failed to load RTC user list',
          };
        }
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
    if (!currentRow) return false;
    try {
      await banRtcUser(currentRow.id, { reason: values.reason });
      message.success(
        intl.formatMessage({
          id: 'pages.rtcUsers.banSuccess',
          defaultMessage: '封禁用户成功',
        }),
      );
      setBanModalVisible(false);
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.rtcUsers.banFailed',
            defaultMessage: '封禁用户失败',
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
          defaultMessage: '解封用户成功',
        }),
      );
      actionRef.current?.reload();
    } catch (error: unknown) {
      message.error(
        getFriendlyErrorMessage(
          error,
          intl.formatMessage({
            id: 'pages.rtcUsers.unbanFailed',
            defaultMessage: '解封用户失败',
          }),
        ),
      );
    }
  };

  /** Table column definitions */
  const columns: ProColumns<RtcUserInfo>[] = [
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.userId',
        defaultMessage: '用户ID',
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
        defaultMessage: '邮箱',
      }),
      dataIndex: 'email',
      valueType: 'text',
      copyable: true,
      search: false,
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.name',
        defaultMessage: '姓名',
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
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.status',
        defaultMessage: '状态',
      }),
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: {
        active: {
          text: intl.formatMessage({
            id: 'pages.rtcUsers.statusActive',
            defaultMessage: '正常',
          }),
          status: 'Success',
        },
        banned: {
          text: intl.formatMessage({
            id: 'pages.rtcUsers.statusBanned',
            defaultMessage: '已封禁',
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
                  defaultMessage: '已封禁',
                })
              : intl.formatMessage({
                  id: 'pages.rtcUsers.statusActive',
                  defaultMessage: '正常',
                })}
          </Tag>
        );
      },
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.bannedReason',
        defaultMessage: '封禁原因',
      }),
      dataIndex: 'banned_reason',
      valueType: 'text',
      search: false,
      ellipsis: true,
      render: (_, record) => record.banned_reason || '-',
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.bannedAt',
        defaultMessage: '封禁时间',
      }),
      dataIndex: 'banned_at',
      valueType: 'dateTime',
      search: false,
      render: (_, record) => record.banned_at || '-',
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.createdAt',
        defaultMessage: '创建时间',
      }),
      dataIndex: 'created_at',
      valueType: 'dateTime',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
    },
    {
      title: intl.formatMessage({
        id: 'pages.rtcUsers.actions',
        defaultMessage: '操作',
      }),
      dataIndex: 'option',
      valueType: 'option',
      width: 160,
      render: (_, record) => {
        const isBanned = record.status === 'banned';
        const moreItems = [
          {
            key: 'config',
            label: intl.formatMessage({
              id: 'pages.rtcUsers.config',
              defaultMessage: '配置',
            }),
            icon: <SettingOutlined />,
            onClick: () => {
              setConfigUser(record);
              setConfigDrawerOpen(true);
            },
          },
          {
            key: 'sessions',
            label: intl.formatMessage({
              id: 'pages.rtcUsers.viewSessions',
              defaultMessage: '对话',
            }),
            icon: <MessageOutlined />,
            onClick: () =>
              history.push(`/rtc-users/sessions?user_id=${record.id}`),
          },
        ];

        return (
          <Space size={0}>
            <Tooltip
              title={intl.formatMessage({
                id: 'pages.rtcUsers.detail.viewDetail',
                defaultMessage: '查看详情',
              })}
            >
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => {
                  setDetailUser(record);
                  setDetailOpen(true);
                }}
              />
            </Tooltip>
            {!isBanned && canBan && (
              <Tooltip
                title={intl.formatMessage({
                  id: 'pages.rtcUsers.ban',
                  defaultMessage: '封禁',
                })}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<StopOutlined />}
                  onClick={() => {
                    setCurrentRow(record);
                    setBanModalVisible(true);
                  }}
                />
              </Tooltip>
            )}
            {isBanned && canBan && (
              <Popconfirm
                title={intl.formatMessage({
                  id: 'pages.rtcUsers.confirmUnban',
                  defaultMessage: '确认解封该用户吗？',
                })}
                onConfirm={() => handleUnbanUser(record.id)}
                okText={intl.formatMessage({
                  id: 'pages.rtcUsers.confirm',
                  defaultMessage: '确认',
                })}
                cancelText={intl.formatMessage({
                  id: 'pages.rtcUsers.cancel',
                  defaultMessage: '取消',
                })}
              >
                <Tooltip
                  title={intl.formatMessage({
                    id: 'pages.rtcUsers.unban',
                    defaultMessage: '解封',
                  })}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<CheckCircleOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            )}
            <Dropdown menu={{ items: moreItems }} trigger={['click']}>
              <Tooltip
                title={intl.formatMessage({
                  id: 'pages.rtcUsers.more',
                  defaultMessage: '更多',
                })}
              >
                <Button type="text" size="small" icon={<DownOutlined />} />
              </Tooltip>
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  return (
    <PageContainer>
      <ProTable<RtcUserInfo>
        headerTitle={intl.formatMessage({
          id: 'pages.rtcUsers.title',
          defaultMessage: 'RTC 用户列表',
        })}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params, _sort, _filter) => {
          // Read params from searchParams (URL is single source of truth)
          const search = searchParams.get('search') || '';
          const status = searchParams.get('status') || '';
          const current = params.current || 1;
          const pageSize = params.pageSize || 10;
          try {
            const response = await getRtcUserList({
              page: current,
              page_size: pageSize,
              search: search || undefined,
              status: status || undefined,
            });
            return {
              data: response.items,
              total: response.total,
              success: true,
            };
          } catch (_error) {
            message.error(
              intl.formatMessage({
                id: 'pages.rtcUsers.loadFailed',
                defaultMessage: '加载用户列表失败',
              }),
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
              defaultMessage: '刷新',
            })}
          </Button>,
        ]}
      />

      {/* Ban user modal */}
      <ModalForm
        title={intl.formatMessage({
          id: 'pages.rtcUsers.banUser',
          defaultMessage: '封禁用户',
        })}
        open={banModalVisible}
        onOpenChange={setBanModalVisible}
        modalProps={{
          destroyOnClose: true,
          onCancel: () => setCurrentRow(undefined),
        }}
        onFinish={handleBanUser}
      >
        <ProFormTextArea
          name="reason"
          label={intl.formatMessage({
            id: 'pages.rtcUsers.banReasonLabel',
            defaultMessage: '封禁原因',
          })}
          placeholder={intl.formatMessage({
            id: 'pages.rtcUsers.banReasonPlaceholder',
            defaultMessage: '请输入封禁原因',
          })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'pages.rtcUsers.banReasonRequired',
                defaultMessage: '请输入封禁原因',
              }),
            },
            {
              whitespace: true,
              message: intl.formatMessage({
                id: 'pages.rtcUsers.banReasonNoWhitespace',
                defaultMessage: '封禁原因不能为空白字符',
              }),
            },
            {
              max: 500,
              message: intl.formatMessage({
                id: 'pages.rtcUsers.banReasonMaxLength',
                defaultMessage: '封禁原因长度不能超过 500 个字符',
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
        open={configDrawerOpen}
        onClose={() => {
          setConfigDrawerOpen(false);
          setConfigUser(null);
        }}
        user={configUser}
        canEdit={canConfigEdit}
        canDelete={canConfigDelete}
      />

      {/* User detail drawer */}
      <UserDetailDrawer
        open={detailOpen}
        user={detailUser}
        onClose={() => {
          setDetailOpen(false);
          setDetailUser(null);
        }}
      />
    </PageContainer>
  );
};

export default RtcUserManagementPage;
