import { expect, test } from '@playwright/test';

test.describe('RTC Agent Integration', () => {
  test('should not throw TypeError on page load', async ({ page }) => {
    const errors: string[] = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Capture page errors (uncaught exceptions)
    page.on('pageerror', (error) => {
      errors.push(`PageError: ${error.message}`);
    });

    // Navigate to the test page
    await page.goto('/rtc-agent-test');

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Check for the specific TypeError we're trying to fix
    const typeError = errors.find(
      (err) =>
        err.includes("Cannot destructure property 'dispatcher'") ||
        err.includes('useContext'),
    );

    if (typeError) {
      console.error('Found TypeError:', typeError);
      console.error('All errors:', errors);
    }

    expect(typeError).toBeUndefined();
  });

  test('should mount GlobalRtcAgent when logged in', async ({ page }) => {
    // First, login
    await page.goto('/user/login');
    await page.fill('input[name="email"]', 'admin');
    await page.fill('input[name="password"]', 'ant.design');
    await page.click('button[type="submit"]');

    // Wait for navigation after login
    await page.waitForURL('**/welcome', { timeout: 10000 });

    // Check if rtc-agent element exists
    const agent = await page.locator('rtc-agent').first();
    await expect(agent).toBeVisible({ timeout: 5000 });
  });

  test('should not mount GlobalRtcAgent when not logged in', async ({
    page,
  }) => {
    // Navigate to a page without logging in
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    // Check that rtc-agent element does NOT exist
    const agent = await page.locator('rtc-agent').count();
    expect(agent).toBe(0);
  });

  test('diagnose page should detect RTC Agent', async ({ page }) => {
    // Login first
    await page.goto('/user/login');
    await page.fill('input[name="email"]', 'admin');
    await page.fill('input[name="password"]', 'ant.design');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/welcome', { timeout: 10000 });

    // Navigate to diagnose page
    await page.goto('/rtc-agent-diagnose');
    await page.waitForLoadState('networkidle');

    // Wait for status to become success
    await page.waitForSelector('text=集成正常', { timeout: 10000 });

    // Check that RTC Agent is found
    const agentFound = await page.locator('text=已找到').count();
    expect(agentFound).toBeGreaterThan(0);
  });
});
