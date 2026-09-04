import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import './rtc-input-area.js';
import type {RtcInputArea} from './rtc-input-area.js';
import {ModeContext} from '../../contexts/mode.js';
import type {ModeContextValue} from '../../contexts/mode.js';

const mockModeCtx: ModeContextValue = {
    state: {currentMode: 'manual'},
    actions: {setMode: () => {}},
};

describe('<rtc-input-area>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should render a textarea', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const textarea = el.shadowRoot!.querySelector('textarea');
        expect(textarea).not.toBeNull();
    });

    it('should show the current mode label', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.mode-btn');
        expect(btn!.textContent).toContain('Manual');
    });

    it('should dispatch rtc-input-submit with content on Enter', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-input-submit', handler);
        const textarea = el.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
        textarea.value = 'Hello';
        textarea.dispatchEvent(new Event('input'));
        textarea.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.content).toBe('Hello');
    });

    it('should not submit on Enter+Shift', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-input-submit', handler);
        const textarea = el.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
        textarea.value = 'Hello';
        textarea.dispatchEvent(new Event('input'));
        textarea.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', shiftKey: true}));
        expect(handler).not.toHaveBeenCalled();
    });

    it('should not submit empty input', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-input-submit', handler);
        const textarea = el.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
        textarea.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
        expect(handler).not.toHaveBeenCalled();
    });

    it('should clear textarea after submit', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const textarea = el.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
        textarea.value = 'Hello';
        textarea.dispatchEvent(new Event('input'));
        textarea.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
        await nextFrame();
        expect(textarea.value).toBe('');
    });

    it('should show mode panel on mode button click', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.mode-btn') as HTMLElement;
        btn.click();
        await nextFrame();
        const panel = el.shadowRoot!.querySelector('rtc-mode-panel');
        expect(panel).not.toBeNull();
    });

    it('should have a send button', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.send-btn');
        expect(btn).not.toBeNull();
    });

    it('should disable send button when textarea is empty', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.send-btn') as HTMLButtonElement;
        expect(btn!.disabled).toBe(true);
    });

    it('should enable send button when textarea has content', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const textarea = el.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
        textarea.value = 'Hello';
        textarea.dispatchEvent(new Event('input'));
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.send-btn') as HTMLButtonElement;
        expect(btn!.disabled).toBe(false);
    });

    it('should submit on send button click', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-input-submit', handler);
        const textarea = el.shadowRoot!.querySelector('textarea') as HTMLTextAreaElement;
        textarea.value = 'Hello';
        textarea.dispatchEvent(new Event('input'));
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.send-btn') as HTMLButtonElement;
        btn.click();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail.content).toBe('Hello');
    });

    it('should have a voice input button', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.voice-btn');
        expect(btn).not.toBeNull();
    });

    it('should dispatch rtc-voice-input-requested on voice button click', async () => {
        const el = await fixture<RtcInputArea>(
            html`<rtc-input-area></rtc-input-area>`,
            {setup: (host) => provideContext(host, ModeContext, mockModeCtx)}
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-voice-input-requested', handler);
        const btn = el.shadowRoot!.querySelector('.voice-btn') as HTMLElement;
        btn.click();
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
