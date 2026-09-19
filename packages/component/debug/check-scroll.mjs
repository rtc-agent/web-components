import {chromium} from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', msg => console.log('[BROWSER]', msg.text()));
page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

await page.goto('http://localhost:40000/debug/message-list.html');
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
    const list = document.getElementById('message-list');
    const shadow = list?.shadowRoot;
    const scrollEl = shadow?.querySelector('.message-list-scroll');
    if (!scrollEl) return {error: 'no scroll el'};
    
    const before = {
        scrollTop: scrollEl.scrollTop,
        scrollHeight: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
    };
    
    // Try to scroll down
    scrollEl.scrollTop = 200;
    
    const after = {
        scrollTop: scrollEl.scrollTop,
        scrollHeight: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
    };
    
    // Check if scroll actually moved
    return {before, after, scrolled: after.scrollTop !== before.scrollTop};
});
console.log('[RESULT]', JSON.stringify(result, null, 2));

await browser.close();
