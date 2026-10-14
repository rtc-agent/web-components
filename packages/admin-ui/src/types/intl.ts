/**
 * Shared internationalization types
 *
 * Common interfaces for components that accept intl descriptors.
 */

/**
 * Intl descriptor shape accepted by components.
 * Keeps components decoupled from the exact intl implementation.
 */
export interface IntlShape {
  formatMessage: (descriptor: {
    id: string;
    defaultMessage?: string;
  }) => string;
}
