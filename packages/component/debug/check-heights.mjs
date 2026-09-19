import {chromium} from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto('http://localhost:40000/debug/message-list.html');
await page.waitForTimeout(2000);
await page.click('#btn-add-100');
await page.waitForTimeout(1000);

const result = await page.evaluate(() => {
    const list = document.getElementById('message-list');
    const shadow = list?.shadowRoot;
    const scrollEl = shadow?.querySelector('.message-list-scroll');
    const innerEl = shadow?.querySelector('.message-list-inner');
    const chatContainer = document.querySelector('.chat-container');
    const body = document.body;
    
    function info(el, name) {
        if (!el) return {name, error: 'not found'};
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            name,
            height: r.height,
            overflow: cs.overflow,
            overflowY: cs.overflowY,
            display: cs.display,
            flex: cs.flex,
            minHeight: cs.minHeight,
            maxHeight: cs.maxHeight,
        };
    }
    
    return {
        body: info(body, 'body'),
        chatContainer: info(chatContainer, '.chat-container'),
        host: info(list, 'rtc-message-list'),
        scroll: info(scrollEl, '.message-list-scroll'),
        inner: info(innerEl, '.message-list-inner'),
        innerChildCount: innerEl?.children.length,
        firstChildHeight: innerEl?.children[0]?.getBoundingClientRect().height,
    };
});
console.log('[RESULT]', JSON.stringify(result, null, 2));

await browser.close();
