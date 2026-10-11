/**
 * Permission Management Shared Constants
 *
 * Resource and action type definitions shared between role and permission management pages.
 */
import type { useIntl } from '@umijs/max';

type IntlType = ReturnType<typeof useIntl>;

/** Resource types (i18n) */
export const getResourceTypes = (intl: IntlType) => [
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.adminUser',
      defaultMessage: 'Admin User Management',
    }),
    value: 'admin_user',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.role',
      defaultMessage: 'Role Management',
    }),
    value: 'role',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.permission',
      defaultMessage: 'Permission Management',
    }),
    value: 'permission',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.adminUserRole',
      defaultMessage: 'Admin User Role Assignment',
    }),
    value: 'admin_user_role',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.auditLog',
      defaultMessage: 'Audit Log',
    }),
    value: 'audit_log',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.rtcUser',
      defaultMessage: 'RTC User Management',
    }),
    value: 'rtc_user',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.rtcSession',
      defaultMessage: 'RTC Session Management',
    }),
    value: 'rtc_session',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.rtcMessage',
      defaultMessage: 'RTC Message Management',
    }),
    value: 'rtc_message',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.serverConfig',
      defaultMessage: 'System Configuration',
    }),
    value: 'server_config',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.resource.dashboard',
      defaultMessage: 'Dashboard',
    }),
    value: 'dashboard',
  },
];

/** Action types (i18n) */
export const getActionTypes = (intl: IntlType) => [
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.read',
      defaultMessage: 'Read',
    }),
    value: 'read',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.write',
      defaultMessage: 'Write',
    }),
    value: 'write',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.delete',
      defaultMessage: 'Delete',
    }),
    value: 'delete',
  },
  {
    label: intl.formatMessage({
      id: 'pages.permissions.action.ban',
      defaultMessage: 'Ban',
    }),
    value: 'ban',
  },
];
