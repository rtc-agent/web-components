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
          defaultMessage: 'Strong',
        })}
      </span>
    ),
    medium: (
      <span className="medium">
        {intl.formatMessage({
          id: 'pages.account.settings.security.medium',
          defaultMessage: 'Medium',
        })}
      </span>
    ),
    weak: (
      <span className="weak">
        {intl.formatMessage({
          id: 'pages.account.settings.security.weak',
          defaultMessage: 'Weak',
        })}
      </span>
    ),
  };

  const securityData = [
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.password',
        defaultMessage: 'Account password',
      }),
      description: (
        <>
          {intl.formatMessage({
            id: 'pages.account.settings.security.passwordStrength',
            defaultMessage: 'Current password strength: ',
          })}
          {passwordStrength.strong}
        </>
      ),
      actions: [
        <Button key="Modify" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.modify',
            defaultMessage: 'Edit',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.phone',
        defaultMessage: 'Security phone',
      }),
      description: `${intl.formatMessage({
        id: 'pages.account.settings.security.boundPhone',
        defaultMessage: 'Bound phone: ',
      })}138****8293`,
      actions: [
        <Button key="Modify" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.modify',
            defaultMessage: 'Edit',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.question',
        defaultMessage: 'Security question',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.security.noQuestion',
        defaultMessage:
          'Security question not set. Security questions can effectively protect account security',
      }),
      actions: [
        <Button key="Set" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.set',
            defaultMessage: 'Settings',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.backupEmail',
        defaultMessage: 'Backup email',
      }),
      description: `${intl.formatMessage({
        id: 'pages.account.settings.security.boundEmail',
        defaultMessage: 'Bound email: ',
      })}ant***sign.com`,
      actions: [
        <Button key="Modify" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.modify',
            defaultMessage: 'Edit',
          })}
        </Button>,
      ],
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.security.mfa',
        defaultMessage: 'MFA device',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.security.noMfa',
        defaultMessage:
          'MFA device not bound. After binding, you can enable two-factor authentication',
      }),
      actions: [
        <Button key="bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.security.bind',
            defaultMessage: 'Bind',
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
