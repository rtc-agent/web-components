import {render, TemplateResult, LitElement} from 'lit';

/**
 * Wait for one animation frame — ensures Lit has completed its update cycle.
 */
export function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export interface FixtureOptions {
    setup?: (host: HTMLElement) => void;
}

/**
 * 测试用 fixture 渲染。
 *
 * 时序契约（重要）：
 * 1. 如果提供了 options.setup，它会在第一次 nextFrame() 之前同步执行
 * 2. setup 中调用 provideContext() 是安全的，context 会在 host 首次 update 时就位
 * 3. 不要在 setup 中 await 任何东西——此时元素尚未 connected
 *
 * @example
 * const el = await fixture(html`<my-consumer></my-consumer>`, {
 *   setup: (host) => provideContext(host, sessionContext, initialValue)
 * });
 */
export async function fixture<T extends HTMLElement>(
    template: TemplateResult,
    options?: FixtureOptions
): Promise<T> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(template, container);
    const el = container.firstElementChild as T;
    if (options?.setup) {
        options.setup(el);
    }
    await nextFrame();
    // Wait for Lit update cycle if element is a LitElement
    if (el instanceof LitElement) {
        await el.updateComplete;
    }
    return el;
}

/**
 * Cleanup helper — call in afterEach to remove all fixture containers.
 *
 * Also clears localStorage to prevent state leakage between tests
 * (e.g., AuthController persists tokens which would affect subsequent tests).
 */
export function cleanupFixtures(): void {
    document.body.innerHTML = '';
    try {
        localStorage.clear();
    } catch {
        // Some environments may block storage access; ignore.
    }
}
