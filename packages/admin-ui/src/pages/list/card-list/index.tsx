import { PlusOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, List, Typography } from 'antd';
import { useIntl } from '@umijs/max';
import { queryKeys } from '@/utils/queryKeys';
import { LIST_CACHE } from '@/utils/queryCacheConfig';
import type { CardListItemDataType } from './data.d';
import { queryFakeList } from './service';
import useStyles from './style.style';

const { Paragraph } = Typography;
const nullData: Partial<CardListItemDataType> = {};

const CardList = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const { data, isLoading: loading } = useQuery({
    queryKey: queryKeys.cardList.all,
    queryFn: () => queryFakeList({ count: 8 }).then((res) => res.data),
    staleTime: LIST_CACHE.staleTime, // 2 minutes
    gcTime: LIST_CACHE.gcTime, // 10 minutes
  });
  const list = data?.list || [];
  const content = (
    <div className={styles.pageHeaderContent}>
      <p>
        {intl.formatMessage({
          id: 'pages.list.cardList.description',
          defaultMessage:
            'Paragraph demo: Ant Design design platform ant.design, with minimal workload, seamlessly integrated into the Ant Design ecosystem, providing experience solutions that span design and development.',
        })}
      </p>
      <div className={styles.contentLink}>
        <a href="https://pro.ant.design/zh-CN/docs/getting-started">
          <img
            alt=""
            src="https://gw.alipayobjects.com/zos/rmsportal/MjEImQtenlyueSmVEfUD.svg"
          />{' '}
          {intl.formatMessage({
            id: 'pages.list.cardList.quickStart',
            defaultMessage: 'Quick Start',
          })}
        </a>
        <a href="https://pro.ant.design/zh-CN/docs/introduction">
          <img
            alt=""
            src="https://gw.alipayobjects.com/zos/rmsportal/NbuDUAuBlIApFuDvWiND.svg"
          />{' '}
          {intl.formatMessage({
            id: 'pages.list.cardList.productIntro',
            defaultMessage: 'Product Introduction',
          })}
        </a>
        <a href="https://pro.ant.design/zh-CN/docs/overview">
          <img
            alt=""
            src="https://gw.alipayobjects.com/zos/rmsportal/ohOEPSYdDTNnyMbGuyLb.svg"
          />{' '}
          {intl.formatMessage({
            id: 'pages.list.cardList.productDocs',
            defaultMessage: 'Product Documentation',
          })}
        </a>
      </div>
    </div>
  );
  const extraContent = (
    <div className={styles.extraImg}>
      <img
        alt={intl.formatMessage({
          id: 'pages.list.cardList.headerImageAlt',
          defaultMessage: 'This is a title',
        })}
        src="https://gw.alipayobjects.com/zos/rmsportal/RzwpdLnhmvDJToTdfDPe.png"
      />
    </div>
  );
  return (
    <PageContainer content={content} extraContent={extraContent}>
      <div className={styles.cardList}>
        <List<Partial<CardListItemDataType>>
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
          dataSource={[nullData, ...list]}
          renderItem={(item) => {
            if (item?.id) {
              return (
                <List.Item key={item.id}>
                  <Card
                    hoverable
                    className={styles.card}
                    actions={[
                      <Button key="option1" type="link">
                        {intl.formatMessage({
                          id: 'pages.list.cardList.action1',
                          defaultMessage: 'Action 1',
                        })}
                      </Button>,
                      <Button key="option2" type="link">
                        {intl.formatMessage({
                          id: 'pages.list.cardList.action2',
                          defaultMessage: 'Action 2',
                        })}
                      </Button>,
                    ]}
                  >
                    <Card.Meta
                      avatar={
                        <img
                          alt=""
                          className={styles.cardAvatar}
                          src={item.avatar}
                        />
                      }
                      title={<a href={item.href}>{item.title}</a>}
                      description={
                        <Paragraph
                          className={styles.item}
                          ellipsis={{
                            rows: 3,
                          }}
                        >
                          {item.description}
                        </Paragraph>
                      }
                    />
                  </Card>
                </List.Item>
              );
            }
            return (
              <List.Item>
                <Button type="dashed" className={styles.newButton}>
                  <PlusOutlined />{' '}
                  {intl.formatMessage({
                    id: 'pages.list.cardList.newProduct',
                    defaultMessage: 'New Product',
                  })}
                </Button>
              </List.Item>
            );
          }}
        />
      </div>
    </PageContainer>
  );
};
export default CardList;
