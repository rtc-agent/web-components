import {describe, it, expect, afterEach, beforeEach} from 'vitest';
import {html} from 'lit';
import {fixture, cleanupFixtures, nextFrame} from '../../test-helpers.js';
import {provideContext} from '../../test-context-helpers.js';
import {SessionTabContext, type SessionTabContextValue} from '../../contexts/session-tab.js';
import {SessionContext, type SessionContextValue} from '../../contexts/session.js';
import type {SessionTabState} from '../../types/index.js';
import './rtc-chat-layout.js';
import type {RtcChatLayout} from './rtc-chat-layout.js';

describe('<rtc-chat-layout> multi-instance rendering', () => {
    afterEach(() => cleanupFixtures());

    let mockTabState: SessionTabState;
    let mockTabActions: SessionTabContextValue['actions'];
    let mockSessionState: SessionContextValue['state'];
    let mockSessionActions: SessionContextValue['actions'];

    beforeEach(() => {
        mockTabState = {
            tabs: [],
            activeSessionId: null,
        };

        mockTabActions = {
            openOrActivate: () => {},
            closeTab: () => {},
            setActiveTab: () => {},
            clearAll: () => {},
            updateTabTitles: () => {},
            syncTabStatuses: () => {},
            markSaved: () => {},
            findUnsavedTab: () => undefined,
            updateTabStatus: () => {},
        };

        mockSessionState = {
            sessions: [],
            currentSessionId: null,
        };

        mockSessionActions = {
            createSession: () => '',
            switchSession: () => {},
            renameSession: async () => ({ok: true}),
            deleteSession: async () => ({ok: true}),
            closeSession: async () => ({ok: true}),
            reopenSession: async () => ({ok: true}),
            reset: () => {},
            clearCurrentSession: () => {},
            setCurrentSession: () => {},
            setSessions: () => {},
        };
    });

    const createLayoutWithContext = async (): Promise<{
        layout: RtcChatLayout;
        updateTabContext: (value: SessionTabContextValue) => void;
        updateSessionContext: (value: SessionContextValue) => void;
    }> => {
        const tabContextValue: SessionTabContextValue = {
            state: mockTabState,
            actions: mockTabActions,
        };

        const sessionContextValue: SessionContextValue = {
            state: mockSessionState,
            actions: mockSessionActions,
        };

        let tabWrapper: HTMLElement;
        let sessionWrapper: HTMLElement;

        const el = await fixture<RtcChatLayout>(
            html`<rtc-chat-layout></rtc-chat-layout>`,
            {
                setup: (host) => {
                    // Wrap in reverse order so SessionContext is innermost
                    sessionWrapper = provideContext(host, SessionContext, sessionContextValue);
                    tabWrapper = provideContext(sessionWrapper, SessionTabContext, tabContextValue);
                },
            }
        );

        const updateTabContext = (value: SessionTabContextValue) => {
            (tabWrapper as any)._provider.setValue(value);
        };

        const updateSessionContext = (value: SessionContextValue) => {
            (sessionWrapper as any)._provider.setValue(value);
        };

        await nextFrame();
        return {
            layout: el,
            updateTabContext,
            updateSessionContext,
        };
    };

    it('should render empty-state when no tabs are open', async () => {
        const {layout} = await createLayoutWithContext();

        const emptyState = layout.shadowRoot!.querySelector('rtc-empty-state');
        expect(emptyState).not.toBeNull();

        const messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists.length).toBe(0);
    });

    it('should render one message-list per tab', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
            {sessionId: 'session-2', title: 'Session 2'},
            {sessionId: 'session-3', title: 'Session 3'},
        ];
        mockTabState.activeSessionId = 'session-1';

        const {layout, updateTabContext} = await createLayoutWithContext();

        // Trigger context update
        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        const messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists.length).toBe(3);

        // Verify each message-list has the correct sessionId
        expect(messageLists[0].sessionId).toBe('session-1');
        expect(messageLists[1].sessionId).toBe('session-2');
        expect(messageLists[2].sessionId).toBe('session-3');
    });

    it('should set visibility: visible on active tab', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
            {sessionId: 'session-2', title: 'Session 2'},
        ];
        mockTabState.activeSessionId = 'session-1';

        const {layout, updateTabContext} = await createLayoutWithContext();

        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        const messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists[0].style.visibility).toBe('visible');
        expect(messageLists[1].style.visibility).toBe('hidden');
    });

    it('should set visibility: hidden on non-active tabs', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
            {sessionId: 'session-2', title: 'Session 2'},
            {sessionId: 'session-3', title: 'Session 3'},
        ];
        mockTabState.activeSessionId = 'session-2';

        const {layout, updateTabContext} = await createLayoutWithContext();

        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        const messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists[0].style.visibility).toBe('hidden');
        expect(messageLists[1].style.visibility).toBe('visible');
        expect(messageLists[2].style.visibility).toBe('hidden');
    });

    it('should update visibility when active tab changes', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
            {sessionId: 'session-2', title: 'Session 2'},
        ];
        mockTabState.activeSessionId = 'session-1';

        const {layout, updateTabContext} = await createLayoutWithContext();

        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        // Initially session-1 is active
        let messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists[0].style.visibility).toBe('visible');
        expect(messageLists[1].style.visibility).toBe('hidden');

        // Switch to session-2
        mockTabState.activeSessionId = 'session-2';
        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists[0].style.visibility).toBe('hidden');
        expect(messageLists[1].style.visibility).toBe('visible');
    });

    it('should remove message-list from DOM when tab is closed', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
            {sessionId: 'session-2', title: 'Session 2'},
            {sessionId: 'session-3', title: 'Session 3'},
        ];
        mockTabState.activeSessionId = 'session-2';

        const {layout, updateTabContext} = await createLayoutWithContext();

        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        let messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists.length).toBe(3);

        // Close session-2
        mockTabState.tabs = mockTabState.tabs.filter(t => t.sessionId !== 'session-2');
        mockTabState.activeSessionId = 'session-1'; // Simulate adjacent tab activation
        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        messageLists = layout.shadowRoot!.querySelectorAll('rtc-message-list');
        expect(messageLists.length).toBe(2);

        // Verify the correct message-list was removed
        expect(messageLists[0].sessionId).toBe('session-1');
        expect(messageLists[1].sessionId).toBe('session-3');
    });

    it('should render rtc-notice-bar with active sessionId', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
            {sessionId: 'session-2', title: 'Session 2'},
        ];
        mockTabState.activeSessionId = 'session-2';

        const {layout, updateTabContext} = await createLayoutWithContext();

        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        const noticeBar = layout.shadowRoot!.querySelector('rtc-notice-bar');
        expect(noticeBar).not.toBeNull();
    });

    it('should render rtc-input-area with active sessionId', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
            {sessionId: 'session-2', title: 'Session 2'},
        ];
        mockTabState.activeSessionId = 'session-1';

        const {layout, updateTabContext} = await createLayoutWithContext();

        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        const inputArea = layout.shadowRoot!.querySelector('rtc-input-area');
        expect(inputArea).not.toBeNull();
        expect(inputArea!.sessionId).toBe('session-1');
    });

    it('should not render message-lists-container when no tabs', async () => {
        const {layout} = await createLayoutWithContext();

        const container = layout.shadowRoot!.querySelector('.message-lists-container');
        expect(container).toBeNull();

        const emptyState = layout.shadowRoot!.querySelector('rtc-empty-state');
        expect(emptyState).not.toBeNull();
    });

    it('should render message-lists-container when tabs exist', async () => {
        mockTabState.tabs = [
            {sessionId: 'session-1', title: 'Session 1'},
        ];
        mockTabState.activeSessionId = 'session-1';

        const {layout, updateTabContext} = await createLayoutWithContext();

        updateTabContext({state: mockTabState, actions: mockTabActions});
        await nextFrame();

        const container = layout.shadowRoot!.querySelector('.message-lists-container');
        expect(container).not.toBeNull();

        const messageLists = container!.querySelectorAll('rtc-message-list');
        expect(messageLists.length).toBe(1);
    });
});
