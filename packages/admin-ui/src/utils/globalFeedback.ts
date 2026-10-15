/**
 * Global Message and Notification Instance Management
 *
 * Problem:
 * Ant Design's static message/notification APIs (message.success, notification.open, etc.)
 * don't automatically consume ConfigProvider theme context. This causes issues in dark mode
 * where the feedback UI appears with a white background instead of matching the theme.
 *
 * Solution:
 * This module provides a global registry for message and notification instances that are
 * context-aware (obtained via App.useApp() hook). Non-component code (like request interceptors,
 * utility functions) can then access these instances to show themed feedback.
 *
 * Usage:
 * 1. In a component near the root (e.g., app.tsx), register the instances:
 *    ```tsx
 *    const { message, notification } = App.useApp();
 *    setGlobalFeedbackInstances({ message, notification });
 *    ```
 *
 * 2. In non-component code, retrieve and use them:
 *    ```ts
 *    const { message } = getGlobalFeedbackInstances();
 *    message.success('Operation completed');
 *    ```
 *
 * Note:
 * For components, prefer using App.useApp() directly. This module is primarily for
 * non-component code that needs to show feedback (e.g., request error handlers, utility functions).
 */

import type { MessageInstance } from 'antd/es/message/interface';
import type { NotificationInstance } from 'antd/es/notification/interface';

interface FeedbackInstances {
  message: MessageInstance;
  notification: NotificationInstance;
}

let globalFeedbackInstances: FeedbackInstances | null = null;

/**
 * Register global message and notification instances
 *
 * Should be called once during app initialization, typically in a root component
 * that has access to the App context via App.useApp().
 *
 * @param instances - The message and notification instances from App.useApp(), or null to clear
 */
export function setGlobalFeedbackInstances(
  instances: FeedbackInstances | null | undefined,
): void {
  globalFeedbackInstances = instances ?? null;
}

/**
 * Get the globally registered message and notification instances
 *
 * Returns the registered instances, or falls back to static antd imports if not yet registered.
 * The fallback ensures that feedback can still be shown during early app initialization
 * before the component tree is fully mounted.
 *
 * @returns The feedback instances (message and notification)
 */
export function getGlobalFeedbackInstances(): FeedbackInstances {
  if (globalFeedbackInstances) {
    return globalFeedbackInstances;
  }

  // Fallback to static imports for early initialization
  // Note: These won't have theme context, but ensure feedback still works
  // Lazy import to avoid circular dependencies
  console.warn(
    '[feedback] Global feedback instances not yet registered, using static fallback. ' +
      'This may cause theme inconsistencies in dark mode.',
  );

  // Lazy import to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const antd = require('antd');
  return {
    message: antd.message,
    notification: antd.notification,
  };
}

/**
 * Clear the globally registered instances (for testing or cleanup)
 */
export function clearGlobalFeedbackInstances(): void {
  globalFeedbackInstances = null;
}
