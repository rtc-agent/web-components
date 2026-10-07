/**
 * 权限管理共享常量
 *
 * 角色管理和权限管理页面共用的资源类型与操作类型定义。
 */
import type { useIntl } from '@umijs/max';

type IntlType = ReturnType<typeof useIntl>;

/** 资源类型（国际化） */
export const getResourceTypes = (intl: IntlType) => [
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.adminUser',
      defaultMessage: '管理员管理',
    }),
    value: 'admin_user',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.role',
      defaultMessage: '管理员角色管理',
    }),
    value: 'role',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.permission',
      defaultMessage: '权限管理',
    }),
    value: 'permission',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.adminUserRole',
      defaultMessage: '管理员角色关联',
    }),
    value: 'admin_user_role',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.auditLog',
      defaultMessage: '审计日志',
    }),
    value: 'audit_log',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.rtcUser',
      defaultMessage: 'RTC 用户管理',
    }),
    value: 'rtc_user',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.rtcSession',
      defaultMessage: 'RTC 会话管理',
    }),
    value: 'rtc_session',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.rtcMessage',
      defaultMessage: 'RTC 消息管理',
    }),
    value: 'rtc_message',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.serverConfig',
      defaultMessage: '系统配置',
    }),
    value: 'server_config',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.dashboard',
      defaultMessage: '数据看板',
    }),
    value: 'dashboard',
  },
];

/** 操作类型（国际化） */
export const getActionTypes = (intl: IntlType) => [
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.read',
      defaultMessage: '读取',
    }),
    value: 'read',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.write',
      defaultMessage: '写入',
    }),
    value: 'write',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.delete',
      defaultMessage: '删除',
    }),
    value: 'delete',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.ban',
      defaultMessage: '封禁',
    }),
    value: 'ban',
  },
];
