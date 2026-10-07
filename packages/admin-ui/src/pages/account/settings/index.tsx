import { GridContent } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { Menu } from 'antd';
import React, { useLayoutEffect, useRef, useState } from 'react';
import BaseView from './components/base';
import BindingView from './components/binding';
import NotificationView from './components/notification';
import SecurityView from './components/security';
import useStyles from './style.style';

type SettingsStateKeys = 'base' | 'security' | 'binding' | 'notification';
type SettingsState = {
  mode: 'inline' | 'horizontal';
  selectKey: SettingsStateKeys;
};

const getMenuMap = (intl: any): Record<string, React.ReactNode> => ({
  base: intl.formatMessage({
    id: 'pages.account.settings.base',
    defaultMessage: '基本设置',
  }),
  security: intl.formatMessage({
    id: 'pages.account.settings.security',
    defaultMessage: '安全设置',
  }),
  binding: intl.formatMessage({
    id: 'pages.account.settings.binding',
    defaultMessage: '账号绑定',
  }),
  notification: intl.formatMessage({
    id: 'pages.account.settings.notification',
    defaultMessage: '新消息通知',
  }),
});

const SettingsContent: React.FC<{ selectKey: SettingsStateKeys }> = ({
  selectKey,
}) => {
  switch (selectKey) {
    case 'base':
      return <BaseView />;
    case 'security':
      return <SecurityView />;
    case 'binding':
      return <BindingView />;
    case 'notification':
      return <NotificationView />;
    default:
      return null;
  }
};

const Settings: React.FC = () => {
  const { styles } = useStyles();
  const intl = useIntl();
  const menuMap = getMenuMap(intl);
  const menuItems = Object.keys(menuMap).map((item) => ({
    key: item,
    label: menuMap[item],
  }));
  const [initConfig, setInitConfig] = useState<SettingsState>({
    mode: 'inline',
    selectKey: 'base',
  });
  const dom = useRef<HTMLDivElement>(null);

  const resize = () => {
    requestAnimationFrame(() => {
      if (!dom.current) {
        return;
      }
      const { offsetWidth } = dom.current;
      // 容器宽度 > 400 且（容器 < 641 或视口 < 768）时切换为水平菜单
      const isHorizontal =
        offsetWidth > 400 && (offsetWidth < 641 || window.innerWidth < 768);
      setInitConfig((prev) => ({
        ...prev,
        mode: isHorizontal ? 'horizontal' : 'inline',
      }));
    });
  };

  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  useLayoutEffect(() => {
    const handler = () => resizeRef.current();
    window.addEventListener('resize', handler);
    handler();
    return () => {
      window.removeEventListener('resize', handler);
    };
  }, []);
  return (
    <GridContent>
      <div
        className={styles.main}
        ref={(ref) => {
          if (ref) {
            dom.current = ref;
          }
        }}
      >
        <div className={styles.leftMenu}>
          <Menu
            mode={initConfig.mode}
            selectedKeys={[initConfig.selectKey]}
            onClick={({ key }) => {
              setInitConfig((prev) => ({
                ...prev,
                selectKey: key as SettingsStateKeys,
              }));
            }}
            items={menuItems}
          />
        </div>
        <div className={styles.right}>
          <div className={styles.title}>{menuMap[initConfig.selectKey]}</div>
          <SettingsContent selectKey={initConfig.selectKey} />
        </div>
      </div>
    </GridContent>
  );
};
export default Settings;
