import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import './rtc-overlay-manager.js';
import type {RtcOverlayManager} from './rtc-overlay-manager.js';
import {ToolCallContext} from '../../contexts/tool-call.js';
import type {ToolCallContextValue} from '../../contexts/tool-call.js';

const mockToolCallCtx: ToolCallContextValue = {
    state: {pendingCalls: []},
    actions: {approve: () => {}, approveAll: () => {}, deny: () => {}},
};

describe('<rtc-overlay-manager>', () => {
    afterEach(() => cleanupFixtures());

    const setupContexts = (host: HTMLElement) => {
        provideContext(host, ToolCallContext, mockToolCallCtx);
    };

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcOverlayManager>(
            html`<rtc-overlay-manager></rtc-overlay-manager>`,
            {setup: setupContexts}
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should not show any panel by default', async () => {
        const el = await fixture<RtcOverlayManager>(
            html`<rtc-overlay-manager></rtc-overlay-manager>`,
            {setup: setupContexts}
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-session-panel')).toBeNull();
        expect(el.shadowRoot!.querySelector('rtc-mode-panel')).toBeNull();
        expect(el.shadowRoot!.querySelector('rtc-tool-confirm')).toBeNull();
    });

    it('should show tool confirm when pending tool call exists', async () => {
        const toolCtx: ToolCallContextValue = {
            state: {pendingCalls: [{id: 'tc-1', toolName: 'file-write', status: 'pending', parameters: {}}]},
            actions: {approve: () => {}, approveAll: () => {}, deny: () => {}},
        };
        const el = await fixture<RtcOverlayManager>(
            html`<rtc-overlay-manager></rtc-overlay-manager>`,
            {
                setup: (host) => {
                    provideContext(host, ToolCallContext, toolCtx);
                },
            }
        );
        await nextFrame();
        expect(el.shadowRoot!.querySelector('rtc-tool-confirm')).not.toBeNull();
    });
});
