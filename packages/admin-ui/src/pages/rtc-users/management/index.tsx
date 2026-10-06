import { StopOutlined, CheckCircleOutlined, UserOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ModalForm, PageContainer, ProFormTextArea, ProTable } from '@ant-design/pro-components';
import { useAccess, useIntl } from '@umijs/max';
import { Button, message, Popconfirm, Space, Tag } from 'antd';
import React, { useRef, useState } from 'react';
import type { RtcUserInfo } from './data';
import { banRtcUser, getRtcUserList, unbanRtcUser } from './service';
import { getFriendlyErrorMessage } from '@/utils/errorHandler';

/**
 * RTC 用户管理页面
 */
const RtcUserManagementPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [currentRow, setCurrentRow] = useState<RtcUserInfo>();
  const [banModalVisible, setBanModalVisible] = useState(false);
  const access = useAccess();
  const intl = useIntl();
  const canBan = access.canRtcUserBan;

  /** 封禁用户 */
  const handleBanUser = async (values: { reason: string }) => {
    if (!currentRow) return false;
    try {
      await banRtcUser(currentRow.id, { reason: values.reason });
      message.success(intl.formatMessage({ id: 'pages.rtcUsers.banSuccess', defaultMessage: '封禁用户成功' }));
      setBanModalVisible(false);
      actionRef.current?.reload();
      return true;
    } catch (error: unknown) {
      message.error(getFriendlyErrorMessage(error, intl.formatMessage({ id: 'pages.rtcUsers.banFailed', defaultMessage: '封禁用户失败' })));
      return false;
    }
  };

  /** 解封用户 */
  const handleUnbanUser = async (userId: string) => {
    try {
      await unbanRtcUser(userId);
      message.success(intl.formatMessage({ id: 'pages.rtcUsers.unbanSuccess', defaultMessage: '解封用户成功' }));
      actionRef.current?.reload();
    } catch (error: unknown) {
      message.error(getFriendlyErrorMessage(error, intl.formatMessage({ id: 'pages.rtcUsers.unbanFailed', defaultMessage: '解封用户失败' })));
    }
  };

  /** 表格列定义 */
  const columns: ProColumns<RtcUserInfo>[] = [
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.userId', defaultMessage: '用户ID' }),
      dataIndex: 'id',
      valueType: 'text',
      hideInTable: true,
      hideInSearch: true,
    },
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.email', defaultMessage: '邮箱' }),
      dataIndex: 'email',
      valueType: 'text',
      copyable: true,
    },
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.name', defaultMessage: '姓名' }),
      dataIndex: 'name',
      valueType: 'text',
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      valueType: 'text',
      search: false,
    },
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.status', defaultMessage: '状态' }),
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: {
        active: { text: intl.formatMessage({ id: 'pages.rtcUsers.statusActive', defaultMessage: '正常' }), status: 'Success' },
        banned: { text: intl.formatMessage({ id: 'pages.rtcUsers.statusBanned', defaultMessage: '已封禁' }), status: 'Error' },
      },
      render: (_, record) => {
        const isBanned = record.status === 'banned';
        return (
          <Tag color={isBanned ? 'red' : 'green'}>
            {isBanned ? intl.formatMessage({ id: 'pages.rtcUsers.statusBanned', defaultMessage: '已封禁' }) : intl.formatMessage({ id: 'pages.rtcUsers.statusActive', defaultMessage: '正常' })}
          </Tag>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.bannedReason', defaultMessage: '封禁原因' }),
      dataIndex: 'banned_reason',
      valueType: 'text',
      search: false,
      ellipsis: true,
      render: (_, record) => record.banned_reason || '-',
    },
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.bannedAt', defaultMessage: '封禁时间' }),
      dataIndex: 'banned_at',
      valueType: 'dateTime',
      search: false,
      render: (_, record) => record.banned_at || '-',
    },
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.createdAt', defaultMessage: '创建时间' }),
      dataIndex: 'created_at',
      valueType: 'dateTime',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
    },
    {
      title: intl.formatMessage({ id: 'pages.rtcUsers.actions', defaultMessage: '操作' }),
      dataIndex: 'option',
      valueType: 'option',
      render: (_, record) => {
        const isBanned = record.status === 'banned';
        return (
          <Space>
            {!isBanned && canBan && (
              <Button
                type="link"
                danger
                size="small"
                icon={<StopOutlined />}
                onClick={() => {
                  setCurrentRow(record);
                  setBanModalVisible(true);
                }}
              >
                {intl.formatMessage({ id: 'pages.rtcUsers.ban', defaultMessage: '封禁' })}
              </Button>
            )}
            {isBanned && canBan && (
              <Popconfirm
                title={intl.formatMessage({ id: 'pages.rtcUsers.confirmUnban', defaultMessage: '确认解封该用户吗？' })}
                onConfirm={() => handleUnbanUser(record.id)}
                okText={intl.formatMessage({ id: 'pages.rtcUsers.confirm', defaultMessage: '确认' })}
                cancelText={intl.formatMessage({ id: 'pages.rtcUsers.cancel', defaultMessage: '取消' })}
              >
                <Button type="link" size="small" icon={<CheckCircleOutlined />}>
                  {intl.formatMessage({ id: 'pages.rtcUsers.unban', defaultMessage: '解封' })}
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <PageContainer>
      <ProTable<RtcUserInfo>
        headerTitle={intl.formatMessage({ id: 'pages.rtcUsers.title', defaultMessage: 'RTC 用户列表' })}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params, sort, filter) => {
          try {
            const { email, name, ...restParams } = params;
            const response = await getRtcUserList({
              ...restParams,
              search: email || name,
            });
            return {
              data: response.items,
              total: response.total,
              success: true,
            };
          } catch (error) {
            message.error(intl.formatMessage({ id: 'pages.rtcUsers.loadFailed', defaultMessage: '加载用户列表失败' }));
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
        toolBarRender={() => [
          <Button
            key="refresh"
            onClick={() => actionRef.current?.reload()}
          >
            {intl.formatMessage({ id: 'pages.rtcUsers.refresh', defaultMessage: '刷新' })}
          </Button>,
        ]}
      />

      {/* 封禁用户弹窗 */}
      <ModalForm
        title={intl.formatMessage({ id: 'pages.rtcUsers.banUser', defaultMessage: '封禁用户' })}
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
          label={intl.formatMessage({ id: 'pages.rtcUsers.banReasonLabel', defaultMessage: '封禁原因' })}
          placeholder={intl.formatMessage({ id: 'pages.rtcUsers.banReasonPlaceholder', defaultMessage: '请输入封禁原因' })}
          rules={[
            { required: true, message: intl.formatMessage({ id: 'pages.rtcUsers.banReasonRequired', defaultMessage: '请输入封禁原因' }) },
            { whitespace: true, message: intl.formatMessage({ id: 'pages.rtcUsers.banReasonNoWhitespace', defaultMessage: '封禁原因不能为空白字符' }) },
            { max: 500, message: intl.formatMessage({ id: 'pages.rtcUsers.banReasonMaxLength', defaultMessage: '封禁原因长度不能超过 500 个字符' }) },
          ]}
          fieldProps={{
            rows: 4,
            showCount: true,
            maxLength: 500,
          }}
        />
      </ModalForm>
    </PageContainer>
  );
};

export default RtcUserManagementPage;
