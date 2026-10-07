import {
  ClusterOutlined,
  ContactsOutlined,
  HomeOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { GridContent } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from '@umijs/max';
import {
  Avatar,
  Card,
  Col,
  Divider,
  Flex,
  Input,
  type InputRef,
  Result,
  Row,
  Tag,
} from 'antd';
import React, { useRef, useState } from 'react';
import useStyles from './Center.style';
import Applications from './components/Applications';
import Articles from './components/Articles';
import Projects from './components/Projects';
import type { CurrentUser, TagType, tabKeyType } from './data.d';
import { queryCurrent } from './service';

/**
 * 构建右侧内容区域的 Tab 列表
 * 每个 Tab 显示国际化文本及对应的条目数量（当前为静态值）
 */
const getOperationTabList = (intl: any) => [
  {
    key: 'articles',
    tab: (
      <span>
        {intl.formatMessage({
          id: 'pages.account.center.articles',
          defaultMessage: '文章',
        })}{' '}
        <span
          style={{
            fontSize: 14,
          }}
        >
          (8)
        </span>
      </span>
    ),
  },
  {
    key: 'applications',
    tab: (
      <span>
        {intl.formatMessage({
          id: 'pages.account.center.applications',
          defaultMessage: '应用',
        })}{' '}
        <span
          style={{
            fontSize: 14,
          }}
        >
          (8)
        </span>
      </span>
    ),
  },
  {
    key: 'projects',
    tab: (
      <span>
        {intl.formatMessage({
          id: 'pages.account.center.projects',
          defaultMessage: '项目',
        })}{' '}
        <span
          style={{
            fontSize: 14,
          }}
        >
          (8)
        </span>
      </span>
    ),
  },
];
/** 用户标签列表，支持动态添加新标签 */
const TagList: React.FC<{
  tags: CurrentUser['tags'];
}> = ({ tags }) => {
  const { styles } = useStyles();
  const intl = useIntl();
  const ref = useRef<InputRef | null>(null);
  const [newTags, setNewTags] = useState<TagType[]>([]);
  const [inputVisible, setInputVisible] = useState<boolean>(false);
  const [inputValue, setInputValue] = useState<string>('');
  const showInput = () => {
    setInputVisible(true);
    if (ref.current) {
      ref.current.focus();
    }
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };
  const handleInputConfirm = () => {
    let tempsTags = [...newTags];
    if (
      inputValue &&
      tempsTags.filter((tag) => tag.label === inputValue).length === 0
    ) {
      tempsTags = [
        ...tempsTags,
        {
          key: `new-${Date.now()}`,
          label: inputValue,
        },
      ];
    }
    setNewTags(tempsTags);
    setInputVisible(false);
    setInputValue('');
  };
  return (
    <div className={styles.tags}>
      <div className={styles.tagsTitle}>
        {intl.formatMessage({
          id: 'pages.account.center.tags',
          defaultMessage: '标签',
        })}
      </div>
      <Flex wrap gap="small">
        {(tags || []).concat(newTags).map((item) => (
          <Tag key={item.key}>{item.label}</Tag>
        ))}
        {inputVisible && (
          <Input
            ref={ref}
            size="small"
            style={{
              width: 78,
            }}
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputConfirm}
            onPressEnter={handleInputConfirm}
          />
        )}
        {!inputVisible && (
          <Tag
            onClick={showInput}
            style={{
              borderStyle: 'dashed',
            }}
          >
            <PlusOutlined />
          </Tag>
        )}
      </Flex>
    </div>
  );
};
/** 展示用户的基本信息：职位、团队、所在地 */
const GEOGRAPHIC_DEFAULT = {
  province: { label: '' },
  city: { label: '' },
} as const;

const UserInfo: React.FC<{ user: Partial<CurrentUser> }> = ({ user }) => {
  const { styles } = useStyles();
  const geographic = user.geographic || GEOGRAPHIC_DEFAULT;
  return (
    <div className={styles.detail}>
      <p>
        <ContactsOutlined
          style={{
            marginRight: 8,
          }}
        />
        {user.title}
      </p>
      <p>
        <ClusterOutlined
          style={{
            marginRight: 8,
          }}
        />
        {user.group}
      </p>
      <p>
        <HomeOutlined
          style={{
            marginRight: 8,
          }}
        />
        {geographic.province.label}
        {geographic.city.label}
      </p>
    </div>
  );
};

/** 根据选中的 Tab 键渲染对应的内容组件 */
const TabContent: React.FC<{ tabValue: tabKeyType }> = ({ tabValue }) => {
  if (tabValue === 'projects') {
    return <Projects />;
  }
  if (tabValue === 'applications') {
    return <Applications />;
  }
  if (tabValue === 'articles') {
    return <Articles />;
  }
  return null;
};

const Center: React.FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const [tabKey, setTabKey] = useState<tabKeyType>('articles');
  const operationTabList = getOperationTabList(intl);

  // 获取用户信息（使用独立 queryKey 避免与其他页面的 current-user 查询冲突）
  const {
    data: currentUser,
    isLoading: loading,
    isError,
    error,
  } = useQuery({
    queryKey: ['current-user', 'center'],
    queryFn: () => queryCurrent().then((res) => res.data),
  });

  // API 请求失败时显示错误提示
  if (isError) {
    return (
      <GridContent>
        <Result
          status="error"
          title={intl.formatMessage({
            id: 'pages.account.center.loadError',
            defaultMessage: '加载失败',
          })}
          subTitle={error?.message}
        />
      </GridContent>
    );
  }

  return (
    <GridContent>
      <Row gutter={24}>
        <Col lg={7} md={24}>
          <Card
            variant="borderless"
            style={{
              marginBottom: 24,
            }}
            loading={loading}
          >
            {!loading && currentUser && (
              <>
                <div className={styles.avatarHolder}>
                  <img
                    alt={intl.formatMessage({
                      id: 'pages.account.center.avatar',
                      defaultMessage: '头像',
                    })}
                    src={currentUser.avatar}
                  />
                  <div className={styles.name}>{currentUser.name}</div>
                  <div>{currentUser?.signature}</div>
                </div>
                <UserInfo user={currentUser} />
                <Divider dashed />
                <TagList tags={currentUser.tags || []} />
                <Divider
                  style={{
                    marginTop: 16,
                  }}
                  dashed
                />
                <div className={styles.team}>
                  <div className={styles.teamTitle}>
                    {intl.formatMessage({
                      id: 'pages.account.center.team',
                      defaultMessage: '团队',
                    })}
                  </div>
                  <Row gutter={36}>
                    {currentUser.notice?.map((item) => (
                      <Col key={item.id} lg={24} xl={12}>
                        <a href={item.href}>
                          <Avatar size="small" src={item.logo} />
                          {item.member}
                        </a>
                      </Col>
                    ))}
                  </Row>
                </div>
              </>
            )}
          </Card>
        </Col>
        <Col lg={17} md={24}>
          <Card
            className={styles.tabsCard}
            variant="borderless"
            tabList={operationTabList}
            activeTabKey={tabKey}
            onTabChange={(_tabKey: string) => {
              setTabKey(_tabKey as tabKeyType);
            }}
          >
            <TabContent tabValue={tabKey} />
          </Card>
        </Col>
      </Row>
    </GridContent>
  );
};
export default Center;
