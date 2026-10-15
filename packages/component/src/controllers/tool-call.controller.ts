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
import type { ReactiveControllerHost } from 'lit';
import type { ToolCallContextValue } from '../contexts/tool-call.js';
import { DEFAULT_TOOL_CALL_STATE } from '../contexts/tool-call.js';
import { CachedContextController } from '../core/cached-context.controller.js';
import type {
  ToolCall,
  ToolCallActions,
  ToolCallState,
} from '../types/index.js';

export class ToolCallController extends CachedContextController<
  ToolCallState,
  ToolCallActions
> {
  // Store host with EventTarget type for dispatchEvent
  private _eventHost: ReactiveControllerHost & EventTarget;

  constructor(host: ReactiveControllerHost & EventTarget) {
    const actions: ToolCallActions = {
      approve: (id: string) => this._approve(id),
      approveAll: (toolName: string) => this._approveAll(toolName),
      deny: (id: string) => this._deny(id),
    };

    super(host, { ...DEFAULT_TOOL_CALL_STATE }, actions);

    this._eventHost = host;
  }

  /** Override value getter to return ToolCallContextValue type */
  get value(): ToolCallContextValue {
    return super.value as ToolCallContextValue;
  }

  /**
   * Add a pending tool call.
   *
   * **Note**: This method is not in the `ToolCallActions` interface and is not exposed via Context.
   * It is only for direct use by the protocol layer (future) and demo page (task19) calling the Controller.
   * User-triggered tool call operations (approve/deny) still go through Context actions.
   */
  addPendingCall(call: ToolCall) {
    this._setState({
      pendingCalls: [...this._state.pendingCalls, call],
    });
    this._eventHost.requestUpdate();
  }

  private _approve(id: string) {
    const call = this._state.pendingCalls.find((tc) => tc.id === id);
    const pendingCalls = this._state.pendingCalls.filter((tc) => tc.id !== id);
    this._setState({ pendingCalls });
    this._eventHost.requestUpdate();
    this._eventHost.dispatchEvent(
      new CustomEvent('rtc-tool-call-approved', {
        bubbles: true,
        composed: true,
        detail: { id, toolName: call?.tool_name },
      }),
    );
  }

  private _approveAll(toolName: string) {
    const pendingCalls = this._state.pendingCalls.filter(
      (tc) => tc.tool_name !== toolName,
    );
    this._setState({ pendingCalls });
    this._eventHost.requestUpdate();
    this._eventHost.dispatchEvent(
      new CustomEvent('rtc-tool-call-approve-all', {
        bubbles: true,
        composed: true,
        detail: { toolName },
      }),
    );
  }

  private _deny(id: string) {
    const pendingCalls = this._state.pendingCalls.filter((tc) => tc.id !== id);
    this._setState({ pendingCalls });
    this._eventHost.requestUpdate();
    this._eventHost.dispatchEvent(
      new CustomEvent('rtc-tool-call-denied', {
        bubbles: true,
        composed: true,
        detail: { id },
      }),
    );
  }
}
