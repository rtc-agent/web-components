import {
  LikeOutlined,
  LoadingOutlined,
  MessageOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Flex, Form, List, Row, Select, Tag } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import type { FC } from 'react';
import React, { useMemo, useRef } from 'react';
import { useIntl } from '@umijs/max';
import { ArticleListContent, StandardFormRow, TagSelect } from '@/components';
import { categoryOptions } from '../../constants';
import type { ListItemDataType } from './data.d';
import { queryFakeList } from './service';
import useStyles from './style.style';

const FormItem = Form.Item;

const pageSize = 5;
const owners = [
  {
    id: 'wzj',
    name: '我自己',
  },
  {
    id: 'wjh',
    name: '吴家豪',
  },
  {
    id: 'zxx',
    name: '周星星',
  },
  {
    id: 'zly',
    name: '赵丽颖',
  },
  {
    id: 'ym',
    name: '姚明',
  },
];
const formItemLayout = {
  wrapperCol: {
    xs: { span: 24 },
    sm: { span: 24 },
    md: { span: 12 },
  },
};

const IconText: React.FC<{
  type: string;
  text: React.ReactNode;
}> = ({ type, text }) => {
  switch (type) {
    case 'star-o':
      return (
        <span>
          <StarOutlined style={{ marginRight: 8 }} />
          {text}
        </span>
      );
    case 'like-o':
      return (
        <span>
          <LikeOutlined style={{ marginRight: 8 }} />
          {text}
        </span>
      );
    case 'message':
      return (
        <span>
          <MessageOutlined style={{ marginRight: 8 }} />
          {text}
        </span>
      );
    default:
      return null;
  }
};

const Articles: FC = () => {
  const [form] = Form.useForm();
  const { styles } = useStyles();
  const intl = useIntl();
  const filtersRef = useRef<{
    category?: (string | number)[];
    owner?: string[];
  }>({});

  const {
    data,
    isLoading: loading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['search-articles', pageSize, filtersRef.current],
    queryFn: () =>
      queryFakeList({ count: pageSize, ...filtersRef.current }).then(
        (res) => res.data,
      ),
  });

  const loadMore = () => {
    refetch();
  };
  const loadingMore = isFetching;
  const reload = () => {
    filtersRef.current = form.getFieldsValue();
    refetch();
  };

  const list = data?.list || [];
  const listItemExtra = <div className={styles.listItemExtra} />;

  const setOwner = () => {
    const owner = ['wzj'];
    form.setFieldsValue({
      owner,
    });
    filtersRef.current = {
      ...filtersRef.current,
      owner,
    };
    refetch();
  };

  const loadMoreDom = list.length > 0 && (
    <div style={{ textAlign: 'center', marginTop: 16 }}>
      <Button onClick={loadMore} style={{ paddingLeft: 48, paddingRight: 48 }}>
        {loadingMore ? (
          <span>
            <LoadingOutlined /> {intl.formatMessage({ id: 'pages.list.search.loading' })}
          </span>
        ) : (
          intl.formatMessage({ id: 'pages.list.search.loadMore' })
        )}
      </Button>
    </div>
  );

  const ownerOptions = useMemo<DefaultOptionType[]>(
    () =>
      owners.map((item) => ({
        label: item.name,
        value: item.id,
      })),
    [],
  );

  return (
    <>
      <Card variant="borderless">
        <Form
          layout="inline"
          form={form}
          initialValues={{
            owner: ['wjh', 'zxx'],
          }}
          onValuesChange={reload}
        >
          <StandardFormRow title={intl.formatMessage({ id: 'pages.list.search.category' })} block style={{ paddingBottom: 11 }}>
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
          <StandardFormRow title="owner" grid>
            <FormItem name="owner" noStyle>
              <Select
                mode="multiple"
                placeholder={intl.formatMessage({ id: 'pages.list.search.selectOwner' })}
                style={{ minWidth: '6rem' }}
                options={ownerOptions}
              />
            </FormItem>
            <Button
              type="link"
              className={styles.selfTrigger}
              onClick={setOwner}
            >
              {intl.formatMessage({ id: 'pages.list.search.onlyMine' })}
            </Button>
          </StandardFormRow>
          <StandardFormRow title={intl.formatMessage({ id: 'pages.list.search.otherOptions' })} grid last>
            <Row gutter={16}>
              <Col xl={8} lg={10} md={12} sm={24} xs={24}>
                <FormItem {...formItemLayout} label={intl.formatMessage({ id: 'pages.list.search.activeUser' })} name="user">
                  <Select
                    placeholder={intl.formatMessage({ id: 'pages.list.search.unlimited' })}
                    style={{ maxWidth: 200, width: '100%' }}
                    options={[
                      {
                        label: '李三',
                        value: 'lisa',
                      },
                    ]}
                  />
                </FormItem>
              </Col>
              <Col xl={8} lg={10} md={12} sm={24} xs={24}>
                <FormItem {...formItemLayout} label={intl.formatMessage({ id: 'pages.list.search.praiseRate' })} name="rate">
                  <Select
                    placeholder={intl.formatMessage({ id: 'pages.list.search.unlimited' })}
                    style={{ maxWidth: 200, width: '100%' }}
                    options={[
                      {
                        label: intl.formatMessage({ id: 'pages.list.search.excellent' }),
                        value: 'good',
                      },
                    ]}
                  />
                </FormItem>
              </Col>
            </Row>
          </StandardFormRow>
        </Form>
      </Card>
      <Card
        style={{ marginTop: 24 }}
        variant="borderless"
        styles={{
          body: {
            padding: '8px 32px 32px 32px',
          },
        }}
      >
        <List<ListItemDataType>
          size="large"
          loading={loading}
          rowKey="id"
          itemLayout="vertical"
          dataSource={list}
          renderItem={(item) => (
            <List.Item
              key={item.id}
              actions={[
                <IconText key="star" type="star-o" text={item.star} />,
                <IconText key="like" type="like-o" text={item.like} />,
                <IconText key="message" type="message" text={item.message} />,
              ]}
              extra={listItemExtra}
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
                    <Tag>{intl.formatMessage({ id: 'pages.account.center.designLanguage' })}</Tag>
                    <Tag>{intl.formatMessage({ id: 'pages.account.center.antGroup' })}</Tag>
                  </Flex>
                }
              />
              <ArticleListContent data={item} />
            </List.Item>
          )}
        />
        {loadMoreDom}
      </Card>
    </>
  );
};

export default Articles;
