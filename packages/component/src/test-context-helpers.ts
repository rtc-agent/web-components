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
 * Wrap a context provider around the host element's light DOM parent.
 *
 * Timing contract (important):
 * 1. The wrapper must be inserted as the host's light DOM parent (cannot append to document.body)
 *    -- because @consume walks up the composed tree to find the provider.
 * 2. It must be done synchronously before fixture() calls await nextFrame()
 *    -- otherwise @consume won't find the provider during the first update cycle.
 * 3. The wrapper uses <slot> to render the host; the context propagates correctly through the slot.
 *
 * @returns The provider wrapper element. Call wrapper.updateContext(value) to update the context value.
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
         * Update the context value.
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
