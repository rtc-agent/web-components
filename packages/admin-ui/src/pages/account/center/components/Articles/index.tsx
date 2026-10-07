import { LikeOutlined, MessageFilled, StarTwoTone } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import { Flex, List, Tag } from 'antd';
import React from 'react';
import { ArticleListContent } from '@/components';
import type { ListItemDataType } from '../../data.d';
import { queryFakeList } from '../../service';
import useStyles from './index.style';

/** 图标与文本的组合展示，用于文章列表的操作统计（收藏、点赞、评论） */
const IconText: React.FC<{
  icon: React.ReactNode;
  text: React.ReactNode;
}> = ({ icon, text }) => (
  <span>
    {icon} {text}
  </span>
);

const Articles: React.FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();

  // 获取tab列表数据
  const { data: listData } = useQuery({
    queryKey: ['articles-list', 30],
    queryFn: () => queryFakeList({ count: 30 }).then((res) => res.data),
  });
  return (
    <List<ListItemDataType>
      size="large"
      className={styles.articleList}
      rowKey="id"
      itemLayout="vertical"
      dataSource={listData?.list || []}
      style={{
        margin: '0 -24px',
      }}
      renderItem={(item) => (
        <List.Item
          key={item.id}
          actions={[
            <IconText key="star" icon={<StarTwoTone />} text={item.star} />,
            <IconText key="like" icon={<LikeOutlined />} text={item.like} />,
            <IconText
              key="message"
              icon={<MessageFilled />}
              text={item.message}
            />,
          ]}
        >
          <List.Item.Meta
            title={
              <a className={styles.listItemMetaTitle} href={item.href}>
                {item.title}
              </a>
            }
            description={
              <Flex wrap gap="small">
                <Tag>Ant Design</Tag>
                <Tag>
                  {intl.formatMessage({
                    id: 'pages.account.center.designLanguage',
                    defaultMessage: '设计语言',
                  })}
                </Tag>
                <Tag>
                  {intl.formatMessage({
                    id: 'pages.account.center.antGroup',
                    defaultMessage: '蚂蚁集团',
                  })}
                </Tag>
              </Flex>
            }
          />
          <ArticleListContent data={item} />
        </List.Item>
      )}
    />
  );
};
export default Articles;
