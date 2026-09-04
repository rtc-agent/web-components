import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import {SessionContext} from '../../contexts/session.js';
import type {SessionContextValue} from '../../contexts/session.js';
import './rtc-session-header.js';

const mockSessionCtx: SessionContextValue = {
    state: {sessions: [], currentSessionId: null},
    actions: {createSession: () => {}, switchSession: () => {}, renameSession: () => {}, deleteSession: () => {}, reset: () => {}, clearCurrentSession: () => {}, setCurrentSession: () => {}, setSessions: () => {}},
};

describe('<rtc-session-header>', () => {
    afterEach(() => cleanupFixtures());

    const setupContexts = (host: HTMLElement) => {
        provideContext(host, SessionContext, mockSessionCtx);
    };

    it('should render with shadow DOM', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: setupContexts}
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should display default title when no session', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: setupContexts}
        );
        await nextFrame();
        const title = el.shadowRoot!.querySelector('.session-title');
        expect(title!.textContent!.trim()).toBe('Untitled');
    });

    it('should display provided session title', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header session-title="My Chat"></rtc-session-header>`,
            {setup: setupContexts}
        );
        await nextFrame();
        const title = el.shadowRoot!.querySelector('.session-title');
        expect(title!.textContent!.trim()).toBe('My Chat');
    });

    it('should have a history button', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: setupContexts}
        );
        const btn = el.shadowRoot!.querySelector('[data-action="history"]');
        expect(btn).not.toBeNull();
    });

    it('should have a new session button', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: setupContexts}
        );
        const btn = el.shadowRoot!.querySelector('[data-action="new-session"]');
        expect(btn).not.toBeNull();
    });

    it('should toggle session panel on history click', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: setupContexts}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('[data-action="history"]') as HTMLElement;

        // First click: open panel
        btn.click();
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-panel')).not.toBeNull();

        // Second click: close panel
        btn.click();
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-panel')).toBeNull();
    });

    it('should close session panel on Escape key', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: setupContexts}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('[data-action="history"]') as HTMLElement;

        // Open panel
        btn.click();
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-panel')).not.toBeNull();

        // Press Escape
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-panel')).toBeNull();
    });

    it('should close session panel on click outside', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: setupContexts}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('[data-action="history"]') as HTMLElement;

        // Open panel
        btn.click();
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-panel')).not.toBeNull();

        // Click outside (on document body)
        document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-panel')).toBeNull();
    });

    it('should call clearCurrentSession on new session click', async () => {
        const clearCurrentSession = vi.fn();
        const ctx: SessionContextValue = {
            ...mockSessionCtx,
            actions: {...mockSessionCtx.actions, clearCurrentSession},
        };
        const el = await fixture<HTMLElement>(
            html`<rtc-session-header></rtc-session-header>`,
            {setup: (host) => provideContext(host, SessionContext, ctx)}
        );
        const btn = el.shadowRoot!.querySelector('[data-action="new-session"]') as HTMLElement;
        btn.click();
        expect(clearCurrentSession).toHaveBeenCalledTimes(1);
    });
});
