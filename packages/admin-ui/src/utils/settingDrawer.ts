/**
 * Lightweight state manager for the settings drawer.
 *
 * Extracted from InitialState to avoid triggering re-renders of all
 * initialState consumers when the drawer opens/closes (pure UI state).
 *
 * Uses a simple pub/sub pattern with custom events for cross-component
 * communication. The layout component subscribes to 'open' events;
 * other components (e.g. AvatarDropdown) dispatch them.
 */

type Listener = (open: boolean) => void;

const listeners = new Set<Listener>();

let _isOpen = false;

/**
 * Subscribe to setting drawer open/close changes.
 * Returns an unsubscribe function.
 */
export const subscribeSettingDrawer = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Get the current open state (snapshot). */
export const getSettingDrawerOpen = (): boolean => _isOpen;

/** Open the settings drawer (called from AvatarDropdown, etc.). */
export const openSettingDrawer = (): void => {
  _isOpen = true;
  listeners.forEach((fn) => {
    fn(true);
  });
};

/** Close the settings drawer. */
export const closeSettingDrawer = (): void => {
  _isOpen = false;
  listeners.forEach((fn) => {
    fn(false);
  });
};

/** Set the open state directly (used by the layout component). */
export const setSettingDrawerOpen = (open: boolean): void => {
  _isOpen = open;
  listeners.forEach((fn) => {
    fn(open);
  });
};
