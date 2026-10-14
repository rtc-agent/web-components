import { CheckOutlined, GlobalOutlined } from '@ant-design/icons';
import { getAllLocales, getLocale, useIntl } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Button, theme } from 'antd';
import { useMemo } from 'react';
import { setLocaleWithDayjs } from '@/utils/locale-helpers';
import HeaderDropdown from '../HeaderDropdown';
import useHeaderActionStyles from './style';

const localeLabelMap: Record<string, { emoji: string; label: string }> = {
  'zh-CN': { emoji: '🇨🇳', label: '简体中文' },
  'zh-TW': { emoji: '🇭🇰', label: '繁體中文' },
  'en-US': { emoji: '🇺🇸', label: 'English' },
  'ja-JP': { emoji: '🇯🇵', label: '日本語' },
  'ko-KR': { emoji: '🇰🇷', label: '한국어' },
  'pt-BR': { emoji: '🇧🇷', label: 'Português' },
  'id-ID': { emoji: '🇮🇩', label: 'Bahasa Indonesia' },
  'fa-IR': { emoji: '🇮🇷', label: 'فارسی' },
  'bn-BD': { emoji: '🇧🇩', label: 'বাংলা' },
};

const onLangClick: MenuProps['onClick'] = ({ key }) => {
  if (key.startsWith('lang-')) {
    const newLocale = key.replace('lang-', '');
    setLocaleWithDayjs(newLocale);
  }
};

export const LangDropdown: React.FC = () => {
  const { styles } = useHeaderActionStyles();
  const intl = useIntl();
  const { token } = theme.useToken();
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
        <CheckOutlined style={{ color: token.colorSuccess }} />
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
          defaultMessage: 'Language switch',
        })}
      >
        <GlobalOutlined />
      </Button>
    </HeaderDropdown>
  );
};
