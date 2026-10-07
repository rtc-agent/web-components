import { useIntl } from '@umijs/max';
import { Button, List } from 'antd';
import React from 'react';
import type { Unpacked } from '@/utils/types';

/**
 * 安全设置视图
 * 展示密码、密保手机、密保问题、备用邮箱、MFA 设备等安全相关设置项
 */

const SecurityView: React.FC = () => {
  const intl = useIntl();

  const passwordStrength = {
    strong: (
      <span className="strong">
        {intl.formatMessage({
          id: 'pages.account.settings.security.strong',
          defaultMessage: '强',
        })}
      </span>
    ),
    medium: (
      <span className="medium">
        {intl.formatMessage({
          id: 'pages.account.settings.security.medium',
          defaultMessage: '中',
        })}
      </span>
    ),
    weak: (
      <span className="weak">
        {intl.formatMessage({
          id: 'pages.account.settings.security.weak',
          defaultMessage: '弱',
        })}
      </span>
    ),
  };

  const securityData = [
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.password',
        defaultMessage: '账户密码',
      }),
      description: (
        <>
          {intl.formatMessage({
            id: 'pages.account.settings.security.passwordStrength',
            defaultMessage: '当前密码强度：',
          })}
          {passwordStrength.strong}
        </>
      ),
      actions: [
        <Button key="Modify" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.modify',
            defaultMessage: '修改',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.phone',
        defaultMessage: '密保手机',
      }),
      description: `${intl.formatMessage({
        id: 'pages.account.settings.security.boundPhone',
        defaultMessage: '已绑定手机：',
      })}138****8293`,
      actions: [
        <Button key="Modify" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.modify',
            defaultMessage: '修改',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.question',
        defaultMessage: '密保问题',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.security.noQuestion',
        defaultMessage: '未设置密保问题，密保问题可有效保护账户安全',
      }),
      actions: [
        <Button key="Set" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.set',
            defaultMessage: '设置',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.backupEmail',
        defaultMessage: '备用邮箱',
      }),
      description: `${intl.formatMessage({
        id: 'pages.account.settings.security.boundEmail',
        defaultMessage: '已绑定邮箱：',
      })}ant***sign.com`,
      actions: [
        <Button key="Modify" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.modify',
            defaultMessage: '修改',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.mfa',
        defaultMessage: 'MFA 设备',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.security.noMfa',
        defaultMessage: '未绑定 MFA 设备，绑定后，可以进行二次确认',
      }),
      actions: [
        <Button key="bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.bind',
            defaultMessage: '绑定',
          })}
        </Button>,
      ],
    },
  ];

  return (
    <List<Unpacked<typeof securityData>>
      itemLayout="horizontal"
      dataSource={securityData}
      renderItem={(item) => (
        <List.Item actions={item.actions}>
          <List.Item.Meta title={item.title} description={item.description} />
        </List.Item>
      )}
    />
  );
};

export default SecurityView;
