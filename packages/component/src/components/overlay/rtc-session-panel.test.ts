import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-session-panel.js';
import type {RtcSessionPanel} from './rtc-session-panel.js';

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
        expect(el.shadowRoot!.textContent).toContain('暂无会话');
    });

    describe('inline rename', () => {
        it('should enter rename mode when edit button is clicked', async () => {
            const sessions = [{clientId: '1', title: 'Chat A', createdAt: 1, updatedAt: 1}];
            const el = await fixture<RtcSessionPanel>(
                html`<rtc-session-panel .sessions=${sessions}></rtc-session-panel>`
            );
            await nextFrame();

            // Click the edit button.
            const editBtn = el.shadowRoot!.querySelector('[data-action="rename"]') as HTMLButtonElement;
            editBtn.click();
            await nextFrame();

            // Verify rename input is shown.
            const input = el.shadowRoot!.querySelector('.rename-input') as HTMLInputElement;
            expect(input).not.toBeNull();
            expect(input.value).toBe('Chat A');
        });

        it('should dispatch rtc-session-rename-confirmed on Enter', async () => {
            const sessions = [{clientId: '1', title: 'Chat A', createdAt: 1, updatedAt: 1}];
            const el = await fixture<RtcSessionPanel>(
                html`<rtc-session-panel .sessions=${sessions}></rtc-session-panel>`
            );
            await nextFrame();

            // Enter rename mode.
            const editBtn = el.shadowRoot!.querySelector('[data-action="rename"]') as HTMLButtonElement;
            editBtn.click();
            await nextFrame();

            const handler = vi.fn();
            el.addEventListener('rtc-session-rename-confirmed', handler);

            // Type new name and press Enter.
            const input = el.shadowRoot!.querySelector('.rename-input') as HTMLInputElement;
            input.value = 'New Name';
            input.dispatchEvent(new Event('input'));
            input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
            await nextFrame();

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].detail).toEqual({
                sessionId: '1',
                title: 'New Name',
            });
        });

        it('should cancel rename on Escape', async () => {
            const sessions = [{clientId: '1', title: 'Chat A', createdAt: 1, updatedAt: 1}];
            const el = await fixture<RtcSessionPanel>(
                html`<rtc-session-panel .sessions=${sessions}></rtc-session-panel>`
            );
            await nextFrame();

            // Enter rename mode.
            const editBtn = el.shadowRoot!.querySelector('[data-action="rename"]') as HTMLButtonElement;
            editBtn.click();
            await nextFrame();

            const handler = vi.fn();
            el.addEventListener('rtc-session-rename-confirmed', handler);

            // Press Escape.
            const input = el.shadowRoot!.querySelector('.rename-input') as HTMLInputElement;
            input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
            await nextFrame();

            // Should not dispatch rename event.
            expect(handler).not.toHaveBeenCalled();

            // Rename input should be gone.
            const inputAfter = el.shadowRoot!.querySelector('.rename-input');
            expect(inputAfter).toBeNull();
        });

        it('should not dispatch rtc-session-selected while renaming', async () => {
            const sessions = [{clientId: '1', title: 'Chat A', createdAt: 1, updatedAt: 1}];
            const el = await fixture<RtcSessionPanel>(
                html`<rtc-session-panel .sessions=${sessions}></rtc-session-panel>`
            );
            await nextFrame();

            // Enter rename mode.
            const editBtn = el.shadowRoot!.querySelector('[data-action="rename"]') as HTMLButtonElement;
            editBtn.click();
            await nextFrame();

            const selectHandler = vi.fn();
            el.addEventListener('rtc-session-selected', selectHandler);

            // Click the session item while in rename mode.
            const item = el.shadowRoot!.querySelector('.session-item') as HTMLElement;
            item.click();
            await nextFrame();

            // Should not dispatch selection event.
            expect(selectHandler).not.toHaveBeenCalled();
        });

        it('should not confirm rename when title is empty', async () => {
            const sessions = [{clientId: '1', title: 'Chat A', createdAt: 1, updatedAt: 1}];
            const el = await fixture<RtcSessionPanel>(
                html`<rtc-session-panel .sessions=${sessions}></rtc-session-panel>`
            );
            await nextFrame();

            // Enter rename mode.
            const editBtn = el.shadowRoot!.querySelector('[data-action="rename"]') as HTMLButtonElement;
            editBtn.click();
            await nextFrame();

            const handler = vi.fn();
            el.addEventListener('rtc-session-rename-confirmed', handler);

            // Clear the input and press Enter.
            const input = el.shadowRoot!.querySelector('.rename-input') as HTMLInputElement;
            input.value = '   ';
            input.dispatchEvent(new Event('input'));
            input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
            await nextFrame();

            // Should not dispatch rename event when title is empty/whitespace.
            expect(handler).not.toHaveBeenCalled();
        });
    });
});
