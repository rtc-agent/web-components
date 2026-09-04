/**
 * ToolCall Controller
 *
 * Encapsulates tool call state machine: pending -> approved | denied.
 * Supports approving individual calls or all calls for a given tool name.
 * Dispatches `rtc-tool-call-*` events for external consumers.
 *
 * Also exposes `addPendingCall()` for the demo page and future protocol layer
 * to inject new tool calls into the pending queue.
 *
 * Corresponds to: `toolCallContext` (defined in `contexts/tool-call.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-tool-confirm>`, `<rtc-overlay-manager>`
 */
import type {ReactiveController, ReactiveControllerHost} from 'lit';
import type {ToolCall, ToolCallState, ToolCallActions} from '../types/index.js';
import type {ToolCallContextValue} from '../contexts/tool-call.js';
import {DEFAULT_TOOL_CALL_STATE} from '../contexts/tool-call.js';

export class ToolCallController implements ReactiveController {
    host: ReactiveControllerHost & EventTarget;

    private _state: ToolCallState = {...DEFAULT_TOOL_CALL_STATE};

    readonly actions: ToolCallActions;

    get value(): ToolCallContextValue {
        return {state: this._state, actions: this.actions};
    }

    constructor(host: ReactiveControllerHost & EventTarget) {
        this.host = host;
        this.host.addController(this);
        this.actions = {
            approve: (id: string) => this._approve(id),
            approveAll: (toolName: string) => this._approveAll(toolName),
            deny: (id: string) => this._deny(id),
        };
    }

    hostConnected() {}
    hostDisconnected() {}

    /**
     * 添加待处理的 tool call。
     *
     * **注意**：此方法不在 `ToolCallActions` 接口中，不通过 Context 暴露。
     * 仅供协议层（未来）和 demo 页面（task19）直接调用 Controller 使用。
     * 用户触发的 tool call 操作（approve/deny）仍通过 Context actions。
     */
    addPendingCall(call: ToolCall) {
        this._state = {
            pendingCalls: [...this._state.pendingCalls, call],
        };
        this.host.requestUpdate();
    }

    private _approve(id: string) {
        const call = this._state.pendingCalls.find(tc => tc.id === id);
        const pendingCalls = this._state.pendingCalls.filter(tc => tc.id !== id);
        this._state = {pendingCalls};
        this.host.requestUpdate();
        this.host.dispatchEvent(
            new CustomEvent('rtc-tool-call-approved', {
                bubbles: true,
                composed: true,
                detail: {id, toolName: call?.toolName},
            })
        );
    }

    private _approveAll(toolName: string) {
        const pendingCalls = this._state.pendingCalls.filter(tc => tc.toolName !== toolName);
        this._state = {pendingCalls};
        this.host.requestUpdate();
        this.host.dispatchEvent(
            new CustomEvent('rtc-tool-call-approve-all', {
                bubbles: true,
                composed: true,
                detail: {toolName},
            })
        );
    }

    private _deny(id: string) {
        const pendingCalls = this._state.pendingCalls.filter(tc => tc.id !== id);
        this._state = {pendingCalls};
        this.host.requestUpdate();
        this.host.dispatchEvent(
            new CustomEvent('rtc-tool-call-denied', {
                bubbles: true,
                composed: true,
                detail: {id},
            })
        );
    }
}
