import { expect, test } from '../fixtures/rtc-functions';

test.describe('role Group - 管理员角色管理', () => {
  test.beforeEach(async ({ page, login }) => {
    // 登录并导航到管理员角色列表页
    await login();
    await page.goto('/system/roles');
    await page.waitForLoadState('networkidle');
  });

  test('role.list - 读取表格数据（与 UI 一致）', async ({
    page,
    callFunction,
  }) => {
    // 调用 function
    const result = await callFunction('role.list', {
      current: 1,
      pageSize: 10,
    });

    // 验证返回值结构
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');

    // 验证数据与 UI 表格一致
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    const resultData = (result as any).data;
    expect(resultData.length).toBe(tableRows);

    // 验证第一行数据
    if (resultData.length > 0) {
      const firstRowName = await page
        .locator('.ant-table-tbody tr:first-child td:nth-child(2)')
        .textContent();
      expect(resultData[0].name).toBe(firstRowName?.trim());
    }
  });

  test('role.create - 创建管理员角色并刷新表格', async ({
    page,
    callFunction,
  }) => {
    // 记录创建前的行数
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // 调用 function
    const result = await callFunction('role.create', {
      name: 'test_role',
      display_name: '测试管理员角色',
      description: 'E2E 测试创建的管理员角色',
    });

    expect(result).toHaveProperty('success', true);

    // 验证表格已刷新（行数增加）
    await page.waitForTimeout(500); // 等待刷新完成
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore + 1);

    // 验证新管理员角色出现在表格中
    const newRoleVisible = await page
      .locator('text=测试管理员角色')
      .isVisible();
    expect(newRoleVisible).toBe(true);
  });

  test('role.remove - 删除管理员角色并刷新表格', async ({
    page,
    callFunction,
  }) => {
    // 先创建一条管理员角色
    await callFunction('role.create', {
      name: 'test_delete_role',
      display_name: '待删除管理员角色',
      description: '即将被删除',
    });

    // 记录当前行数
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // 找到刚创建的管理员角色
    const targetRow = await page.locator('tr', { hasText: '待删除管理员角色' });
    const idCell = await targetRow.locator('td:first-child').textContent();
    const roleId = idCell?.trim() || '';

    // 调用 function 删除
    const result = await callFunction('role.remove', {
      ids: [roleId],
    });

    expect(result).toHaveProperty('success', true);

    // 验证表格已刷新（行数减少）
    await page.waitForTimeout(500);
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore - 1);

    // 验证管理员角色已从表格消失
    const roleStillVisible = await page
      .locator('text=待删除管理员角色')
      .isVisible();
    expect(roleStillVisible).toBe(false);
  });
});
