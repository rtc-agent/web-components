/**
 * Dialog factory helpers for <rtc-agent>.
 *
 * Pure functions that create and manage dialog overlays.
 * Extracted from rtc-agent.ts to keep the root component lean.
 */
import type { LocalRtc } from '@rtc-agent/persistence';
import type { ExportOptions } from '../../overlay/rtc-export-dialog.js';

/**
 * Common template for creating dialog promises.
 *
 * Handles the boilerplate of:
 * - Creating the element
 * - Setting up event listeners for resolve/reject
 * - Cleaning up listeners and removing the element
 * - Appending to the shadow root
 *
 * @param tagName - The custom element tag name (e.g., 'rtc-tool-confirm')
 * @param host - The shadow root to append the dialog to
 * @param setup - Callback to configure the element and return resolve handler + event mappings
 * @returns A promise that resolves when the dialog is dismissed
 */
function createDialogPromise<T>(
    tagName: string,
    host: ShadowRoot,
    setup: (el: HTMLElement, resolve: (value: T) => void) => Array<[string, EventListener]>
): Promise<T> {
    return new Promise((resolve) => {
        const el = document.createElement(tagName);
        const listeners = setup(el, resolve);

        const cleanup = () => {
            for (const [eventName, handler] of listeners) {
                el.removeEventListener(eventName, handler);
            }
            el.remove();
        };

        // Wrap handlers to auto-cleanup before resolving
        for (const [eventName, originalHandler] of listeners) {
            const wrappedHandler: EventListener = (e) => {
                cleanup();
                originalHandler(e);
            };
            // Remove original, add wrapped
            el.removeEventListener(eventName, originalHandler);
            el.addEventListener(eventName, wrappedHandler);
        }

        host.appendChild(el);
    });
}

// ── Tool Confirm Dialog ──

/**
 * Show tool confirmation dialog.
 *
 * Creates an <rtc-tool-confirm> overlay, appends it to the host's shadowRoot,
 * and returns a Promise that resolves to true (approved) or false (denied).
 * The overlay is automatically removed after the user responds.
 *
 * @param rtc - The RTC record being confirmed.
 * @param host - The shadow root host to append the dialog to.
 */
export function showToolConfirmDialog(
    rtc: LocalRtc,
    host: ShadowRoot,
): Promise<boolean> {
    return createDialogPromise<boolean>('rtc-tool-confirm', host, (el, resolve) => {
        (el as HTMLInputElement & { toolCall: unknown }).toolCall = {
            id: rtc.client_id,
            toolName: rtc.tool_name,
            parameters: rtc.parameters as Record<string, unknown> | undefined,
            status: "pending",
        };

        return [
            ['rtc-tool-call-approved', () => resolve(true)],
            ['rtc-tool-call-denied', () => resolve(false)],
        ];
    });
}

// ── Ask User Dialog ──

export interface AskUserAnswer {
    answers: Record<string, string>;
    annotations?: Record<string, { preview?: string; notes?: string }>;
    metadata?: { source?: string };
}

/**
 * Show AskUser multi-select dialog.
 *
 * Creates an <rtc-ask-user> overlay, appends it to the host's shadowRoot,
 * and returns a Promise that resolves to the user's answer dict or null if dismissed.
 * The overlay is automatically removed after the user responds.
 *
 * @param rtc - The RTC record containing the questions.
 * @param host - The shadow root host to append the dialog to.
 */
export function showAskUserDialog(
    rtc: LocalRtc,
    host: ShadowRoot,
): Promise<AskUserAnswer | null> {
    return createDialogPromise<AskUserAnswer | null>('rtc-ask-user', host, (el, resolve) => {
        (el as HTMLInputElement & { rtc: LocalRtc }).rtc = rtc;

        return [
            ['rtc-ask-user-submit', (e: Event) => {
                const detail = (e as CustomEvent).detail as {
                    clientId: string;
                    payload: AskUserAnswer;
                };
                resolve(detail.payload);
            }],
            ['rtc-ask-user-dismiss', () => resolve(null)],
        ];
    });
}

// ── Restore Confirm Dialog ──

/**
 * Show restore-to-default confirmation dialog.
 *
 * Creates an <rtc-restore-confirm> overlay, appends it to the host's shadowRoot,
 * and returns a Promise that resolves to true (confirmed) or false (cancelled).
 * The overlay is automatically removed after the user responds.
 *
 * @param filePath - The file path being restored.
 * @param host - The shadow root host to append the dialog to.
 */
export function showRestoreConfirmDialog(
    filePath: string,
    host: ShadowRoot,
): Promise<boolean> {
    return createDialogPromise<boolean>('rtc-restore-confirm', host, (el, resolve) => {
        (el as HTMLInputElement & { filePath: string }).filePath = filePath;

        return [
            ['rtc-restore-confirmed', () => resolve(true)],
            ['rtc-restore-cancelled', () => resolve(false)],
        ];
    });
}

// ── Export Dialog ──

/**
 * Show export options dialog.
 *
 * Creates an <rtc-export-dialog> overlay, appends it to the host's shadowRoot,
 * and returns a Promise that resolves to the export options or null if cancelled.
 * The overlay is automatically removed after the user responds.
 *
 * @param totalMessages - Total number of messages available for export.
 * @param host - The shadow root host to append the dialog to.
 */
export function showExportDialog(
    totalMessages: number,
    host: ShadowRoot,
): Promise<ExportOptions | null> {
    return createDialogPromise<ExportOptions | null>('rtc-export-dialog', host, (el, resolve) => {
        (el as HTMLInputElement & { totalMessages: number }).totalMessages = totalMessages;

        return [
            ['rtc-export-confirm', (e: Event) => {
                const detail = (e as CustomEvent<ExportOptions>).detail;
                resolve(detail);
            }],
            ['rtc-export-cancel', () => resolve(null)],
        ];
    });
}
