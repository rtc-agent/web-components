import {describe, it, expect, afterEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import './rtc-login-page.js';
import type {RtcLoginPage} from './rtc-login-page.js';
import {AuthContext} from '../../contexts/auth.js';
import type {AuthContextValue} from '../../contexts/auth.js';

const mockAuthCtx: AuthContextValue = {
    state: {isLoggedIn: false},
    login: () => {},
    logout: () => {},
};

describe('<rtc-login-page>', () => {
    afterEach(() => cleanupFixtures());

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should display app name', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page app-name="My App"></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        await nextFrame();
        const name = el.shadowRoot!.querySelector('.app-name');
        expect(name!.textContent!.trim()).toBe('My App');
    });

    it('should default app name to "RTC Agent"', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        await nextFrame();
        const name = el.shadowRoot!.querySelector('.app-name');
        expect(name!.textContent!.trim()).toBe('RTC Agent');
    });

    it('should show login button when not loading', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        await nextFrame();
        const btn = el.shadowRoot!.querySelector('.login-btn');
        expect(btn).not.toBeNull();
        expect(btn!.textContent).toContain('Login');
    });

    it('should show loading state when loading', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page loading></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        await nextFrame();
        const loading = el.shadowRoot!.querySelector('.loading-text');
        expect(loading).not.toBeNull();
        expect(loading!.textContent).toContain('Authorizing');
    });

    it('should show error message when error provided', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page error-message="Auth failed"></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        await nextFrame();
        const err = el.shadowRoot!.querySelector('.error-text');
        expect(err).not.toBeNull();
        expect(err!.textContent).toContain('Auth failed');
    });

    it('should dispatch rtc-login-requested on button click', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        await nextFrame();
        const handler = vi.fn();
        el.addEventListener('rtc-login-requested', handler);
        const btn = el.shadowRoot!.querySelector('.login-btn') as HTMLElement;
        btn.click();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should render a logo area', async () => {
        const el = await fixture<RtcLoginPage>(
            html`<rtc-login-page></rtc-login-page>`,
            {setup: (host) => provideContext(host, AuthContext, mockAuthCtx)}
        );
        await nextFrame();
        const logo = el.shadowRoot!.querySelector('.logo');
        expect(logo).not.toBeNull();
    });
});
