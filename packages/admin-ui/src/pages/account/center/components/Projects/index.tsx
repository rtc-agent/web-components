import { useQuery } from '@tanstack/react-query';
import { Card, List } from 'antd';
import dayjs from 'dayjs';
import React from 'react';
import { AvatarList } from '@/components';
import { LIST_CACHE } from '@/utils/queryCacheConfig';
import { queryKeys } from '@/utils/queryKeys';
import type { ListItemDataType } from '../../data';
import { queryFakeList } from '../../service';
import useStyles from './index.style';

const Projects: React.FC = () => {
  const { styles } = useStyles();
  // 获取tab列表数据
  const { data: listData } = useQuery({
    queryKey: queryKeys.accountCenter.projects(30),
    queryFn: () => queryFakeList({ count: 30 }).then((res) => res.data),
    staleTime: LIST_CACHE.staleTime, // 2 minutes
    gcTime: LIST_CACHE.gcTime, // 10 minutes
  });
  return (
    <List<ListItemDataType>
      className={styles.coverCardList}
      rowKey="id"
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
        <List.Item>
          <Card
            className={styles.card}
            hoverable
            cover={<img alt={item.title} src={item.cover} />}
          >
            <Card.Meta
              title={<a href={item.href}>{item.title}</a>}
              description={item.subDescription}
            />
            <div className={styles.cardItemContent}>
              <span>{dayjs(item.updatedAt).fromNow()}</span>
              <div className={styles.avatarList}>
                <AvatarList size="small">
                  {item.members.map((member) => (
                    <AvatarList.Item
                      key={`${item.id}-avatar-${member.id}`}
                      src={member.avatar}
                      tips={member.name}
                    />
                  ))}
                </AvatarList>
              </div>
            </div>
          </Card>
        </List.Item>
      )}
    />
  );
};
export default Projects;
