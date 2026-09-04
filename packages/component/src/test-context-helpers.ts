/**
 * Test helpers for providing mock @lit/context values in test fixtures.
 *
 * Usage:
 *   await fixture<MyComponent>(
 *     html`<my-component></my-component>`,
 *     { setup: (host) => provideContext(host, myContext, mockValue) }
 *   );
 */
import {html} from 'lit';
import {LitElement} from 'lit';
import {customElement} from 'lit/decorators.js';
import {ContextProvider} from '@lit/context';
import type {Context} from '@lit/context';

/**
 * 将 context provider 包装到 host 元素的 light DOM 父节点。
 *
 * 时序契约（重要）：
 * 1. wrapper 必须作为 host 的 light DOM 父节点插入（不能 append 到 document.body）
 *    ——因为 @consume 沿 composed tree 向上查找 provider
 * 2. 必须在 fixture() 调用 await nextFrame() 之前同步完成
 *    ——否则 @consume 在首次 update cycle 时找不到 provider
 * 3. wrapper 使用 <slot> 渲染 host，context 通过 slot 正确传播
 *
 * @returns provider wrapper 元素，可以通过 wrapper.updateContext(value) 更新 context 值
 */
export function provideContext<T>(
    host: HTMLElement,
    context: Context<unknown, T>,
    value: T
): HTMLElement {
    const tagName = 'test-context-provider-' + Math.random().toString(36).slice(2, 8);

    @customElement(tagName)
    class TestProvider extends LitElement {
        private _provider = new ContextProvider(this, {context, initialValue: value});

        /**
         * 更新 context 值
         */
        updateContext(newValue: T) {
            this._provider.setValue(newValue);
        }

        render() {
            return html`<slot></slot>`;
        }
    }

    const wrapper = document.createElement(tagName) as TestProvider;

    host.parentNode?.insertBefore(wrapper, host);
    wrapper.appendChild(host);

    return wrapper;
}
