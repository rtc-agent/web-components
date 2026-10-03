/**
 * Activity Bar Configuration Types
 *
 * Used for Activity Bar configuration API of the <rtc-agent> component.
 * Controls the visibility of activity buttons in the Activity Bar.
 */

/**
 * Activity type
 */
export type Activity = 'files' | 'chat' | 'settings' | 'functions';

/**
 * Activity Bar configuration
 *
 * Set via the <rtc-agent>.activityBarConfig property.
 * Note: the chat button is always visible and cannot be hidden.
 */
export interface ActivityBarConfig {
  /** Disabled activities list (chat cannot be disabled) */
  disabledActivities?: Array<'files' | 'settings' | 'functions'>;
  /** Default activity */
  defaultActivity?: Activity;
}

/**
 * Resolved Activity Bar configuration (all fields have defaults)
 */
export interface ResolvedActivityBarConfig {
  disabledActivities: Array<'files' | 'settings' | 'functions'>;
  defaultActivity: Activity;
}

/**
 * Default Activity Bar configuration
 */
export const DEFAULT_ACTIVITY_BAR_CONFIG: ResolvedActivityBarConfig = {
  disabledActivities: [],
  defaultActivity: 'chat',
};

/**
 * Resolve Activity Bar configuration (merge with defaults)
 */
export function resolveActivityBarConfig(config?: ActivityBarConfig): ResolvedActivityBarConfig {
  if (!config) return { ...DEFAULT_ACTIVITY_BAR_CONFIG };

  return {
    disabledActivities: config.disabledActivities ?? [...DEFAULT_ACTIVITY_BAR_CONFIG.disabledActivities],
    defaultActivity: config.defaultActivity ?? DEFAULT_ACTIVITY_BAR_CONFIG.defaultActivity,
  };
}
