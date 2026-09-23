/**
 * Dialog factory helpers for <rtc-agent>.
 *
 * Pure functions that create and manage dialog overlays.
 * Extracted from rtc-agent.ts to keep the root component lean.
 */
import type { LocalRtc } from '@rtc-agent/persistence';

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
    return new Promise((resolve) => {
        const el = document.createElement("rtc-tool-confirm");
        el.toolCall = {
            id: rtc.client_id,
            toolName: rtc.tool_name,
            parameters: rtc.parameters as Record<string, unknown> | undefined,
            status: "pending",
        };

        const cleanup = () => {
            el.removeEventListener("rtc-tool-call-approved", onApproved);
            el.removeEventListener("rtc-tool-call-denied", onDenied);
            el.remove();
        };

        const onApproved = () => {
            cleanup();
            resolve(true);
        };

        const onDenied = () => {
            cleanup();
            resolve(false);
        };

        el.addEventListener("rtc-tool-call-approved", onApproved);
        el.addEventListener("rtc-tool-call-denied", onDenied);

        // Append to shadowRoot to maintain style inheritance.
        host.appendChild(el);
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
    return new Promise((resolve) => {
        const el = document.createElement("rtc-ask-user");
        el.rtc = rtc;

        const cleanup = () => {
            el.removeEventListener("rtc-ask-user-submit", onSubmit);
            el.removeEventListener("rtc-ask-user-dismiss", onDismiss);
            el.remove();
        };

        const onSubmit = (e: Event) => {
            const detail = (e as CustomEvent).detail as {
                clientId: string;
                payload: AskUserAnswer;
            };
            cleanup();
            resolve(detail.payload);
        };

        const onDismiss = () => {
            cleanup();
            resolve(null);
        };

        el.addEventListener("rtc-ask-user-submit", onSubmit);
        el.addEventListener("rtc-ask-user-dismiss", onDismiss);

        host.appendChild(el);
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
    return new Promise((resolve) => {
        const el = document.createElement("rtc-restore-confirm");
        el.filePath = filePath;

        const cleanup = () => {
            el.removeEventListener("rtc-restore-confirmed", onConfirm);
            el.removeEventListener("rtc-restore-cancelled", onCancel);
            el.remove();
        };

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        el.addEventListener("rtc-restore-confirmed", onConfirm);
        el.addEventListener("rtc-restore-cancelled", onCancel);

        host.appendChild(el);
    });
}
