import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import './rtc-message-list.js';
import type {RtcMessageList} from './rtc-message-list.js';
import type {Message, ContentData} from '../../types/index.js';
import {MessageContext} from '../../contexts/message.js';

const makeMsg = (clientId: string, content: string): Message => ({
    clientId,
    role: 'assistant',
    content: {type: 'text', data: content} as ContentData,
    timestamp: Date.now(),
    syncStatus: 'synced',
});

const emptyActions = {
    sendMessage: async () => {},
    resendMessage: async () => {},
    forkSession: async () => {},
    appendToLastMessage: () => {},
    finalizeLastMessage: () => {},
    clearMessages: () => {},
    loadMore: async () => {},
};

describe('<rtc-message-list>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: [], hasMore: false, isLoadingMore: false},
                    actions: emptyActions,
                })
            }
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render empty when no messages', async () => {
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: [], hasMore: false, isLoadingMore: false},
                    actions: emptyActions,
                })
            }
        );
        await nextFrame();
        // 直接访问内部缓存的渲染项数组，避免依赖 jsdom 中无法完成布局的虚拟滚动 DOM 输出
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((el as any)._renderItems.length).toBe(0);
    });

    it('should build render items from context messages', async () => {
        const messages = [
            makeMsg('1', 'Hello'),
            makeMsg('2', 'World'),
        ];
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages, hasMore: false, isLoadingMore: false},
                    actions: emptyActions,
                })
            }
        );
        await nextFrame();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = (el as any)._renderItems;
        expect(items.length).toBe(2);
        expect(items.map((i: {type: string}) => i.type)).toEqual(['assistant', 'assistant']);
        expect(items.map((i: {key: string}) => i.key)).toEqual(['1', '2']);
    });

    it('should identify last render item key for is-last attribute', async () => {
        const messages = [
            makeMsg('1', 'First'),
            makeMsg('2', 'Last'),
        ];
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages, hasMore: false, isLoadingMore: false},
                    actions: emptyActions,
                })
            }
        );
        await nextFrame();
        // 验证 lastKey 推导逻辑：`_renderItems` 最后一项的 key 即为模板中 `is-last` 的匹配目标
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = (el as any)._renderItems;
        const lastKey = items[items.length - 1]?.key;
        expect(lastKey).toBe('2');
        expect(items[0].key === lastKey).toBe(false);
        expect(items[1].key === lastKey).toBe(true);
    });

    it('should have a virtualizer-based scroll container', async () => {
        const el = await fixture<RtcMessageList>(
            html`<rtc-message-list></rtc-message-list>`,
            {
                setup: (host) => provideContext(host, MessageContext, {
                    state: {messages: [], hasMore: false, isLoadingMore: false},
                    actions: emptyActions,
                })
            }
        );
        await nextFrame();
        // 原 .message-list-scroll 类现在挂在 <lit-virtualizer> 上
        const virtualizer = el.shadowRoot!.querySelector('lit-virtualizer.message-list-scroll');
        expect(virtualizer).not.toBeNull();
    });
});
