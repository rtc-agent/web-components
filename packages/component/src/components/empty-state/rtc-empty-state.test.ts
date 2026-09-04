import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-empty-state.js';

describe('<rtc-empty-state>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-empty-state></rtc-empty-state>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should display default hint text', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-empty-state></rtc-empty-state>`);
        await nextFrame();
        const hint = el.shadowRoot!.querySelector('.empty-hint');
        expect(hint!.textContent).toContain('/model');
    });

    it('should display custom hint text', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-empty-state hint-text="Custom hint"></rtc-empty-state>`
        );
        await nextFrame();
        const hint = el.shadowRoot!.querySelector('.empty-hint');
        expect(hint!.textContent).toContain('Custom hint');
    });

    it('should render a logo area', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-empty-state></rtc-empty-state>`);
        await nextFrame();
        const logo = el.shadowRoot!.querySelector('.logo-container');
        expect(logo).not.toBeNull();
    });
});
