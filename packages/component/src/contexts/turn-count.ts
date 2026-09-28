import {createContext} from '@lit/context';

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
export interface TurnCountContextValue {
    pendingTurnCount: number;
    runningTurnCount: number;
}

export const TurnCountContext = createContext<TurnCountContextValue>(
    Symbol('turn-count-context')
);

export const DEFAULT_TURN_COUNT: TurnCountContextValue = {
    pendingTurnCount: 0,
    runningTurnCount: 0,
};
