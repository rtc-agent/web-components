import {describe, it, expect, afterEach, beforeEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures} from '../../test-helpers.js';
import {RtcAgent} from './rtc-agent.js';
import './rtc-agent.js'; // side-effect: ensure @customElement registration

describe('<rtc-agent>', () => {
    beforeEach(() => {
        // Ensure each test starts with a clean auth state (AuthController reads
        // from localStorage in its constructor, so leftovers would leak across tests).
        try {
            localStorage.clear();
        } catch {
            // ignore
        }
    });
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should have default theme "system"', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        expect(el.getAttribute('theme')).toBe('system');
    });

    it('should accept theme attribute', async () => {
        const el = await fixture<RtcAgent>(
            html`<rtc-agent theme="dark"></rtc-agent>`
        );
        expect(el.getAttribute('theme')).toBe('dark');
    });

    it('should contain a title-bar element', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        const titleBar = el.shadowRoot?.querySelector('rtc-title-bar');
        expect(titleBar).not.toBeNull();
    });

    it('should contain a content-wrapper element after login', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        // Login via setTokens (actions.login only dispatches an event, does not set isLoggedIn)
        el.authController.setTokens({
            accessToken: 'fake-token',
            refreshToken: 'fake-refresh',
            userId: 'user-1',
            expiresIn: 3600,
        });
        await el.updateComplete;
        const wrapper = el.shadowRoot?.querySelector('rtc-content-wrapper');
        expect(wrapper).not.toBeNull();
    });

    it('should render login page when not logged in', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        await el.updateComplete;
        const login = el.shadowRoot?.querySelector('rtc-login-page');
        expect(login).not.toBeNull();
    });
});
