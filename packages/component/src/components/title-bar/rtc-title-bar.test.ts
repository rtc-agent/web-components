import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-title-bar.js';
import type {RtcTitleBar} from './rtc-title-bar.js';

describe('<rtc-title-bar>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcTitleBar>(html`<rtc-title-bar></rtc-title-bar>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should display the app label', async () => {
        const el = await fixture<RtcTitleBar>(
            html`<rtc-title-bar app-label="My App"></rtc-title-bar>`
        );
        await nextFrame();
        const label = el.shadowRoot!.querySelector('.app-label');
        expect(label).not.toBeNull();
        expect(label!.textContent!.trim()).toBe('My App');
    });

    it('should default app label to "RTC Agent"', async () => {
        const el = await fixture<RtcTitleBar>(html`<rtc-title-bar></rtc-title-bar>`);
        await nextFrame();
        const label = el.shadowRoot!.querySelector('.app-label');
        expect(label!.textContent!.trim()).toBe('RTC Agent');
    });

    it('should render minimize button', async () => {
        const el = await fixture<RtcTitleBar>(html`<rtc-title-bar></rtc-title-bar>`);
        const btn = el.shadowRoot!.querySelector('[data-action="minimize"]');
        expect(btn).not.toBeNull();
    });

    it('should render maximize button', async () => {
        const el = await fixture<RtcTitleBar>(html`<rtc-title-bar></rtc-title-bar>`);
        const btn = el.shadowRoot!.querySelector('[data-action="maximize"]');
        expect(btn).not.toBeNull();
    });

    it('should dispatch rtc-window-minimize on minimize click', async () => {
        const el = await fixture<RtcTitleBar>(html`<rtc-title-bar></rtc-title-bar>`);
        const handler = vi.fn();
        el.addEventListener('rtc-window-minimize', handler);
        const btn = el.shadowRoot!.querySelector('[data-action="minimize"]') as HTMLElement;
        btn.click();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should dispatch rtc-window-maximize on maximize click', async () => {
        const el = await fixture<RtcTitleBar>(html`<rtc-title-bar></rtc-title-bar>`);
        const handler = vi.fn();
        el.addEventListener('rtc-window-maximize', handler);
        const btn = el.shadowRoot!.querySelector('[data-action="maximize"]') as HTMLElement;
        btn.click();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should show restore icon when maximized', async () => {
        const el = await fixture<RtcTitleBar>(
            html`<rtc-title-bar window-mode="maximized"></rtc-title-bar>`
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('[data-action="maximize"]');
        expect(btn!.getAttribute('title')).toBe('Restore');
    });
});
