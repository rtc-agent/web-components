/**
 * Playwright test for rtc-message-list debug page.
 *
 * Run: npx playwright test packages/component/debug/message-list.spec.ts --headed
 * Prerequisite: dev server running at http://localhost:40000
 */
import {test, expect} from '@playwright/test';

const BASE_URL = 'http://localhost:40000/debug/message-list.html';

test.describe('rtc-message-list debug', () => {
    test.beforeEach(async ({page}) => {
        await page.goto(BASE_URL);
        // Wait for initial messages to load
        await page.waitForFunction(() => {
            const list = document.getElementById('message-list') as any;
            return list?.shadowRoot?.querySelectorAll('[data-client-id]')?.length > 0;
        }, {timeout: 10000});
    });

    test('initial load renders messages', async ({page}) => {
        const count = await page.evaluate(() => {
            const list = document.getElementById('message-list') as any;
            return list?.shadowRoot?.querySelectorAll('[data-client-id]')?.length ?? 0;
        });
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(50);
    });

    test('repo state is populated after initial load', async ({page}) => {
        const repoCount = await page.locator('#stat-repo').textContent();
        expect(Number(repoCount)).toBeGreaterThan(0);
    });

    test('append message increases DOM count', async ({page}) => {
        const beforeCount = await page.evaluate(() => {
            const list = document.getElementById('message-list') as any;
            return list?.shadowRoot?.querySelectorAll('[data-client-id]')?.length ?? 0;
        });

        await page.click('#btn-append');
        await page.waitForTimeout(200);

        const afterCount = await page.evaluate(() => {
            const list = document.getElementById('message-list') as any;
            return list?.shadowRoot?.querySelectorAll('[data-client-id]')?.length ?? 0;
        });

        expect(afterCount).toBe(beforeCount + 1);
    });

    test('load more prepends messages', async ({page}) => {
        const beforeRepoCount = await page.locator('#stat-repo').textContent();

        await page.click('#btn-load-more');
        await page.waitForTimeout(1000);

        const afterRepoCount = await page.locator('#stat-repo').textContent();
        expect(Number(afterRepoCount)).toBeGreaterThan(Number(beforeRepoCount));
    });

    test('scroll to bottom works', async ({page}) => {
        await page.click('#btn-scroll-bottom');
        await page.waitForTimeout(200);

        const isAtBottom = await page.evaluate(() => {
            const list = document.getElementById('message-list') as any;
            const scrollEl = list?.shadowRoot?.querySelector('.message-list-scroll') as HTMLElement;
            if (!scrollEl) return false;
            return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 60;
        });
        expect(isAtBottom).toBe(true);
    });

    test('session switch changes session info', async ({page}) => {
        const infoBefore = await page.locator('#session-info').textContent();

        await page.click('#btn-switch-session');
        await page.waitForTimeout(500);

        const infoAfter = await page.locator('#session-info').textContent();
        expect(infoAfter).not.toBe(infoBefore);
    });

    test('clear empties the message list', async ({page}) => {
        await page.click('#btn-clear');
        await page.waitForTimeout(500);

        const repoCount = await page.locator('#stat-repo').textContent();
        expect(Number(repoCount)).toBe(0);
    });
});
