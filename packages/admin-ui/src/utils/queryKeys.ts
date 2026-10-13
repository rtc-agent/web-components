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
} as const;
