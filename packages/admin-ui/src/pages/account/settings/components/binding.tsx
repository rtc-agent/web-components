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
        defaultMessage: '绑定淘宝',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.binding.taobaoDesc',
        defaultMessage: '当前未绑定淘宝账号',
      }),
      actions: [
        <Button key="Bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.binding.bind',
            defaultMessage: '绑定',
          })}
        </Button>,
      ],
      avatar: <TaobaoOutlined className="taobao" />,
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.binding.alipay',
        defaultMessage: '绑定支付宝',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.binding.alipayDesc',
        defaultMessage: '当前未绑定支付宝账号',
      }),
      actions: [
        <Button key="Bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.binding.bind',
            defaultMessage: '绑定',
          })}
        </Button>,
      ],
      avatar: <AlipayOutlined className="alipay" />,
    },
    {
      title: intl.formatMessage({
        id: 'pages.account.settings.binding.dingding',
        defaultMessage: '绑定钉钉',
      }),
      description: intl.formatMessage({
        id: 'pages.account.settings.binding.dingdingDesc',
        defaultMessage: '当前未绑定钉钉账号',
      }),
      actions: [
        <Button key="Bind" type="link">
          {intl.formatMessage({
            id: 'pages.account.settings.binding.bind',
            defaultMessage: '绑定',
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
