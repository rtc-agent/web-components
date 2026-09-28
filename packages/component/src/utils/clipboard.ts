/**
 * Clipboard utilities
 *
 * Provides cross-browser compatible clipboard copy functionality.
 * Prefers navigator.clipboard API, falls back to execCommand.
 */

import {createLogger} from '@rtc-agent/client';

const log = createLogger('Clipboard');

/**
 * Copy text to clipboard
 *
 * @param text Text to copy
 * @returns Whether the copy was successful
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // Prefer modern Clipboard API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fall back to execCommand
      log.debug('Clipboard API failed, falling back to execCommand:', err);
    }
  }

  // Fallback: use execCommand (synchronous, compatible with older browsers)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!success) {
      log.warn('execCommand copy returned false');
    }
    return success;
  } catch (err) {
    log.warn('execCommand copy failed:', err);
    return false;
  }
}
