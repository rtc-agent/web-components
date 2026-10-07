import { useIntl } from '@umijs/max';
import { List, Switch } from 'antd';
import React from 'react';
import type { Unpacked } from '@/utils/types';

/**
 * 通知设置视图
 * 展示用户消息、系统消息、待办任务的通知开关
 */

const NotificationView: React.FC = () => {
  const intl = useIntl();

  const notificationAction = (key: string) => (
    <Switch
      key={key}
      checkedChildren={intl.formatMessage({
        id: 'pages.account.settings.notification.on',
        defaultMessage: '开',
      })}
      unCheckedChildren={intl.formatMessage({
        id: 'pages.account.settings.notification.off',
        defaultMessage: '关',
      })}
      defaultChecked
    />
  );

  const notificationData = [
    {
      key: 'user-message',
      title: intl.formatMessage({
        id: 'pages.account.settings.notification.userMessage',
        defaultMessage: '用户消息',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.notification.userMessageDesc',
        defaultMessage: '其他用户的消息将以站内信的形式通知',
      }),
      actions: [notificationAction('user-message-switch')],
    },
    {
      key: 'system-message',
      title: intl.formatMessage({
        id: 'pages.account.settings.notification.systemMessage',
        defaultMessage: '系统消息',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.notification.systemMessageDesc',
        defaultMessage: '系统消息将以站内信的形式通知',
      }),
      actions: [notificationAction('system-message-switch')],
    },
    {
      key: 'todo-task',
      title: intl.formatMessage({
        id: 'pages.account.settings.notification.todoTask',
        defaultMessage: '待办任务',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.notification.todoTaskDesc',
        defaultMessage: '待办任务将以站内信的形式通知',
      }),
      actions: [notificationAction('todo-task-switch')],
    },
  ];

  return (
    <List<Unpacked<typeof notificationData>>
      rowKey="key"
      itemLayout="horizontal"
      dataSource={notificationData}
      renderItem={(item) => (
        <List.Item actions={item.actions}>
          <List.Item.Meta title={item.title} description={item.description} />
        </List.Item>
      )}
    />
  );
};

export default NotificationView;
