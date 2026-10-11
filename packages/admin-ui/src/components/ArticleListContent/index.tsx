import { useIntl } from '@umijs/max';
import { Avatar } from 'antd';
import dayjs from 'dayjs';
import React from 'react';
import useStyles from './index.style';

export type ArticleListContentProps = {
  data: {
    content?: React.ReactNode;
    updatedAt?: number;
    avatar?: string;
    owner?: string;
    href?: string;
  };
};

const ArticleListContent: React.FC<ArticleListContentProps> = ({
  data: { content, updatedAt, avatar, owner, href },
}) => {
  const { styles } = useStyles();
  const intl = useIntl();
  return (
    <div>
      <div className={styles.description}>{content}</div>
      <div className={styles.extra}>
        <Avatar src={avatar} size="small" />
        <a href={href}>{owner}</a>{' '}
        {intl.formatMessage({
          id: 'component.articleListContent.publishedAt',
          defaultMessage: 'Published at',
        })}{' '}
        <a href={href}>{href}</a>
        <em>{dayjs(updatedAt).format('L LT')}</em>
      </div>
    </div>
  );
};

export default ArticleListContent;
