/**
 * Centralized query keys for react-query
 * Provides consistent, type-safe query key management across the application
 *
 * Only actively used query keys are defined here.
 * If you need a new query key, add it with a clear comment about its purpose.
 */

export const queryKeys = {
  // Current user data (profile, settings, center)
  currentUser: {
    all: ['current-user'] as const,
    detail: () => [...queryKeys.currentUser.all, 'detail'] as const,
    center: () => [...queryKeys.currentUser.all, 'center'] as const,
    settings: () => [...queryKeys.currentUser.all, 'settings'] as const,
  },
  // Role list (used by useRoleOptions hook for role dropdowns)
  roleList: {
    all: ['roleList'] as const,
  },
  // Account center sub-lists (projects, articles, applications)
  accountCenter: {
    all: ['account-center'] as const,
    projects: (count?: number) =>
      [...queryKeys.accountCenter.all, 'projects', count] as const,
    articles: (count?: number) =>
      [...queryKeys.accountCenter.all, 'articles', count] as const,
    applications: (count?: number) =>
      [...queryKeys.accountCenter.all, 'applications', count] as const,
  },
  // System configuration list (server-config.ts)
  configs: {
    all: ['configs'] as const,
    list: <T extends Record<string, unknown>>(params?: T) =>
      [...queryKeys.configs.all, 'list', params] as const,
    detail: (key: string) => [...queryKeys.configs.all, 'detail', key] as const,
    history: (key: string) =>
      [...queryKeys.configs.all, 'history', key] as const,
  },
  // RTC Agent management (rtc-users pages)
  rtcAgent: {
    all: ['rtc-agent'] as const,
    // User management list
    users: <T extends Record<string, unknown>>(params?: T) =>
      [...queryKeys.rtcAgent.all, 'users', params] as const,
    // User detail/info
    userDetail: (userId: string) =>
      [...queryKeys.rtcAgent.all, 'user-detail', userId] as const,
    // User sessions list
    userSessions: <T extends Record<string, unknown>>(
      userId: string,
      params?: T,
    ) => [...queryKeys.rtcAgent.all, 'user-sessions', userId, params] as const,
    // User messages list
    userMessages: <T extends Record<string, unknown>>(
      userId: string,
      params?: T,
    ) => [...queryKeys.rtcAgent.all, 'user-messages', userId, params] as const,
    // User configs
    userConfigs: (userId: string, category?: string) =>
      [...queryKeys.rtcAgent.all, 'user-configs', userId, category] as const,
  },
  // Audit logs (audit-logs page)
  auditLogs: {
    all: ['audit-logs'] as const,
    list: <T extends Record<string, unknown>>(params?: T) =>
      [...queryKeys.auditLogs.all, 'list', params] as const,
    detail: (id: string) => [...queryKeys.auditLogs.all, 'detail', id] as const,
  },
  // Diagnostics (RTC Agent integration diagnosis page)
  diagnostics: {
    all: ['diagnostics'] as const,
    agentStatus: () => [...queryKeys.diagnostics.all, 'agent-status'] as const,
  },
  // Login configuration (login page)
  loginConfig: () => ['login-config'] as const,
} as const;
