import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getLocale, useIntl } from '@umijs/max';
import {
  Avatar,
  Button,
  Card,
  Col,
  Dropdown,
  Input,
  List,
  Modal,
  Progress,
  Row,
  Segmented,
} from 'antd';
import dayjs from 'dayjs';
import type { FC } from 'react';
import React, { useState } from 'react';
import { queryKeys } from '@/utils/queryKeys';
import { LIST_CACHE } from '@/utils/queryCacheConfig';
import OperationModal from './components/OperationModal';
import type { BasicListItemDataType } from './data.d';
import {
  addFakeList,
  queryFakeList,
  removeFakeList,
  updateFakeList,
} from './service';
import useStyles from './style.style';

const { Search } = Input;
const Info: FC<{
  title: React.ReactNode;
  value: React.ReactNode;
  bordered?: boolean;
}> = ({ title, value, bordered }) => {
  const { styles } = useStyles();
  return (
    <div className={styles.headerInfo}>
      <span>{title}</span>
      <p>{value}</p>
      {bordered && <em />}
    </div>
  );
};
const ListContent = ({
  data: { owner, createdAt, percent, status },
}: {
  data: BasicListItemDataType;
}) => {
  const { styles } = useStyles();
  const intl = useIntl();
  return (
    <div>
      <div className={styles.listContentItem}>
        <span>{intl.formatMessage({ id: 'pages.list.basicList.owner' })}</span>
        <p>{owner}</p>
      </div>
      <div className={styles.listContentItem}>
        <span>
          {intl.formatMessage({
            id: 'pages.list.basicList.startTime',
            defaultMessage: 'Start time',
          })}
        </span>
        <p>{dayjs(createdAt).locale(getLocale()).format('L LT')}</p>
      </div>
      <div className={styles.listContentItem}>
        <Progress
          percent={percent}
          status={status}
          size={6}
          style={{
            width: 180,
          }}
        />
      </div>
    </div>
  );
};
const BasicList: FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const [done, setDone] = useState<boolean>(false);
  const [open, setVisible] = useState<boolean>(false);
  const [current, setCurrent] = useState<
    Partial<BasicListItemDataType> | undefined
  >(undefined);
  const { data: listData, isLoading: loading } = useQuery({
    queryKey: queryKeys.basicList.all,
    queryFn: () => queryFakeList({ count: 50 }).then((res) => res.data),
    staleTime: LIST_CACHE.staleTime, // 2 minutes
    gcTime: LIST_CACHE.gcTime, // 10 minutes
  });

  const queryClient = useQueryClient();
  const { mutate: postRun } = useMutation({
    mutationFn: async ({ method, params }: { method: string; params: any }) => {
      if (method === 'remove') {
        return removeFakeList(params);
      }
      if (method === 'update') {
        return updateFakeList(params);
      }
      return addFakeList(params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.basicList.all });
    },
  });

  // Wrapper to handle the original calling convention
  const runListOperation = (method: string, params: any) => {
    postRun({ method, params });
  };
  const list = listData?.list || [];
  const paginationProps = {
    showSizeChanger: true,
    showQuickJumper: true,
    pageSize: 5,
    total: list.length,
  };
  const showEditModal = (item: BasicListItemDataType) => {
    setVisible(true);
    setCurrent(item);
  };
  const deleteItem = (id: string) => {
    runListOperation('remove', {
      id,
    });
  };
  const editAndDelete = (
    key: string | number,
    currentItem: BasicListItemDataType,
  ) => {
    if (key === 'edit') showEditModal(currentItem);
    else if (key === 'delete') {
      Modal.confirm({
        title: intl.formatMessage({
          id: 'pages.list.basicList.deleteTask',
          defaultMessage: 'Delete task',
        }),
        content: intl.formatMessage({
          id: 'pages.list.basicList.deleteConfirm',
          defaultMessage: 'Are you sure you want to delete this task?',
        }),
        okText: intl.formatMessage({
          id: 'pages.list.basicList.okText',
          defaultMessage: 'Confirm',
        }),
        cancelText: intl.formatMessage({
          id: 'pages.list.basicList.cancelText',
          defaultMessage: 'Cancel',
        }),
        onOk: () => deleteItem(currentItem.id),
      });
    }
  };
  const extraContent = (
    <div>
      <Segmented
        defaultValue="all"
        options={[
          {
            label: intl.formatMessage({
              id: 'pages.list.basicList.filter.all',
              defaultMessage: 'All',
            }),
            value: 'all',
          },
          {
            label: intl.formatMessage({
              id: 'pages.list.basicList.filter.progress',
              defaultMessage: 'In progress',
            }),
            value: 'progress',
          },
          {
            label: intl.formatMessage({
              id: 'pages.list.basicList.filter.waiting',
              defaultMessage: 'Waiting',
            }),
            value: 'waiting',
          },
        ]}
        // 如有需要可添加 onChange 事件
      />
      <Search
        className={styles.extraContentSearch}
        placeholder={intl.formatMessage({
          id: 'pages.list.basicList.searchPlaceholder',
          defaultMessage: 'Please enter',
        })}
        onSearch={() => ({})}
        variant="filled"
      />
    </div>
  );

  const renderMoreBtn = (item: BasicListItemDataType) => {
    return (
      <Dropdown
        menu={{
          onClick: ({ key }) => editAndDelete(key, item),
          items: [
            {
              key: 'edit',
              label: intl.formatMessage({
                id: 'pages.list.basicList.action.edit',
                defaultMessage: 'Edit',
              }),
            },
            {
              key: 'delete',
              label: intl.formatMessage({
                id: 'pages.list.basicList.action.delete',
                defaultMessage: 'Delete',
              }),
            },
          ],
        }}
      >
        <Button type="link">
          {intl.formatMessage({
            id: 'pages.list.basicList.more',
            defaultMessage: 'More',
          })}{' '}
          <DownOutlined />
        </Button>
      </Dropdown>
    );
  };

  const handleDone = () => {
    setDone(false);
    setVisible(false);
    setCurrent({});
  };
  const handleSubmit = (values: BasicListItemDataType) => {
    setDone(true);
    const method = values?.id ? 'update' : 'add';
    runListOperation(method, values);
  };
  return (
    <div>
      <PageContainer>
        <div className={styles.standardList}>
          <Card variant="borderless">
            <Row>
              <Col sm={8} xs={24}>
                <Info
                  title={intl.formatMessage({
                    id: 'pages.list.basicList.info.myTodo',
                    defaultMessage: 'My to-dos',
                  })}
                  value={intl.formatMessage({
                    id: 'pages.list.basicList.info.myTodoValue',
                    defaultMessage: '8 tasks',
                  })}
                  bordered
                />
              </Col>
              <Col sm={8} xs={24}>
                <Info
                  title={intl.formatMessage({
                    id: 'pages.list.basicList.info.avgTime',
                    defaultMessage: 'Average task processing time this week',
                  })}
                  value={intl.formatMessage({
                    id: 'pages.list.basicList.info.avgTimeValue',
                    defaultMessage: '32 minutes',
                  })}
                  bordered
                />
              </Col>
              <Col sm={8} xs={24}>
                <Info
                  title={intl.formatMessage({
                    id: 'pages.list.basicList.info.completed',
                    defaultMessage: 'Tasks completed this week',
                  })}
                  value={intl.formatMessage({
                    id: 'pages.list.basicList.info.completedValue',
                    defaultMessage: '24 tasks',
                  })}
                />
              </Col>
            </Row>
          </Card>

          <Card
            className={styles.listCard}
            variant="borderless"
            title={intl.formatMessage({
              id: 'pages.list.basicList.cardTitle',
              defaultMessage: 'Basic list',
            })}
            style={{
              marginTop: 24,
            }}
            styles={{
              body: {
                padding: '0 32px 40px 32px',
              },
            }}
            extra={extraContent}
          >
            <List
              size="large"
              rowKey="id"
              loading={loading}
              pagination={paginationProps}
              dataSource={list}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="edit"
                      type="link"
                      onClick={() => showEditModal(item)}
                    >
                      {intl.formatMessage({
                        id: 'pages.list.basicList.action.edit',
                        defaultMessage: 'Edit',
                      })}
                    </Button>,
                    renderMoreBtn(item),
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar src={item.logo} shape="square" size="large" />
                    }
                    title={<a href={item.href}>{item.title}</a>}
                    description={item.subDescription}
                  />
                  <ListContent data={item} />
                </List.Item>
              )}
            />
          </Card>
        </div>
      </PageContainer>
      <Button
        type="dashed"
        onClick={() => {
          setVisible(true);
        }}
        style={{
          width: '100%',
          marginBottom: 8,
        }}
      >
        <PlusOutlined />
        {intl.formatMessage({
          id: 'pages.list.basicList.add',
          defaultMessage: 'Add',
        })}
      </Button>
      <OperationModal
        done={done}
        open={open}
        current={current}
        onDone={handleDone}
        onSubmit={handleSubmit}
      />
    </div>
  );
};
export default BasicList;
