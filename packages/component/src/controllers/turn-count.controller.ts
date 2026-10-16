/**
 * TurnCount Controller
 *
 * Encapsulates turn count state management: pending_turn_count and running_turn_count.
 * These values determine the send button icon / disabled state in <rtc-input-area>.
 *
 * Data source: persistence layer. On each turn-related update, EntityRepository writes back
 * pending_turn_count / running_turn_count to the sessions row, UIUpdateBus automatically
 * publishes a session.updated event, and this controller subscribes and reads these two fields.
 *
 * **Architecture Note**: This controller was extracted from rtc-agent.ts to follow the
 * "every context has a dedicated controller" pattern. Previously, turn count state was managed
 * directly by the root component via _refreshTurnCounts() method and _turnCountProvider.
 *
 * **Design Decision**: This controller implements ReactiveController directly instead of
 * extending CachedContextController because TurnCountContextValue has a flat structure
 * (just state fields + actions) rather than the nested { state, actions } pattern used
 * by other controllers. This keeps the context API simple for consumers.
 *
 * Corresponds to: `turnCountContext` (defined in `contexts/turn-count.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-input-area>`
 */

import type { IPersistenceLayer } from '@rtc-agent/persistence';
import { createLogger } from '@rtc-agent/protocol';
import type { ReactiveControllerHost } from 'lit';
import type {
  TurnCountActions,
  TurnCountState,
} from '../contexts/turn-count.js';
import { DEFAULT_TURN_COUNT_STATE } from '../contexts/turn-count.js';
import { CachedContextController } from '../core/cached-context.controller.js';

const log = createLogger('TurnCountController');

export class TurnCountController extends CachedContextController<
  TurnCountState,
  TurnCountActions
> {
  /** Persistence layer — injected by root component after construction. */
  private _persistence?: IPersistenceLayer;

  /** Session controller — injected by root component after construction. */
  private _getSessionId?: () => string | null;

  constructor(host: ReactiveControllerHost) {
    const actions: TurnCountActions = {
      refresh: () => this.refresh(),
    };
    super(host, { ...DEFAULT_TURN_COUNT_STATE }, actions, log);
  }

  /**
   * Inject persistence layer dependency.
   * Called by root component after construction (dependency injection pattern).
   */
  setPersistence(persistence: IPersistenceLayer) {
    this._persistence = persistence;
  }

  /**
   * Inject session ID getter.
   * Called by root component after construction (dependency injection pattern).
   */
  setSessionIdGetter(getSessionId: () => string | null) {
    this._getSessionId = getSessionId;
  }

  /**
   * Refresh turn counts from persistence layer.
   *
   * **Design**: This method is called by:
   * 1. UIUpdateBus session.updated events (automatic)
   * 2. UIUpdateBus bulk-update with 'turn' entity (automatic)
   * 3. UIUpdateBus gap-fill end (automatic)
   * 4. External consumers via actions.refresh() (rare, for manual sync)
   *
   * Pushes zero values when there's no currentSessionId or persistence isn't ready.
   */
  async refresh(): Promise<void> {
    const currentId = this._getSessionId?.();
    if (!currentId || !this._persistence) {
      this._setState({ ...DEFAULT_TURN_COUNT_STATE });
      this.host.requestUpdate();
      return;
    }

    try {
      const session = await this._persistence.getSession(currentId);
      if (!session) {
        this._setState({ ...DEFAULT_TURN_COUNT_STATE });
        this.host.requestUpdate();
        return;
      }

      this._setState({
        pendingTurnCount: session.pending_turn_count,
        runningTurnCount: session.running_turn_count,
      });
      this.host.requestUpdate();
    } catch (err) {
      // getSession() can throw if Worker/IndexedDB communication fails.
      // Degrade gracefully: reset to defaults instead of unhandled rejection.
      log.warn('Failed to refresh turn counts:', err);
      this._setState({ ...DEFAULT_TURN_COUNT_STATE });
      this.host.requestUpdate();
    }
  }

  // ReactiveController lifecycle hooks (optional, but required by interface)

  hostConnected?(): void;
  hostDisconnected?(): void;
}
