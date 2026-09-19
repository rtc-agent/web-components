import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-content-area.js';
import type {RtcContentArea} from './rtc-content-area.js';

describe('<rtc-content-area>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`,
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should show empty-state when no messages', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`,
        );
        await nextFrame();
        const empty = el.shadowRoot!.querySelector('rtc-empty-state');
        expect(empty).not.toBeNull();
    });

    it('should show message-list when sessionId is set', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area .sessionId=${'test-session'}></rtc-content-area>`,
        );
        await nextFrame();
        const list = el.shadowRoot!.querySelector('rtc-message-list');
        expect(list).not.toBeNull();
        const empty = el.shadowRoot!.querySelector('rtc-empty-state');
        expect(empty).toBeNull();
    });

    it('should show empty-state when sessionId is not set', async () => {
        const el = await fixture<RtcContentArea>(
            html`<rtc-content-area></rtc-content-area>`,
        );
        await nextFrame();
        const empty = el.shadowRoot!.querySelector('rtc-empty-state');
        expect(empty).not.toBeNull();
    });
});
