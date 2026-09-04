import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-mode-panel.js';

describe('<rtc-mode-panel>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-mode-panel></rtc-mode-panel>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render modes list', async () => {
        const modes = ['manual', 'edit', 'plan', 'auto'];
        const el = await fixture<HTMLElement>(
            html`<rtc-mode-panel .modes=${modes} current-mode="manual"></rtc-mode-panel>`
        );
        await nextFrame();
        const items = el.shadowRoot!.querySelectorAll('.mode-item');
        expect(items.length).toBe(4);
    });

    it('should highlight the current mode', async () => {
        const modes = ['manual', 'edit', 'plan'];
        const el = await fixture<HTMLElement>(
            html`<rtc-mode-panel .modes=${modes} current-mode="edit"></rtc-mode-panel>`
        );
        await nextFrame();
        const active = el.shadowRoot!.querySelector('.mode-item.active');
        expect(active!.textContent!.trim()).toContain('edit');
    });

    it('should dispatch rtc-mode-selected on item click', async () => {
        const modes = ['manual', 'edit'];
        const el = await fixture<HTMLElement>(
            html`<rtc-mode-panel .modes=${modes} current-mode="manual"></rtc-mode-panel>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-mode-selected', handler);
        const items = el.shadowRoot!.querySelectorAll('.mode-item');
        (items[1] as HTMLElement).click();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.mode).toBe('edit');
    });
});
