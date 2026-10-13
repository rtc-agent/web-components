import { PageContainer } from '@ant-design/pro-components';
import { history, Outlet, useLocation, useMatch, useIntl } from '@umijs/max';
import { Input } from 'antd';
import type { FC } from 'react';

type SearchProps = {
  children?: React.ReactNode;
};

const Search: FC<SearchProps> = () => {
  const intl = useIntl();
  const location = useLocation();
  const match = useMatch(location.pathname);

  const tabList = [
    {
      key: 'articles',
      tab: intl.formatMessage({
        id: 'pages.list.search.tab.articles',
        defaultMessage: 'Articles',
      }),
    },
    {
      key: 'projects',
      tab: intl.formatMessage({
        id: 'pages.list.search.tab.projects',
        defaultMessage: 'Projects',
      }),
    },
    {
      key: 'applications',
      tab: intl.formatMessage({
        id: 'pages.list.search.tab.applications',
        defaultMessage: 'Applications',
      }),
    },
  ];

  const handleTabChange = (key: string) => {
    const url =
      match?.pathname === '/'
        ? ''
        : match?.pathname.substring(0, match.pathname.lastIndexOf('/'));
    switch (key) {
      case 'articles':
        history.push(`${url}/articles`);
        break;
      case 'applications':
        history.push(`${url}/applications`);
        break;
      case 'projects':
        history.push(`${url}/projects`);
        break;
      default:
        break;
    }
  };

  const getTabKey = () => {
    const tabKey = location.pathname.substring(
      location.pathname.lastIndexOf('/') + 1,
    );
    if (tabKey && tabKey !== '/') {
      return tabKey;
    }
    return 'articles';
  };

  return (
    <PageContainer
      content={
        <div style={{ textAlign: 'center' }}>
          <Input.Search
            placeholder={intl.formatMessage({
              id: 'pages.list.search.inputPlaceholder',
              defaultMessage: 'Please enter',
            })}
            enterButton={intl.formatMessage({
              id: 'pages.list.search.searchButton',
              defaultMessage: 'Search',
            })}
            size="large"
            style={{ maxWidth: 522, width: '100%' }}
          />
        </div>
      }
      tabList={tabList}
      tabActiveKey={getTabKey()}
      onTabChange={handleTabChange}
    >
      <Outlet />
    </PageContainer>
  );
};

export default Search;
