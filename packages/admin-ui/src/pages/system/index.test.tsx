import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

vi.mock('@umijs/max', () => ({
  history: {
    replace: mockReplace,
  },
  useAccess: vi.fn(),
}));

vi.mock('antd', () => ({
  Skeleton: () => <div data-testid="skeleton">skeleton</div>,
}));

import { useAccess } from '@umijs/max';
import SystemIndexPage from './index';

const mockedUseAccess = vi.mocked(useAccess);

describe('SystemIndexPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should redirect to first accessible sub-page based on priority', () => {
    mockedUseAccess.mockReturnValue({
      canSystemView: true,
      canAdminUserView: true,
      canAdminRoleView: false,
      canPermissionView: false,
      canAuditLogView: false,
      canServerConfigView: false,
    } as any);

    render(<SystemIndexPage />);

    // Highest priority: admin users
    expect(mockReplace).toHaveBeenCalledWith('/system/users');
  });

  it('should redirect to second priority if first is not accessible', () => {
    mockedUseAccess.mockReturnValue({
      canSystemView: true,
      canAdminUserView: false,
      canAdminRoleView: true,
      canPermissionView: false,
      canAuditLogView: false,
      canServerConfigView: false,
    } as any);

    render(<SystemIndexPage />);

    expect(mockReplace).toHaveBeenCalledWith('/system/roles');
  });

  it('should redirect to /exception/403 when no system permissions', () => {
    mockedUseAccess.mockReturnValue({
      canSystemView: false,
      canAdminUserView: false,
      canAdminRoleView: false,
      canPermissionView: false,
      canAuditLogView: false,
      canServerConfigView: false,
    } as any);

    render(<SystemIndexPage />);

    // Consistent with app.tsx: redirect to /exception/403
    expect(mockReplace).toHaveBeenCalledWith('/exception/403');
  });

  it('should not redirect while access is still loading (undefined)', () => {
    mockedUseAccess.mockReturnValue({
      canSystemView: undefined,
      canAdminUserView: undefined,
    } as any);

    render(<SystemIndexPage />);

    // Should not redirect until access is resolved
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('should not redirect multiple times when access changes', () => {
    mockedUseAccess.mockReturnValue({
      canSystemView: true,
      canAdminUserView: true,
    } as any);

    const { rerender } = render(<SystemIndexPage />);
    expect(mockReplace).toHaveBeenCalledTimes(1);

    // Simulate access object changing (re-render)
    mockedUseAccess.mockReturnValue({
      canSystemView: true,
      canAdminUserView: false,
      canAdminRoleView: true,
    } as any);

    rerender(<SystemIndexPage />);

    // Should not redirect again (hasRedirected ref prevents it)
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});
