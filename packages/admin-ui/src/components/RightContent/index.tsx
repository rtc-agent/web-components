import { BookOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, Tooltip } from 'antd';
import React from 'react';
import { LangDropdown } from './LangDropdown';
import useHeaderActionStyles from './style';
import { VersionDropdown } from './VersionDropdown';

export const DocLink: React.FC = () => {
  const { styles } = useHeaderActionStyles();
  const intl = useIntl();
  return (
    <Tooltip
      title={intl.formatMessage({
        id: 'component.globalHeader.help',
        defaultMessage: 'Documentation',
      })}
    >
      <Button
        type="text"
        className={styles.action}
        icon={<BookOutlined />}
        aria-label={intl.formatMessage({
          id: 'component.globalHeader.help',
          defaultMessage: 'Documentation',
        })}
        onClick={() => {
          window.open('https://rtc-agent.github.io/docs', '_blank');
        }}
      />
    </Tooltip>
  );
};

export { LangDropdown, VersionDropdown };
