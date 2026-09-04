import {createContext} from '@lit/context';

/**
 * Turn Count Context — 当前会话中处于活跃状态的 turn 数量
 *
 * 由 `<rtc-agent>` 根组件提供，`<rtc-input-area>` 消费，
 * 用于决定 send 按钮的图标 / disabled 状态。
 *
 * 数据来源：persistence 层的写时聚合。每次收到 turn 相关 Update，
 * EntityRepository 会把该 session 的 pending_turn_count / running_turn_count
 * 回写到 sessions 行，UIUpdateBus 自动发布 session.updated 事件，
 * 根组件订阅后从 session 行读出两个字段推入本 context。
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
