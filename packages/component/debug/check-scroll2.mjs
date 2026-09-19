import {chromium} from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

await page.goto('http://localhost:40000/debug/message-list.html');
await page.waitForTimeout(2000);

// Add 100 more messages to make scrolling possible
await page.click('#btn-add-100');
await page.waitForTimeout(1000);

const result = await page.evaluate(() => {
    const list = document.getElementById('message-list');
    const shadow = list?.shadowRoot;
    const scrollEl = shadow?.querySelector('.message-list-scroll');
    if (!scrollEl) return {error: 'no scroll el'};
    
    const before = {
        scrollTop: scrollEl.scrollTop,
        scrollHeight: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
        msgCount: shadow.querySelectorAll('[data-client-id]').length,
    };
    
    // Try to scroll up (to top)
    scrollEl.scrollTop = 0;
    const afterScroll0 = { scrollTop: scrollEl.scrollTop };
    
    // Try to scroll down
    scrollEl.scrollTop = 500;
    const afterScroll500 = { scrollTop: scrollEl.scrollTop };
    
    // Scroll back to bottom
    scrollEl.scrollTop = scrollEl.scrollHeight;
    const afterScrollBottom = { scrollTop: scrollEl.scrollTop };
    
    return {before, afterScroll0, afterScroll500, afterScrollBottom};
});
console.log('[RESULT]', JSON.stringify(result, null, 2));

await browser.close();
