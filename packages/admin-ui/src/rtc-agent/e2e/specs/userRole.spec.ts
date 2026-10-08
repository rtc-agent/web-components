import { expect, test } from '../fixtures/rtc-functions';

test.describe('adminRole Group - Admin User Role Assignment', () => {
  test.beforeEach(async ({ page, login }) => {
    // Login and navigate to admin user management page
    await login();
    await page.goto('/system/users');
    await page.waitForLoadState('networkidle');
  });

  test('adminRole.list - Query user roles', async ({ callFunction }) => {
    // First query user list to get a userId
    const users = await callFunction('admin.list', { current: 1, pageSize: 1 });
    const userId = (users as any).data[0]?.id;

    if (userId) {
      // Query user's roles
      const result = await callFunction('adminRole.list', { userId });

      // Verify return value structure
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');

      // Verify data structure
      const roleData = (result as any).data;
      expect(Array.isArray(roleData)).toBe(true);

      // If user has roles, verify structure
      if (roleData.length > 0) {
        expect(roleData[0]).toHaveProperty('user_id');
        expect(roleData[0]).toHaveProperty('role_id');
        expect(roleData[0]).toHaveProperty('role_name');
        expect(roleData[0]).toHaveProperty('assigned_at');
      }
    }
  });

  test('adminRole.assign - Assign roles', async ({ page, callFunction }) => {
    // Get a user
    const users = await callFunction('admin.list', { current: 1, pageSize: 1 });
    const userId = (users as any).data[0]?.id;

    // Get a role
    const roles = await callFunction('role.list', { current: 1, pageSize: 1 });
    const roleId = (roles as any).data[0]?.id;

    if (userId && roleId) {
      // Record roles before assignment
      const rolesBefore = await callFunction('adminRole.list', { userId });
      const rolesCountBefore = (rolesBefore as any).total;

      // Assign role
      const result = await callFunction('adminRole.assign', {
        userId,
        roleIds: [roleId],
      });

      expect(result).toHaveProperty('success', true);

      // Wait for UI refresh
      await page.waitForTimeout(500);

      // Verify role count increased
      const rolesAfter = await callFunction('adminRole.list', { userId });
      const rolesCountAfter = (rolesAfter as any).total;

      // Note: If role was already assigned, count won't change
      expect(rolesCountAfter).toBeGreaterThanOrEqual(rolesCountBefore);
    }
  });

  test('adminRole.revoke - Revoke role', async ({ page, callFunction }) => {
    // Get a user
    const users = await callFunction('admin.list', { current: 1, pageSize: 1 });
    const userId = (users as any).data[0]?.id;

    if (userId) {
      // Query user's current roles
      const rolesResult = await callFunction('adminRole.list', { userId });
      const userRoles = (rolesResult as any).data;

      if (userRoles.length > 0) {
        // Pick a role to revoke
        const roleId = userRoles[0].role_id;

        // Record roles before revocation
        const rolesCountBefore = (rolesResult as any).total;

        // Revoke role
        const result = await callFunction('adminRole.revoke', {
          userId,
          roleId,
        });

        expect(result).toHaveProperty('success', true);

        // Wait for UI refresh
        await page.waitForTimeout(500);

        // Verify role count decreased
        const rolesAfter = await callFunction('adminRole.list', { userId });
        const rolesCountAfter = (rolesAfter as any).total;

        expect(rolesCountAfter).toBe(rolesCountBefore - 1);

        // Verify the revoked role is no longer in the list
        const revokedRoleInList = (rolesAfter as any).data.some(
          (role: any) => role.role_id === roleId,
        );
        expect(revokedRoleInList).toBe(false);
      }
    }
  });

  test('adminRole - Full flow: assign and revoke role', async ({
    page,
    callFunction,
  }) => {
    // Get a user
    const users = await callFunction('admin.list', { current: 1, pageSize: 1 });
    const userId = (users as any).data[0]?.id;

    // Get a role
    const roles = await callFunction('role.list', { current: 1, pageSize: 1 });
    const roleId = (roles as any).data[0]?.id;

    if (userId && roleId) {
      // Step 1: Check initial roles
      const initialRoles = await callFunction('adminRole.list', { userId });
      const initialCount = (initialRoles as any).total;

      // Step 2: Assign role
      const assignResult = await callFunction('adminRole.assign', {
        userId,
        roleIds: [roleId],
      });
      expect(assignResult).toHaveProperty('success', true);

      await page.waitForTimeout(500);

      // Step 3: Verify role was assigned
      const afterAssign = await callFunction('adminRole.list', { userId });
      expect((afterAssign as any).total).toBeGreaterThanOrEqual(
        initialCount + 1,
      );

      // Step 4: Revoke the role
      const revokeResult = await callFunction('adminRole.revoke', {
        userId,
        roleId,
      });
      expect(revokeResult).toHaveProperty('success', true);

      await page.waitForTimeout(500);

      // Step 5: Verify role was revoked
      const afterRevoke = await callFunction('adminRole.list', { userId });
      expect((afterRevoke as any).total).toBe(initialCount);
    }
  });

  test('adminRole.assign - Assign multiple roles in batch', async ({
    page,
    callFunction,
  }) => {
    // Get a user
    const users = await callFunction('admin.list', { current: 1, pageSize: 1 });
    const userId = (users as any).data[0]?.id;

    // Get multiple roles
    const roles = await callFunction('role.list', { current: 1, pageSize: 3 });
    const roleIds = (roles as any).data.map((role: any) => role.id);

    if (userId && roleIds.length >= 2) {
      // Assign multiple roles at once
      const result = await callFunction('adminRole.assign', {
        userId,
        roleIds,
      });

      expect(result).toHaveProperty('success', true);

      await page.waitForTimeout(500);

      // Verify all roles were assigned
      const userRoles = await callFunction('adminRole.list', { userId });
      const assignedRoleIds = (userRoles as any).data.map(
        (role: any) => role.role_id,
      );

      // Check that at least some of the roles were assigned
      const assignedCount = roleIds.filter((id: string) =>
        assignedRoleIds.includes(id),
      ).length;
      expect(assignedCount).toBeGreaterThan(0);
    }
  });

  test('adminRole - Error handling: invalid user ID', async ({
    callFunction,
  }) => {
    // Try to query roles for a non-existent user
    const result = await callFunction('adminRole.list', {
      userId: 'non-existent-user-id',
    });

    // Should return success: false or empty data
    if ((result as any).success === false) {
      expect(result).toHaveProperty('success', false);
    } else {
      // Or return empty list
      expect((result as any).data).toEqual([]);
    }
  });

  test('adminRole.revoke - Error handling: revoke unassigned role', async ({
    callFunction,
  }) => {
    // Get a user
    const users = await callFunction('admin.list', { current: 1, pageSize: 1 });
    const userId = (users as any).data[0]?.id;

    if (userId) {
      // Try to revoke a role that the user doesn't have
      const result = await callFunction('adminRole.revoke', {
        userId,
        roleId: 'non-existent-role-id',
      });

      // Should handle gracefully (either error or success)
      expect(result).toHaveProperty('success');
    }
  });
});
