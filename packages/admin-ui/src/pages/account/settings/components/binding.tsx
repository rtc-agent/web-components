import {
  AlipayOutlined,
  DingdingOutlined,
  TaobaoOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, List } from 'antd';
import React from 'react';

/**
 * 账号绑定设置视图
 * 展示淘宝、支付宝、钉钉等第三方账号绑定状态
 */

const BindingView: React.FC = () => {
  const intl = useIntl();

  const bindingData = [
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.binding.taobao',
        defaultMessage: 'Bind Taobao',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.binding.taobaoDesc',
        defaultMessage: 'Taobao account not bound',
      }),
      actions: [
        <Button key="Bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.binding.bind',
            defaultMessage: 'Bind',
          })}
        </Button>,
      ],
      avatar: <TaobaoOutlined className="taobao" />,
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.binding.alipay',
        defaultMessage: 'Bind Alipay',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.binding.alipayDesc',
        defaultMessage: 'Alipay account not bound',
      }),
      actions: [
        <Button key="Bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.binding.bind',
            defaultMessage: 'Bind',
          })}
        </Button>,
      ],
      avatar: <AlipayOutlined className="alipay" />,
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.binding.dingding',
        defaultMessage: 'Bind DingTalk',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.binding.dingdingDesc',
        defaultMessage: 'DingTalk account not bound',
      }),
      actions: [
        <Button key="Bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.binding.bind',
            defaultMessage: 'Bind',
          })}
        </Button>,
      ],
      avatar: <DingdingOutlined className="dingding" />,
    },
  ];

  return (
    <List
      itemLayout="horizontal"
      dataSource={bindingData}
      renderItem={(item) => (
        <List.Item actions={item.actions}>
          <List.Item.Meta
            avatar={item.avatar}
            title={item.title}
            description={item.description}
          />
        </List.Item>
      )}
    />
  );
};

export default BindingView;
