import { GridContent } from '@ant-design/pro-components';
import { useIntl } from '@umijs/max';
import { App, Menu } from 'antd';
import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePageAPIRegistration } from '@/hooks/usePageAPIRegistration';
import BaseView from './components/base';
import BindingView from './components/binding';
import NotificationView from './components/notification';
import SecurityView from './components/security';
import type { SelfAccountSettingsPageAPI } from './page-api';
import { updateCurrentUser } from './service';
import useStyles from './style';

type SettingsStateKeys = 'base' | 'security' | 'binding' | 'notification';

const getMenuMap = (intl: any): Record<string, React.ReactNode> => ({
  base: intl.formatMessage({
    id: 'pages.account.settings.base',
    defaultMessage: 'Basic settings',
  }),
  security: intl.formatMessage({
    id: 'pages.account.settings.security',
    defaultMessage: 'Security settings',
  }),
  binding: intl.formatMessage({
    id: 'pages.account.settings.binding',
    defaultMessage: 'Account binding',
  }),
  notification: intl.formatMessage({
    id: 'pages.account.settings.notification',
    defaultMessage: 'New message notification',
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
  const { message } = App.useApp();
  const menuMap = getMenuMap(intl);
  const menuItems = Object.keys(menuMap).map((item) => ({
    key: item,
    label: menuMap[item],
  }));
  const isMobile = useIsMobile();
  const [selectKey, setSelectKey] = useState<SettingsStateKeys>('base');
  const dom = useRef<HTMLDivElement>(null);

  // Derive menu mode from container width using useMemo
  const mode = useMemo<'inline' | 'horizontal'>(() => {
    if (!dom.current) return 'inline';
    const { offsetWidth } = dom.current;
    // Switch to horizontal menu when container width > 400 and (container < 641 or viewport is mobile < 768)
    return offsetWidth > 400 && (offsetWidth < 641 || isMobile)
      ? 'horizontal'
      : 'inline';
  }, [isMobile]);

  const resize = () => {
    requestAnimationFrame(() => {
      if (!dom.current) {
        return;
      }
      // Trigger re-render by updating isMobile-dependent mode
      // The actual mode calculation happens in useMemo
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
  }, [isMobile]);

  // Register Page API for selfAccount function group
  usePageAPIRegistration(
    'selfAccountSettings',
    useCallback(
      (): SelfAccountSettingsPageAPI => ({
        updateProfile: async (data) => {
          try {
            // Validate required fields
            if (!data.name) {
              return { success: false, error: 'Name is required' };
            }
            if (!data.email) {
              return { success: false, error: 'Email is required' };
            }

            // Call the real update API
            await updateCurrentUser(data);
            message.success(
              intl.formatMessage({
                id: 'pages.account.settings.updateSuccess',
                defaultMessage: 'Profile updated successfully',
              }),
            );
            return { success: true };
          } catch (err) {
            console.error(
              '[SelfAccountSettings Page API] updateProfile failed:',
              err,
            );
            return {
              success: false,
              error: 'Failed to update profile',
            };
          }
        },
      }),
      [],
    ),
  );
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
            mode={mode}
            selectedKeys={[selectKey]}
            onClick={({ key }) => {
              setSelectKey(key as SettingsStateKeys);
            }}
            items={menuItems}
          />
        </div>
        <div className={styles.right}>
          <div className={styles.title}>{menuMap[selectKey]}</div>
          <SettingsContent selectKey={selectKey} />
        </div>
      </div>
    </GridContent>
  );
};
export default Settings;
