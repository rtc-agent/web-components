import { createContext } from '@lit/context';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('TurnCount');

/**
 * Turn Count Context — Number of active turns in the current session.
 *
 * Provided by the `<rtc-agent>` root component, consumed by `<rtc-input-area>`,
 * used to determine the send button icon / disabled state.
 *
 * Data source: write-time aggregation from the persistence layer. On each turn-related update,
 * EntityRepository writes back pending_turn_count / running_turn_count to the sessions row,
 * UIUpdateBus automatically publishes a session.updated event,
 * and the root component subscribes and reads these two fields from the session row into this context.
 *
 * Provided by: <rtc-agent> (root)
 * Consumed by: <rtc-input-area>
 */

/**
 * Turn count state shape.
 * Represents the number of pending and running turns.
 */
export interface TurnCountState {
  pendingTurnCount: number;
  runningTurnCount: number;
}

/**
 * Turn count actions interface.
 * Currently read-only from consumer perspective — refresh is internal to the controller.
 */
export interface TurnCountActions {
  /** Force refresh turn counts from persistence (for external triggers). */
  refresh: () => Promise<void>;
}

/**
 * Turn count context value.
 * Follows the standard { state, actions } pattern used by other controllers.
 */
export interface TurnCountContextValue {
  state: TurnCountState;
  actions: TurnCountActions;
}

export const TurnCountContext = createContext<TurnCountContextValue>(
  Symbol('turn-count-context'),
);

export const DEFAULT_TURN_COUNT_STATE: TurnCountState = {
  pendingTurnCount: 0,
  runningTurnCount: 0,
};

/**
 * @deprecated Use DEFAULT_TURN_COUNT_STATE instead.
 * Kept for backward compatibility with existing consumers.
 */
export const DEFAULT_TURN_COUNT: TurnCountContextValue = {
  state: DEFAULT_TURN_COUNT_STATE,
  actions: {
    refresh: async () => {
      // No-op default implementation
      log.warn('TurnCountContext: refresh() called on default context');
    },
  },
};
