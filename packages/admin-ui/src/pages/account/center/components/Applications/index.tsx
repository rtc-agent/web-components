import {
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import { Avatar, Card, Dropdown, List, Tooltip } from 'antd';
import React from 'react';
import { formatNumber } from '@/utils/format';
import type { ListItemDataType } from '../../data.d';
import { queryFakeList } from '../../service';
import useStyles from './index.style';

/**
 * 数字格式化为"万"单位（中文）或 "W"（英文）
 * 通过 intl 获取本地化的单位文本
 */
function formatWan(val: number, wanText: string) {
  const v = val * 1;
  if (!v || Number.isNaN(v)) return '';
  let result: React.ReactNode = val;
  if (val > 10000) {
    result = (
      <span>
        {Math.floor(val / 10000)}
        <span
          style={{
            position: 'relative',
            top: -2,
            fontSize: 14,
            fontStyle: 'normal',
            marginLeft: 2,
          }}
        >
          {wanText}
        </span>
      </span>
    );
  }
  return result;
}

/** 卡片底部信息区：展示活跃用户数与新增用户数 */
const CardInfo: React.FC<{
  activeUser: React.ReactNode;
  newUser: React.ReactNode;
  activeUserLabel: string;
  newUserLabel: string;
}> = ({ activeUser, newUser, activeUserLabel, newUserLabel }) => {
  const { styles: stylesApplications } = useStyles();
  return (
    <div className={stylesApplications.cardInfo}>
      <div>
        <p>{activeUserLabel}</p>
        <p>{activeUser}</p>
      </div>
      <div>
        <p>{newUserLabel}</p>
        <p>{newUser}</p>
      </div>
    </div>
  );
};

const Applications: React.FC = () => {
  const { styles: stylesApplications } = useStyles();
  const intl = useIntl();

  // 获取tab列表数据
  const { data: listData } = useQuery({
    queryKey: ['applications-list', 30],
    queryFn: () => queryFakeList({ count: 30 }).then((res) => res.data),
  });

  const wanText = intl.formatMessage({
    id: 'pages.account.center.wan',
    defaultMessage: '万',
  });
  const activeUserLabel = intl.formatMessage({
    id: 'pages.account.center.activeUser',
    defaultMessage: '活跃用户',
  });
  const newUserLabel = intl.formatMessage({
    id: 'pages.account.center.newUser',
    defaultMessage: '新增用户',
  });
  const downloadText = intl.formatMessage({
    id: 'pages.account.center.download',
    defaultMessage: '下载',
  });
  const editText = intl.formatMessage({
    id: 'pages.account.center.edit',
    defaultMessage: '编辑',
  });
  const shareText = intl.formatMessage({
    id: 'pages.account.center.share',
    defaultMessage: '分享',
  });

  return (
    <List<ListItemDataType>
      rowKey="id"
      className={stylesApplications.filterCardList}
      grid={{
        gutter: 24,
        xxl: 3,
        xl: 2,
        lg: 2,
        md: 2,
        sm: 2,
        xs: 1,
      }}
      dataSource={listData?.list || []}
      renderItem={(item) => (
        <List.Item key={item.id}>
          <Card
            hoverable
            styles={{
              body: {
                paddingBottom: 20,
              },
            }}
            actions={[
              <Tooltip key="download" title={downloadText}>
                <DownloadOutlined />
              </Tooltip>,
              <Tooltip title={editText} key="edit">
                <EditOutlined />
              </Tooltip>,
              <Tooltip title={shareText} key="share">
                <ShareAltOutlined />
              </Tooltip>,
              <Dropdown
                menu={{
                  items: [
                    {
                      key: '1',
                      label: intl.formatMessage({
                        id: 'pages.account.center.dropdownFirst',
                        defaultMessage: '第一个菜单项',
                      }),
                    },
                    {
                      key: '2',
                      label: intl.formatMessage({
                        id: 'pages.account.center.dropdownSecond',
                        defaultMessage: '第二个菜单项',
                      }),
                    },
                  ],
                }}
                key="ellipsis"
              >
                <EllipsisOutlined />
              </Dropdown>,
            ]}
          >
            <Card.Meta
              avatar={<Avatar size="small" src={item.avatar} />}
              title={item.title}
            />
            <div>
              <CardInfo
                activeUser={formatWan(item.activeUser, wanText)}
                newUser={formatNumber(item.newUser)}
                activeUserLabel={activeUserLabel}
                newUserLabel={newUserLabel}
              />
            </div>
          </Card>
        </List.Item>
      )}
    />
  );
};
export default Applications;
