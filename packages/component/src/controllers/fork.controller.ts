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
import {msg, str} from '@lit/localize';
import type {ContentData} from '../types/index.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('ForkController');

/** Fork state: set when user initiates a fork, cleared on submit or cancel. */
export interface ForkState {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    hintMessage: string;
}

export interface ForkActions {
    /** Initiate a fork from a specific message. newSessionClientId is provided by the caller (chat-layout). */
    requestFork: (oldSessionClientId: string, oldMessageClientId: string, newSessionClientId: string, content: string) => void;
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
    /** Clear messages in the message list (switch to blank state). */
    clearMessages: () => void;
    /** Clear transient UI params (initialInputValue, noticeMessage) from the tab. */
    clearTransientParams: (sessionId: string) => void;
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
            requestFork: (oldSC, oldMC, newSC, content) => this._requestFork(oldSC, oldMC, newSC, content),
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

    private _requestFork(oldSessionClientId: string, oldMessageClientId: string, newSessionClientId: string, _content: string) {
        const truncatedContent = _content.length > 30 ? _content.slice(0, 30) + '...' : _content;

        this._state = {
            oldSessionClientId,
            oldMessageClientId,
            newSessionClientId,
            hintMessage: msg(str`🔀 从「${truncatedContent}」分叉`),
        };
        this._host.requestUpdate();

        // 清空消息列表（唯一需要的命令式操作）
        // input value 和 notice message 已通过 tab transient params 传递（由 chat-layout 设置）
        // Lit 渲染时通过 property binding 自动传递给 input-area / notice-bar
        this._deps?.clearMessages();
        log.debug('_requestFork: state set, transient params handled by tab property binding');
    }

    private async _submitFork(content: ContentData) {
        if (!this._state || !this._deps) return;

        const newMessageClientId = `msg-${crypto.randomUUID()}`;

        try {
            await this._deps.executeFork({
                oldSessionClientId: this._state.oldSessionClientId,
                oldMessageClientId: this._state.oldMessageClientId,
                newSessionClientId: this._state.newSessionClientId,
                newMessageClientId,
                content,
            });
        } catch (err) {
            log.error('forkSession failed:', err);
        }

        this._clearFork();
    }

    private _clearFork() {
        if (this._state) {
            // 清除 tab 上的 transient params（input value + notice message）
            this._deps?.clearTransientParams(this._state.newSessionClientId);
        }
        this._state = null;
        this._host.requestUpdate();
    }
}
