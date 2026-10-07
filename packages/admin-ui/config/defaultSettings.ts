import type { ProLayoutProps } from '@ant-design/pro-components';

/**
 * @name
 */
const Settings: ProLayoutProps & {
  logo?: string;
} = {
  "navTheme": "realDark",
  "colorPrimary": "#1677ff",
  "layout": "mix",
  "contentWidth": "Fluid",
  "fixedHeader": true,
  "fixSiderbar": true,
  "logo": "https://rtc-agent.github.io/docs/_astro/logo.DIxztlYS.svg",
  "title": "RTC Agent Admin",
  "token": {
    // 参见ts声明，demo 见文档，通过token 修改样式
    //https://procomponents.ant.design/components/layout#%E9%80%9A%E8%BF%87-token-%E4%BF%AE%E6%94%B9%E6%A0%B7%E5%BC%8F
  },
  "splitMenus": false,
  "siderMenuType": "group"
};

export default Settings;
