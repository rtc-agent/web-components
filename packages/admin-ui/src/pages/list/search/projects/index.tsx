import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import { Card, Col, Form, List, Row, Select, Typography } from 'antd';
import dayjs from 'dayjs';
import type { FC } from 'react';
import { useState } from 'react';
import { AvatarList, StandardFormRow, TagSelect } from '@/components';
import { queryKeys } from '@/utils/queryKeys';
import { SEARCH_CACHE } from '@/utils/queryCacheConfig';
import { getCategoryOptions } from '../../constants';
import type { ListItemDataType } from './data.d';
import { queryFakeList } from './service';
import useStyles from './style.style';

const FormItem = Form.Item;
const { Paragraph } = Typography;
const getKey = (id: string, index: number) => `${id}-${index}`;
const formItemLayout = {
  wrapperCol: {
    xs: {
      span: 24,
    },
    sm: {
      span: 16,
    },
  },
};

const Projects: FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const categoryOptions = getCategoryOptions(intl.formatMessage.bind(intl));
  const [filters, setFilters] = useState<{
    category?: (string | number)[];
    author?: string;
  }>({});
  const { data, isLoading: loading } = useQuery({
    queryKey: queryKeys.search.projects(filters),
    queryFn: () =>
      queryFakeList({ count: 8, ...filters }).then((res) => res.data),
    staleTime: SEARCH_CACHE.staleTime, // 30 seconds
    gcTime: SEARCH_CACHE.gcTime, // 5 minutes
  });

  const run = (values: any) => {
    setFilters(values);
  };
  const list = data?.list || [];
  const cardList = list && (
    <List<ListItemDataType>
      rowKey="id"
      loading={loading}
      grid={{
        gutter: 16,
        xs: 1,
        sm: 2,
        md: 3,
        lg: 3,
        xl: 4,
        xxl: 4,
      }}
      dataSource={list}
      renderItem={(item) => (
        <List.Item>
          <Card
            className={styles.card}
            hoverable
            cover={<img alt={item.title} src={item.cover} />}
          >
            <Card.Meta
              title={<a href={item.href}>{item.title}</a>}
              description={
                <Paragraph
                  ellipsis={{
                    rows: 2,
                  }}
                >
                  {item.subDescription}
                </Paragraph>
              }
            />
            <div className={styles.cardItemContent}>
              <span>{dayjs(item.updatedAt).fromNow()}</span>
              <div className={styles.avatarList}>
                <AvatarList size="small">
                  {item.members.map((member, i) => (
                    <AvatarList.Item
                      key={getKey(item.id, i)}
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
  return (
    <div className={styles.coverCardList}>
      <Card variant="borderless">
        <Form
          layout="inline"
          onValuesChange={(_, values) => {
            // 表单项变化时请求数据
            // 模拟查询表单生效
            run(values);
          }}
        >
          <StandardFormRow
            title={intl.formatMessage({ id: 'pages.list.search.category' })}
            block
            style={{
              paddingBottom: 11,
            }}
          >
            <FormItem name="category">
              <TagSelect expandable>
                {categoryOptions.flatMap((category) =>
                  category.value !== undefined && category.value !== null
                    ? [
                        <TagSelect.Option
                          value={category.value}
                          key={category.value}
                        >
                          {category.label}
                        </TagSelect.Option>,
                      ]
                    : [],
                )}
              </TagSelect>
            </FormItem>
          </StandardFormRow>
          <StandardFormRow
            title={intl.formatMessage({ id: 'pages.list.search.otherOptions' })}
            grid
            last
          >
            <Row gutter={16}>
              <Col lg={8} md={10} sm={10} xs={24}>
                <FormItem
                  {...formItemLayout}
                  label={intl.formatMessage({ id: 'pages.list.search.author' })}
                  name="author"
                >
                  <Select
                    placeholder={intl.formatMessage({
                      id: 'pages.list.search.unlimited',
                    })}
                    style={{
                      maxWidth: 200,
                      width: '100%',
                    }}
                    options={[
                      {
                        label: '王昭君',
                        value: 'lisa',
                      },
                    ]}
                  />
                </FormItem>
              </Col>
              <Col lg={8} md={10} sm={10} xs={24}>
                <FormItem
                  {...formItemLayout}
                  label={intl.formatMessage({
                    id: 'pages.list.search.praiseRate',
                  })}
                  name="rate"
                >
                  <Select
                    placeholder={intl.formatMessage({
                      id: 'pages.list.search.unlimited',
                    })}
                    style={{
                      maxWidth: 200,
                      width: '100%',
                    }}
                    options={[
                      {
                        label: intl.formatMessage({
                          id: 'pages.list.search.excellent',
                        }),
                        value: 'good',
                      },
                      {
                        label: intl.formatMessage({
                          id: 'pages.list.search.normal',
                        }),
                        value: 'normal',
                      },
                    ]}
                  />
                </FormItem>
              </Col>
            </Row>
          </StandardFormRow>
        </Form>
      </Card>
      <div className={styles.cardList}>{cardList}</div>
    </div>
  );
};
export default Projects;
