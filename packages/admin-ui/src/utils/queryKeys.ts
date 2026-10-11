/**
 * Centralized query keys for react-query
 * Provides consistent, type-safe query key management across the application
 */

export const queryKeys = {
  // Rules/Table list
  rules: {
    all: ['rules'] as const,
    list: () => [...queryKeys.rules.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.rules.all, id] as const,
  },
  // Basic form
  basicForm: {
    all: ['basic-form'] as const,
    detail: () => [...queryKeys.basicForm.all, 'detail'] as const,
  },
  // Current user
  currentUser: {
    all: ['current-user'] as const,
    detail: () => [...queryKeys.currentUser.all, 'detail'] as const,
  },
  // Profile pages
  profile: {
    basic: () => ['profile-basic'] as const,
    advanced: () => ['profile-advanced'] as const,
  },
  // Search pages
  search: {
    articles: (filters?: Record<string, unknown>) =>
      ['search-articles', filters] as const,
    projects: (filters?: Record<string, unknown>) =>
      ['search-projects', filters] as const,
    applications: () => ['search-applications'] as const,
  },
} as const;
