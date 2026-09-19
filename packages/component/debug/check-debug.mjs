import {chromium} from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', msg => console.log('[BROWSER]', msg.text()));
page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

await page.goto('http://localhost:40000/debug/message-list.html');
await page.waitForTimeout(3000);

const result = await page.evaluate(() => {
    const list = document.getElementById('message-list');
    if (!list) return {error: 'message-list not found'};
    const shadow = list.shadowRoot;
    if (!shadow) return {error: 'no shadow root'};
    const msgs = shadow.querySelectorAll('[data-client-id]');
    const scroll = shadow.querySelector('.message-list-scroll');
    const statRepo = document.getElementById('stat-repo')?.textContent;
    const statDom = document.getElementById('stat-dom')?.textContent;
    return {
        messageCount: msgs.length,
        scrollExists: !!scroll,
        statRepo,
        statDom,
        firstMessageText: msgs[0]?.textContent?.substring(0, 100),
    };
});
console.log('[RESULT]', JSON.stringify(result, null, 2));

await browser.close();
