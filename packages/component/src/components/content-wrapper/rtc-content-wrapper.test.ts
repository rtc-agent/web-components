import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-content-wrapper.js';

describe('<rtc-content-wrapper>', () => {
    afterEach(() => {
        cleanupFixtures();
        vi.restoreAllMocks();
    });

    it('should render with shadow DOM', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-content-wrapper></rtc-content-wrapper>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should contain session-header', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-content-wrapper></rtc-content-wrapper>`);
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-header')).not.toBeNull();
    });

    it('should contain content-area', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-content-wrapper></rtc-content-wrapper>`);
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-content-area')).not.toBeNull();
    });

    it('should contain input-area', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-content-wrapper></rtc-content-wrapper>`);
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-input-area')).not.toBeNull();
    });

    it('should contain overlay-manager', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-content-wrapper></rtc-content-wrapper>`);
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-overlay-manager')).not.toBeNull();
    });
});
