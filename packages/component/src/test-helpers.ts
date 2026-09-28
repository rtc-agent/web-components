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
 * Test fixture rendering.
 *
 * Timing contract (important):
 * 1. If options.setup is provided, it runs synchronously before the first nextFrame().
 * 2. It is safe to call provideContext() in setup; the context will be in place before the host's first update.
 * 3. Do not await anything inside setup -- the element is not yet connected at that point.
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
