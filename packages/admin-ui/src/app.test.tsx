import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all heavy dependencies before importing app
const mockReplace = vi.fn();
const mockHistory = {
  location: {
    pathname: '/welcome',
    search: '',
    hash: '',
  },
  replace: mockReplace,
};

const mockGetCurrentUser = vi.fn();
const mockIsAuthenticated = vi.fn(() => true);
const mockGetUserInfo = vi.fn(() => null);
const mockSetUserInfo = vi.fn();
const mockClearAuth = vi.fn();
const mockGetUserPermissions = vi.fn(() => []);

vi.mock('@umijs/max', () => ({
  history: mockHistory,
  Link: ({ children }: any) => children,
}));

vi.mock('@/services/admin-auth', () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock('@/utils/auth-storage', () => ({
  isAuthenticated: mockIsAuthenticated,
  getUserInfo: mockGetUserInfo,
  setUserInfo: mockSetUserInfo,
  getUserPermissions: mockGetUserPermissions,
  clearAuth: mockClearAuth,
  AUTH_STATE_CHANGED_EVENT: 'admin-auth-state-changed',
}));

vi.mock('@/components', () => ({
  AvatarDropdown: () => null,
  DocLink: () => null,
  ErrorBoundary: ({ children }: any) => children,
  Footer: () => null,
  GlobalRtcAgent: () => null,
  LangDropdown: () => null,
  OfflineBanner: () => null,
  VersionDropdown: () => null,
}));

vi.mock('@ant-design/pro-components', () => ({
  SettingDrawer: () => null,
}));

vi.mock('@ant-design/icons', () => ({
  LinkOutlined: () => null,
}));

vi.mock('./requestErrorConfig', () => ({
  errorConfig: {},
}));

vi.mock('../config/defaultSettings', () => ({
  default: { navTheme: 'light' },
}));

describe('app getInitialState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHistory.location = {
      pathname: '/welcome',
      search: '',
      hash: '',
    };
  });

  it('should fetch currentUser when not on login page', async () => {
    const { getInitialState } = await import('./app');
    mockGetCurrentUser.mockResolvedValue({
      id: '1',
      name: 'Test User',
      email: 'test@example.com',
    });

    const state = await getInitialState();

    expect(mockGetCurrentUser).toHaveBeenCalled();
    expect(state.currentUser).toMatchObject({
      userid: '1',
      name: 'Test User',
      email: 'test@example.com',
      avatar: '',
      access: 'admin', // 向后兼容：旧后端不返回 roles，默认 admin
    });
    expect(state.currentUser?.permissions).toBeInstanceOf(Set);
    expect(state.currentUser?.permissions?.size).toBe(0);
    expect(state.currentUser?.roles).toBeUndefined();
    expect(state.settingDrawerOpen).toBe(false);
    expect(state.fetchUserInfo).toBeDefined();
  });

  it('should return undefined when currentUser fetch fails (401 handled by interceptor)', async () => {
    const { getInitialState } = await import('./app');
    mockGetCurrentUser.mockRejectedValue(new Error('401 Unauthorized'));

    const state = await getInitialState();

    // 401 错误由响应拦截器处理，getInitialState 只返回 undefined
    expect(mockReplace).not.toHaveBeenCalled();
    expect(state.currentUser).toBeUndefined();
  });

  it('should not fetch currentUser on login page', async () => {
    const { getInitialState } = await import('./app');
    mockHistory.location = {
      pathname: '/user/login',
      search: '',
      hash: '',
    };

    const state = await getInitialState();

    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(state.currentUser).toBeUndefined();
    expect(state.fetchUserInfo).toBeDefined();
  });

  it('should not redirect on 401 (handled by response interceptor)', async () => {
    const { getInitialState } = await import('./app');
    mockHistory.location = {
      pathname: '/admin/users',
      search: '?page=2',
      hash: '#section',
    };
    mockGetCurrentUser.mockRejectedValue(new Error('401'));

    await getInitialState();

    // 响应拦截器负责跳转，不在这里处理
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('should include default settings in initial state', async () => {
    const { getInitialState } = await import('./app');
    mockGetCurrentUser.mockResolvedValue({
      id: '1',
      name: 'User',
      email: 'user@example.com',
    });

    const state = await getInitialState();

    expect(state.settings).toEqual({ navTheme: 'light' });
  });

  it('fetchUserInfo should return user data on success', async () => {
    const { getInitialState } = await import('./app');
    mockGetCurrentUser.mockResolvedValue({
      id: '1',
      name: 'Fetched User',
      email: 'fetched@example.com',
    });

    const state = await getInitialState();

    const user = await state.fetchUserInfo?.();
    expect(user).toMatchObject({
      userid: '1',
      name: 'Fetched User',
      email: 'fetched@example.com',
      avatar: '',
      access: 'admin',
    });
    expect(user?.permissions).toBeInstanceOf(Set);
    expect(user?.permissions?.size).toBe(0);
  });
});
