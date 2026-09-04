import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-notice-bar.js';

describe('<rtc-notice-bar>', () => {
    afterEach(() => cleanupFixtures());

    it('should render when message is provided', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-notice-bar message="Hello notice"></rtc-notice-bar>`
        );
        await nextFrame();
        expect(el.shadowRoot!.textContent).toContain('Hello notice');
    });

    it('should not render when message is empty', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-notice-bar></rtc-notice-bar>`);
        await nextFrame();
        const bar = el.shadowRoot!.querySelector('.notice-bar');
        expect(bar).toBeNull();
    });

    it('should have a close button', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-notice-bar message="Test"></rtc-notice-bar>`
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.close-btn');
        expect(btn).not.toBeNull();
    });

    it('should hide after close button is clicked', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-notice-bar message="Test"></rtc-notice-bar>`
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.close-btn') as HTMLElement;
        btn.click();
        await nextFrame();
        const bar = el.shadowRoot!.querySelector('.notice-bar');
        expect(bar).toBeNull();
    });

    it('should dispatch rtc-notice-dismissed on close', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-notice-bar message="Test"></rtc-notice-bar>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-notice-dismissed', handler);
        const btn = el.shadowRoot!.querySelector('.close-btn') as HTMLElement;
        btn.click();
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
