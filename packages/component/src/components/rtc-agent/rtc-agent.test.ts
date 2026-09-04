import {describe, it, expect, afterEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import './rtc-agent.js';

describe('<rtc-agent>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-agent></rtc-agent>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should have default theme "system"', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-agent></rtc-agent>`);
        expect(el.getAttribute('theme')).toBe('system');
    });

    it('should accept theme attribute', async () => {
        const el = await fixture<HTMLElement>(
            html`<rtc-agent theme="dark"></rtc-agent>`
        );
        expect(el.getAttribute('theme')).toBe('dark');
    });

    it('should contain a title-bar element', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-agent></rtc-agent>`);
        const titleBar = el.shadowRoot?.querySelector('rtc-title-bar');
        expect(titleBar).not.toBeNull();
    });

    it('should contain a content-wrapper element after login', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-agent></rtc-agent>`);
        // Login first
        (el as any).authController.actions.login();
        await nextFrame();
        const wrapper = el.shadowRoot?.querySelector('rtc-content-wrapper');
        expect(wrapper).not.toBeNull();
    });

    it('should render login page when not logged in', async () => {
        const el = await fixture<HTMLElement>(html`<rtc-agent></rtc-agent>`);
        await nextFrame();
        const login = el.shadowRoot?.querySelector('rtc-login-page');
        expect(login).not.toBeNull();
    });
});
