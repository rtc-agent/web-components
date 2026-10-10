import { CheckOutlined, GlobalOutlined } from '@ant-design/icons';
import { getAllLocales, getLocale, setLocale, useIntl } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Button } from 'antd';
import { useMemo } from 'react';
import HeaderDropdown from '../HeaderDropdown';
import useHeaderActionStyles from './style';

const localeLabelMap: Record<string, { emoji: string; label: string }> = {
  'zh-CN': { emoji: '🇨🇳', label: '简体中文' },
  'zh-TW': { emoji: '🇭🇰', label: '繁體中文' },
  'en-US': { emoji: '🇺🇸', label: 'English' },
  'ja-JP': { emoji: '🇯🇵', label: '日本語' },
  'pt-BR': { emoji: '🇧🇷', label: 'Português' },
  'id-ID': { emoji: '🇮🇩', label: 'Bahasa Indonesia' },
  'fa-IR': { emoji: '🇮🇷', label: 'فارسی' },
  'bn-BD': { emoji: '🇧🇩', label: 'বাংলা' },
};

const onLangClick: MenuProps['onClick'] = ({ key }) => {
  if (key.startsWith('lang-')) {
    const newLocale = key.replace('lang-', '');
    setLocale(newLocale, false);

    // Update document direction for RTL/LTR languages
    const RTL_LOCALES = ['fa-IR', 'ar-EG', 'he-IL'];
    const isRTL = RTL_LOCALES.some((rtl) =>
      newLocale.startsWith(rtl.split('-')[0]),
    );
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = newLocale;
  }
};

export const LangDropdown: React.FC = () => {
  const { styles } = useHeaderActionStyles();
  const intl = useIntl();
  const allLocales = useMemo(() => getAllLocales(), []);
  const currentLocale = getLocale();
  const supportLocales = allLocales.filter((l) => l in localeLabelMap);

  if (supportLocales.length <= 1) {
    return null;
  }

  const langItems: MenuProps['items'] = supportLocales.map((locale) => ({
    key: `lang-${locale}`,
    icon:
      locale === currentLocale ? (
        <CheckOutlined style={{ color: '#52c41a' }} />
      ) : (
        <span style={{ display: 'inline-block', width: 14 }} />
      ),
    label: `${localeLabelMap[locale]?.emoji ?? ''} ${localeLabelMap[locale]?.label ?? locale}`,
  }));

  return (
    <HeaderDropdown
      placement="bottomRight"
      arrow
      menu={{
        selectedKeys: [`lang-${currentLocale}`],
        onClick: onLangClick,
        items: langItems,
        style: { minWidth: 180 },
      }}
    >
      <Button
        type="text"
        className={styles.action}
        aria-label={intl.formatMessage({
          id: 'component.globalHeader.langSwitch',
          defaultMessage: '语言切换',
        })}
      >
        <GlobalOutlined />
      </Button>
    </HeaderDropdown>
  );
};
