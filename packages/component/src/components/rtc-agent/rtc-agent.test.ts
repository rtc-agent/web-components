import {describe, it, expect, afterEach, beforeEach, vi} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures} from '../../test-helpers.js';
import {RtcAgent} from './rtc-agent.js';
import './rtc-agent.js'; // side-effect: ensure @customElement registration
import {createRtcAgent} from '../../factory.js';

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
    afterEach(() => {
        vi.restoreAllMocks();
        cleanupFixtures();
    });

    // ── Basic rendering tests ──

    it('should render with shadow DOM', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        expect(el.shadowRoot).not.toBeNull();
    });

    it('should resolve default theme "system" to light or dark', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        // SettingsController resolves 'system' to 'light' or 'dark' based on OS preference
        const theme = el.getAttribute('theme');
        expect(theme === 'light' || theme === 'dark').toBe(true);
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

    it('should contain a chat-layout element after login', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        // Login via setTokens (actions.login only dispatches an event, does not set isLoggedIn)
        el.authController.setTokens({
            accessToken: 'fake-token',
            refreshToken: 'fake-refresh',
            userId: 'user-1',
            expiresIn: 3600,
        });
        await el.updateComplete;
        const chatLayout = el.shadowRoot?.querySelector('rtc-chat-layout');
        expect(chatLayout).not.toBeNull();
    });

    it('should render login page when not logged in', async () => {
        const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
        await el.updateComplete;
        const login = el.shadowRoot?.querySelector('rtc-login-page');
        expect(login).not.toBeNull();
    });

    // ── _beforeMessageSend pipeline tests ──

    describe('_beforeMessageSend pipeline', () => {
        it('should short-circuit Layer 2 DOM event when hook returns false', async () => {
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
            let domEventFired = false;
            el.addEventListener('rtc-before-message-send', () => {
                domEventFired = true;
            });

            // Install hook that returns false (cancels send).
            (el as any)._beforeMessageSendHook = () => false;

            const result = await (el as any)._beforeMessageSend({
                message: {content: 'hello'},
            });

            // Hook returned false → send cancelled.
            expect(result).toBe(false);
            // Layer 2 DOM event must NOT fire (short-circuit).
            expect(domEventFired).toBe(false);
        });

        it('should degrade gracefully when hook throws and continue sending', async () => {
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Install hook that throws.
            (el as any)._beforeMessageSendHook = () => {
                throw new Error('hook crash');
            };

            const result = await (el as any)._beforeMessageSend({
                message: {content: 'hello'},
            });

            // Hook threw → graceful degradation: Layer 2 runs, no cancel → returns true.
            expect(result).toBe(true);
            // Error was logged.
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });

        it('should return false when DOM event is cancelled via preventDefault', async () => {
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);

            // Layer 2 listener cancels the send.
            el.addEventListener('rtc-before-message-send', (e) => {
                e.preventDefault();
            });

            // No hook installed (Layer 1 skipped).
            const result = await (el as any)._beforeMessageSend({
                message: {content: 'hello'},
            });

            // DOM event was cancelled → returns false.
            expect(result).toBe(false);
        });

        it('should return true when both layers pass', async () => {
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
            let hookCalled = false;
            let domEventCalled = false;

            // Layer 1: hook returns true (allow).
            (el as any)._beforeMessageSendHook = () => {
                hookCalled = true;
                return true;
            };

            // Layer 2: DOM event fires without cancel.
            el.addEventListener('rtc-before-message-send', () => {
                domEventCalled = true;
            });

            const result = await (el as any)._beforeMessageSend({
                message: {content: 'hello'},
            });

            expect(result).toBe(true);
            expect(hookCalled).toBe(true);
            expect(domEventCalled).toBe(true);
        });
    });

    // ── disconnectedCallback cleanup tests ──

    describe('disconnectedCallback cleanup', () => {
        it('should clear _beforeMessageSendHook on disconnect', async () => {
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);

            // Install a hook.
            (el as any)._beforeMessageSendHook = () => true;
            expect((el as any)._beforeMessageSendHook).toBeDefined();

            // Remove from DOM → triggers disconnectedCallback.
            el.remove();

            // Hook must be cleared to prevent closure leaks.
            expect((el as any)._beforeMessageSendHook).toBeUndefined();
        });

        it('should dispatch rtc-before-destroy event on disconnect', async () => {
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);
            let destroyFired = false;
            el.addEventListener('rtc-before-destroy', () => {
                destroyFired = true;
            });

            // Remove from DOM → triggers disconnectedCallback.
            el.remove();

            // rtc-before-destroy must fire before cleanup logic runs.
            expect(destroyFired).toBe(true);
        });

        it('should function correctly after remove and re-add (reconnect)', async () => {
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);

            // Install a hook (will be cleared by disconnect).
            (el as any)._beforeMessageSendHook = () => true;

            // Remove from DOM.
            el.remove();
            expect(el.isConnected).toBe(false);
            // Hook must be cleared.
            expect((el as any)._beforeMessageSendHook).toBeUndefined();

            // Re-add to DOM → triggers connectedCallback again.
            document.body.appendChild(el);
            expect(el.isConnected).toBe(true);

            // connectedCallback re-initializes internal wiring; render completes without error.
            await el.updateComplete;
            const titleBar = el.shadowRoot?.querySelector('rtc-title-bar');
            expect(titleBar).not.toBeNull();
        });
    });

    // ── Auth boundary tests ──

    describe('auth boundary', () => {
        it('should initialize auth state correctly when factory provides StaticTokenAuth', async () => {
            const agent = createRtcAgent({
                auth: {
                    accessToken: 'test-token',
                    refreshToken: 'test-refresh',
                    userId: 'user-42',
                    expiresIn: 3600,
                },
            });
            document.body.appendChild(agent);
            await agent.updateComplete;

            // Auth state must reflect the static tokens.
            expect(agent.authController.state.isLoggedIn).toBe(true);
            expect(agent.authController.state.userId).toBe('user-42');
            expect(agent.authController.state.accessToken).toBe('test-token');

            agent.destroy();
        });

        it('should fire authError callback when token refresh fails', async () => {
            // Mock fetch to reject (simulates network error during token refresh).
            const fetchSpy = vi
                .spyOn(globalThis, 'fetch')
                .mockRejectedValue(new Error('Network error'));

            const authErrorSpy = vi.fn();
            const el = await fixture<RtcAgent>(html`<rtc-agent></rtc-agent>`);

            // Register authError callback (factory wires it to rtc-auth-refresh-failed event).
            el.addEventListener('rtc-auth-refresh-failed', authErrorSpy);

            // Set valid tokens → auth state becomes logged-in, refresh timer scheduled.
            el.authController.setTokens({
                accessToken: 'initial-token',
                refreshToken: 'refresh-token',
                userId: 'user-1',
                expiresIn: 3600,
            });
            await el.updateComplete;

            // Manually trigger token expiry → handleTokenExpired → _doRefresh → fetch fails.
            // This simulates the real-world flow where the RTC layer detects an expired token.
            await el.authController.handleTokenExpired();

            // Auth error callback must fire (mapped from rtc-auth-refresh-failed event).
            expect(authErrorSpy).toHaveBeenCalled();
            // Auth state must revert to logged-out after refresh failure.
            expect(el.authController.state.isLoggedIn).toBe(false);

            fetchSpy.mockRestore();
        });
    });
});
