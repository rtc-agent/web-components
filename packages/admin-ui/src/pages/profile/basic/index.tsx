import type { ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import type { DescriptionsProps } from 'antd';
import { Badge, Card, Descriptions, Divider, Table } from 'antd';
import type { FC } from 'react';
import React from 'react';
import { queryKeys } from '@/utils/queryKeys';
import { PROFILE_CACHE } from '@/utils/queryCacheConfig';
import type { BasicGood, BasicProgress } from './data.d';
import { queryBasicProfile } from './service';

const Basic: FC = () => {
  const intl = useIntl();

  const progressColumns: ProColumns<BasicProgress>[] = [
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.time' }),
      dataIndex: 'time',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.rate' }),
      dataIndex: 'rate',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.status' }),
      dataIndex: 'status',
      render: (text: React.ReactNode) => {
        if (text === 'success') {
          return (
            <Badge
              status="success"
              text={intl.formatMessage({
                id: 'pages.profile.basic.status.success',
              })}
            />
          );
        }
        return (
          <Badge
            status="processing"
            text={intl.formatMessage({
              id: 'pages.profile.basic.status.processing',
            })}
          />
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.operator' }),
      dataIndex: 'operator',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.cost' }),
      dataIndex: 'cost',
    },
  ];

  const goodsColumns: ProColumns<BasicGood>[] = [
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.id' }),
      dataIndex: 'id',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.name' }),
      dataIndex: 'name',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.barcode' }),
      dataIndex: 'barcode',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.price' }),
      dataIndex: 'price',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.num' }),
      dataIndex: 'num',
      align: 'right',
    },
    {
      title: intl.formatMessage({ id: 'pages.profile.basic.column.amount' }),
      dataIndex: 'amount',
      align: 'right',
    },
  ];

  const Descriptions1: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({
        id: 'pages.profile.basic.desc.pickupOrderNo',
      }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.mock.pickupOrderNo',
      }),
    },
    {
      key: '2',
      label: intl.formatMessage({ id: 'pages.profile.basic.desc.status' }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.desc.statusValue.picked',
      }),
    },
    {
      key: '3',
      label: intl.formatMessage({
        id: 'pages.profile.basic.desc.salesOrderNo',
      }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.mock.salesOrderNo',
      }),
    },
    {
      key: '4',
      label: intl.formatMessage({ id: 'pages.profile.basic.desc.subOrder' }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.mock.subOrder',
      }),
    },
  ];

  const Descriptions2: DescriptionsProps['items'] = [
    {
      key: '1',
      label: intl.formatMessage({ id: 'pages.profile.basic.desc.userName' }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.mock.userName',
      }),
    },
    {
      key: '2',
      label: intl.formatMessage({ id: 'pages.profile.basic.desc.phone' }),
      children: intl.formatMessage({ id: 'pages.profile.basic.mock.phone' }),
    },
    {
      key: '3',
      label: intl.formatMessage({ id: 'pages.profile.basic.desc.express' }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.mock.express',
      }),
    },
    {
      key: '4',
      label: intl.formatMessage({ id: 'pages.profile.basic.desc.address' }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.mock.address',
      }),
    },
    {
      key: '5',
      label: intl.formatMessage({ id: 'pages.profile.basic.desc.remark' }),
      children: intl.formatMessage({
        id: 'pages.profile.basic.desc.remarkNone',
      }),
    },
  ];

  const { data, isLoading: loading } = useQuery({
    queryKey: queryKeys.profile.basic(),
    queryFn: () => queryBasicProfile().then((res) => res.data),
    staleTime: PROFILE_CACHE.staleTime, // 5 minutes
    gcTime: PROFILE_CACHE.gcTime, // 30 minutes
  });
  const { basicGoods, basicProgress } = data || {
    basicGoods: [],
    basicProgress: [],
  };
  return (
    <PageContainer>
      <Card variant="borderless">
        <Descriptions
          title={intl.formatMessage({
            id: 'pages.profile.basic.title.refundApplication',
          })}
          items={Descriptions1}
        />
        <Divider size="large" />
        <Descriptions
          title={intl.formatMessage({
            id: 'pages.profile.basic.title.userInfo',
          })}
          items={Descriptions2}
        />
        <Divider size="large" />
        <ProTable
          headerTitle={intl.formatMessage({
            id: 'pages.profile.basic.title.returnedGoods',
          })}
          style={{
            marginBottom: 24,
          }}
          pagination={false}
          search={false}
          loading={loading}
          options={false}
          dataSource={basicGoods}
          ghost
          columns={goodsColumns}
          rowKey="id"
          summary={(pageData) => {
            let totalNum = 0;
            let totalAmount = 0;
            pageData.forEach(({ num, amount }) => {
              totalNum += Number(num);
              totalAmount += Number(amount);
            });
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}>
                  <span style={{ fontWeight: 600 }}>
                    {intl.formatMessage({ id: 'pages.profile.basic.total' })}
                  </span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <span style={{ fontWeight: 600 }}>{totalNum}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <span style={{ fontWeight: 600 }}>{totalAmount}</span>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
        <ProTable
          headerTitle={intl.formatMessage({
            id: 'pages.profile.basic.title.returnProgress',
          })}
          pagination={false}
          loading={loading}
          search={false}
          options={false}
          ghost
          dataSource={basicProgress}
          columns={progressColumns}
        />
      </Card>
    </PageContainer>
  );
};
export default Basic;
