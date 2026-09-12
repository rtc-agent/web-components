/**
 * Activity Bar Configuration Types
 *
 * 用于 <rtc-agent> 组件的 Activity Bar 配置 API。
 * 控制 Activity Bar 中各活动按钮的显隐。
 */

/**
 * Activity 类型
 */
export type Activity = 'files' | 'chat' | 'settings';

/**
 * Activity Bar 配置
 *
 * 通过 <rtc-agent>.activityBarConfig 属性设置。
 * 注意：chat 按钮始终显示，不可隐藏。
 */
export interface ActivityBarConfig {
    /** 禁用的活动列表（chat 不可禁用） */
    disabledActivities?: Array<'files' | 'settings'>;
    /** 默认活动 */
    defaultActivity?: Activity;
}

/**
 * 解析后的 Activity Bar 配置（所有字段都有默认值）
 */
export interface ResolvedActivityBarConfig {
    disabledActivities: Array<'files' | 'settings'>;
    defaultActivity: Activity;
}

/**
 * 默认 Activity Bar 配置
 */
export const DEFAULT_ACTIVITY_BAR_CONFIG: ResolvedActivityBarConfig = {
    disabledActivities: [],
    defaultActivity: 'chat',
};

/**
 * 解析 Activity Bar 配置（合并默认值）
 */
export function resolveActivityBarConfig(config?: ActivityBarConfig): ResolvedActivityBarConfig {
    if (!config) return { ...DEFAULT_ACTIVITY_BAR_CONFIG };

    return {
        disabledActivities: config.disabledActivities ?? [...DEFAULT_ACTIVITY_BAR_CONFIG.disabledActivities],
        defaultActivity: config.defaultActivity ?? DEFAULT_ACTIVITY_BAR_CONFIG.defaultActivity,
    };
}
