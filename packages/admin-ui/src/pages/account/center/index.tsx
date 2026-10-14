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
import React, { useCallback, useRef, useState } from 'react';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import { USER_CACHE } from '@/utils/queryCacheConfig';
import { queryKeys } from '@/utils/queryKeys';
import Applications from './components/Applications';
import Articles from './components/Articles';
import Projects from './components/Projects';
import type { CurrentUser, TagType, tabKeyType } from './data';
import type { SelfAccountCenterPageAPI } from './page-api';
import { queryCurrent } from './service';
import useStyles from './style';

/**
 * Build the tab list for the right-side content area.
 *
 * NOTE: The counts shown in tabs (e.g., "(8)") are currently mock placeholders
 * because the backend does not yet expose dedicated count endpoints for articles,
 * applications, and projects. Once those endpoints are available, replace the
 * hardcoded numbers with real API data.
 *
 * TODO: Fetch real counts from backend API when available (see issue #XYZ).
 *
 * @param intl - Intl shape from useIntl()
 * @param counts - Optional counts per tab key; falls back to static placeholders if undefined
 */
const getOperationTabList = (
  intl: any,
  counts?: Partial<Record<tabKeyType, number>>,
) => [
  {
    key: 'articles' as const,
    tab: (
      <span>
        {intl.formatMessage({
          id: 'pages.account.center.articles',
          defaultMessage: 'Article',
        })}{' '}
        <span style={{ fontSize: 14 }}>
          ({counts?.articles ?? '—'})
        </span>
      </span>
    ),
  },
  {
    key: 'applications' as const,
    tab: (
      <span>
        {intl.formatMessage({
          id: 'pages.account.center.applications',
          defaultMessage: 'Application',
        })}{' '}
        <span style={{ fontSize: 14 }}>
          ({counts?.applications ?? '—'})
        </span>
      </span>
    ),
  },
  {
    key: 'projects' as const,
    tab: (
      <span>
        {intl.formatMessage({
          id: 'pages.account.center.projects',
          defaultMessage: 'Project',
        })}{' '}
        <span style={{ fontSize: 14 }}>
          ({counts?.projects ?? '—'})
        </span>
      </span>
    ),
  },
];
/** Tag list component supporting dynamic addition of new tags */
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
          defaultMessage: 'Tag',
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
/** Display user basic info: job title, team, and location */
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
            marginInlineEnd: 8,
          }}
        />
        {user.title}
      </p>
      <p>
        <ClusterOutlined
          style={{
            marginInlineEnd: 8,
          }}
        />
        {user.group}
      </p>
      <p>
        <HomeOutlined
          style={{
            marginInlineEnd: 8,
          }}
        />
        {geographic.province.label}
        {geographic.city.label}
      </p>
    </div>
  );
};

/** Render content component based on the selected tab key */
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
  // TODO: Replace with real counts from backend when API is available.
  // For now, pass undefined so tabs show '—' instead of misleading hardcoded numbers.
  const operationTabList = getOperationTabList(intl);

  // Fetch user info (scoped under currentUser.center to avoid cache conflicts)
  const {
    data: currentUser,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.currentUser.center(),
    queryFn: () => queryCurrent().then((res) => res.data),
    staleTime: USER_CACHE.staleTime, // 5 minutes
    gcTime: USER_CACHE.gcTime, // 30 minutes
  });

  // Register Page API for selfAccount function group
  usePageAPIRegistration(
    'selfAccountCenter',
    useCallback(
      (): SelfAccountCenterPageAPI => ({
        getProfile: async () => {
          try {
            const result = await queryCurrent();
            return {
              success: true,
              data: result.data,
            };
          } catch (err) {
            console.error(
              '[SelfAccountCenter Page API] getProfile failed:',
              err,
            );
            return {
              success: false,
              data: null,
              error: 'Failed to get user profile',
            };
          }
        },
      }),
      [],
    ),
  );

  // Show error result when API request fails
  if (isError) {
    return (
      <GridContent>
        <Result
          status="error"
          title={intl.formatMessage({
            id: 'pages.account.center.loadError',
            defaultMessage: 'Loading failed',
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
            loading={isLoading}
          >
            {!isLoading && currentUser && (
              <>
                <div className={styles.avatarHolder}>
                  <img
                    alt={intl.formatMessage({
                      id: 'pages.account.center.avatar',
                      defaultMessage: 'Avatar',
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
                      defaultMessage: 'Team',
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
