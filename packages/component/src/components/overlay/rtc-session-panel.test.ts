import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-session-panel.js';

describe('<rtc-session-panel>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-session-panel></rtc-session-panel>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render sessions list', async () => {
        const sessions = [
            {clientId: '1', title: 'Chat A', createdAt: 1, updatedAt: 1},
            {clientId: '2', title: 'Chat B', createdAt: 2, updatedAt: 2},
        ];
        const el = await fixture<HTMLElement>(
            html`<rtc-session-panel .sessions=${sessions}></rtc-session-panel>`
        );
        await nextFrame();
        const items = el.shadowRoot!.querySelectorAll('.session-item');
        expect(items.length).toBe(2);
    });

    it('should dispatch rtc-session-selected on item click', async () => {
        const sessions = [{clientId: '1', title: 'Chat A', createdAt: 1, updatedAt: 1}];
        const el = await fixture<HTMLElement>(
            html`<rtc-session-panel .sessions=${sessions}></rtc-session-panel>`
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-session-selected', handler);
        const item = el.shadowRoot!.querySelector('.session-item') as HTMLElement;
        item.click();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.sessionId).toBe('1');
    });

    it('should show empty text when no sessions', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-session-panel .sessions=${[]}></rtc-session-panel>`);
        await nextFrame();
        expect(el.shadowRoot!.textContent).toContain('No sessions');
    });
});
