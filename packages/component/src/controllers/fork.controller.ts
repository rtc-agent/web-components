/**
 * Fork Controller
 *
 * Manages the fork-session flow: when the user clicks "fork" on a message,
 * we prepare a new session pre-filled with the message content. The user
 * can then edit and submit to create a branched session.
 *
 * Extracted from <rtc-agent> root component to keep it under 300 lines.
 *
 * No context — fork state is consumed only by the root component internally.
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {ContentData} from '../types/index.js';

/** Fork state: set when user initiates a fork, cleared on submit or cancel. */
export interface ForkState {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    hintMessage: string;
}

export interface ForkActions {
    /** Initiate a fork from a specific message. */
    requestFork: (oldMessageClientId: string, content: string) => void;
    /** Submit the fork: create the new session and send the message. */
    submitFork: (content: ContentData) => Promise<void>;
    /** Cancel the fork and return to normal mode. */
    clearFork: () => void;
}

/**
 * Callbacks the fork controller needs from the outside world.
 * Set by the root component after construction.
 */
export interface ForkDeps {
    /** Get the current session's client ID. */
    getCurrentSessionId: () => string | null;
    /** Clear messages in the message list (switch to blank state). */
    clearMessages: () => void;
    /** Set the input area value (pre-fill with forked content). */
    setInputValue: (value: string) => void;
    /** Set the notice bar hint message. */
    setNoticeMessage: (message: string) => void;
    /** Clear the notice bar. */
    clearNoticeMessage: () => void;
    /** Execute the fork via MessageController. */
    executeFork: (params: {
        oldSessionClientId: string;
        oldMessageClientId: string;
        newSessionClientId: string;
        newMessageClientId: string;
        content: ContentData;
    }) => Promise<void>;
}

export class ForkController implements ReactiveController {
    private _host: ReactiveControllerHost;
    private _state: ForkState | null = null;
    private _deps: ForkDeps | null = null;

    readonly actions: ForkActions;

    get state(): ForkState | null {
        return this._state;
    }

    get isActive(): boolean {
        return this._state !== null;
    }

    constructor(host: ReactiveControllerHost) {
        this._host = host;
        this._host.addController(this);
        this.actions = {
            requestFork: (msgId, content) => this._requestFork(msgId, content),
            submitFork: (content) => this._submitFork(content),
            clearFork: () => this._clearFork(),
        };
    }

    /** Wire dependencies after construction (avoids circular init). */
    setDeps(deps: ForkDeps) {
        this._deps = deps;
    }

    hostConnected() {}
    hostDisconnected() {}

    private _requestFork(oldMessageClientId: string, content: string) {
        const currentSessionId = this._deps?.getCurrentSessionId();
        if (!currentSessionId) {
            console.error('[ForkController] cannot fork: no current session');
            return;
        }

        const newSessionClientId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const truncatedContent = content.length > 30 ? content.slice(0, 30) + '...' : content;

        this._state = {
            oldSessionClientId: currentSessionId,
            oldMessageClientId,
            newSessionClientId,
            hintMessage: `🔀 从「${truncatedContent}」分叉`,
        };
        this._host.requestUpdate();

        // Immediately clear messages (switch to "new session blank state")
        this._deps?.clearMessages();
        // Pre-fill input with the forked content
        this._deps?.setInputValue(content);
        // Show hint in notice bar
        this._deps?.setNoticeMessage(this._state.hintMessage);
    }

    private async _submitFork(content: ContentData) {
        if (!this._state || !this._deps) return;

        const newMessageClientId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            await this._deps.executeFork({
                oldSessionClientId: this._state.oldSessionClientId,
                oldMessageClientId: this._state.oldMessageClientId,
                newSessionClientId: this._state.newSessionClientId,
                newMessageClientId,
                content,
            });
        } catch (err) {
            console.error('[ForkController] forkSession failed:', err);
        }

        this._clearFork();
    }

    private _clearFork() {
        this._state = null;
        this._deps?.clearNoticeMessage();
        this._host.requestUpdate();
    }
}
