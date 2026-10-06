import { StopOutlined, CheckCircleOutlined, UserOutlined } from '@ant-design/icons';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { ModalForm, PageContainer, ProFormTextArea, ProTable } from '@ant-design/pro-components';
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

  /** 封禁用户 */
  const handleBanUser = async (values: { reason: string }) => {
    if (!currentRow) return false;
    try {
      await banRtcUser(currentRow.id, { reason: values.reason });
      message.success('封禁用户成功');
      setBanModalVisible(false);
      actionRef.current?.reload();
      return true;
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '封禁用户失败'));
      return false;
    }
  };

  /** 解封用户 */
  const handleUnbanUser = async (userId: string) => {
    try {
      await unbanRtcUser(userId);
      message.success('解封用户成功');
      actionRef.current?.reload();
    } catch (error: any) {
      message.error(getFriendlyErrorMessage(error, '解封用户失败'));
    }
  };

  /** 表格列定义 */
  const columns: ProColumns<RtcUserInfo>[] = [
    {
      title: '用户ID',
      dataIndex: 'id',
      valueType: 'text',
      hideInTable: true,
      hideInSearch: true,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      valueType: 'text',
      copyable: true,
    },
    {
      title: '姓名',
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
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: {
        active: { text: '正常', status: 'Success' },
        banned: { text: '已封禁', status: 'Error' },
      },
      render: (_, record) => {
        const isBanned = record.status === 'banned';
        return (
          <Tag color={isBanned ? 'red' : 'green'}>
            {isBanned ? '已封禁' : '正常'}
          </Tag>
        );
      },
    },
    {
      title: '封禁原因',
      dataIndex: 'banned_reason',
      valueType: 'text',
      search: false,
      ellipsis: true,
      render: (_, record) => record.banned_reason || '-',
    },
    {
      title: '封禁时间',
      dataIndex: 'banned_at',
      valueType: 'dateTime',
      search: false,
      render: (_, record) => record.banned_at || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      valueType: 'dateTime',
      search: false,
      sorter: true,
      defaultSortOrder: 'descend',
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      render: (_, record) => {
        const isBanned = record.status === 'banned';
        return (
          <Space>
            {!isBanned && (
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
                封禁
              </Button>
            )}
            {isBanned && (
              <Popconfirm
                title="确认解封该用户吗？"
                onConfirm={() => handleUnbanUser(record.id)}
                okText="确认"
                cancelText="取消"
              >
                <Button type="link" size="small" icon={<CheckCircleOutlined />}>
                  解封
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
        headerTitle="RTC 用户列表"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params, sort, filter) => {
          try {
            const response = await getRtcUserList({
              ...params,
              status: params.status,
              search: params.email || params.name,
            });
            return {
              data: response.items,
              total: response.total,
              success: true,
            };
          } catch (error) {
            message.error('加载用户列表失败');
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
            刷新
          </Button>,
        ]}
      />

      {/* 封禁用户弹窗 */}
      <ModalForm
        title="封禁用户"
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
          label="封禁原因"
          placeholder="请输入封禁原因"
          rules={[
            { required: true, message: '请输入封禁原因' },
            { min: 1, max: 500, message: '封禁原因长度应在 1 到 500 个字符之间' },
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
