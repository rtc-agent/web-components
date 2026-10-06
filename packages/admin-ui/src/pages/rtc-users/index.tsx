import { history } from '@umijs/max';
import React, { useEffect } from 'react';

/**
 * RTC 用户管理首页
 * 根据权限智能重定向到第一个有权限的页面
 */
const RtcUsersIndexPage: React.FC = () => {
  useEffect(() => {
    // 重定向到用户管理页面
    history.replace('/rtc-users/management');
  }, []);

  return null;
};

export default RtcUsersIndexPage;
