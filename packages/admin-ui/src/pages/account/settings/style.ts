import { createStyles } from 'antd-style';

const useStyles = createStyles(({ token }) => {
  return {
    main: {
      display: 'flex',
      width: '100%',
      height: '100%',
      paddingTop: '16px',
      paddingBottom: '16px',
      backgroundColor: token.colorBgContainer,
      '.ant-list-split .ant-list-item:last-child': {
        borderBottom: `1px solid ${token.colorSplit}`,
      },
      '.ant-list-item': { paddingTop: '14px', paddingBottom: '14px' },
      [`@media screen and (max-width: ${token.screenMD}px)`]: {
        flexDirection: 'column',
      },
    },
    leftMenu: {
      width: '224px',
      borderRight: `${token.lineWidth}px solid ${token.colorSplit}`,
      '.ant-menu-inline': { border: 'none !important' },
      '.ant-menu-horizontal': { fontWeight: 'bold' },
      [`@media screen and (max-width: ${token.screenMD}px)`]: {
        width: '100%',
        border: 'none',
      },
    },
    right: {
      flex: '1',
      padding: '8px 40px',
      [`@media screen and (max-width: ${token.screenMD}px)`]: {
        padding: '40px',
      },
    },
    title: {
      marginBottom: '12px',
      color: token.colorTextHeading,
      fontWeight: '500',
      fontSize: '20px',
      lineHeight: '28px',
    },
    taobao: {
      display: 'block',
      color: token.colorError,
      fontSize: '48px',
      lineHeight: '48px',
      borderRadius: token.borderRadius,
    },
    dingding: {
      margin: '2px',
      padding: '6px',
      color: token.colorBgContainer,
      fontSize: '32px',
      lineHeight: '32px',
      backgroundColor: token.colorInfo,
      borderRadius: token.borderRadius,
    },
    alipay: {
      color: token.colorInfo,
      fontSize: '48px',
      lineHeight: '48px',
      borderRadius: token.borderRadius,
    },
    ':global': {
      'font.strong': { color: token.colorSuccess },
      'font.medium': { color: token.colorWarning },
      'font.weak': { color: token.colorError },
    },
  };
});

export default useStyles;
