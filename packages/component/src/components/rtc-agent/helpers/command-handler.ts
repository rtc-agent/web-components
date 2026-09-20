/**
 * Slash command dispatch for <rtc-agent>.
 *
 * Extracted from rtc-agent.ts to keep the root component lean.
 * Each command is a pure async function that takes its dependencies explicitly.
 */
import { msg } from '@lit/localize';
import type { PersistenceLayer } from '@rtc-agent/persistence';
import type { Logger } from '@rtc-agent/client';
import type { ToastActions } from '../../../controllers/toast.controller.js';

// ── Dependency interfaces ──

export interface CommandDeps {
    persistenceLayer: PersistenceLayer | undefined;
    currentSessionId: string | null;
    toast: ToastActions;
    logger: Logger;
}

// ── Public API ──

/**
 * Handle slash commands dispatched from the input area.
 *
 * Currently supported:
 * - /compact [custom_instruction]: compress current session context
 */
export async function handleCommand(
    name: string,
    args: string | undefined,
    deps: CommandDeps,
): Promise<void> {
    switch (name) {
        case "compact":
            await handleCompactCommand(args, deps);
            break;
        default:
            deps.toast.show(`未知命令: /${name}`, "error");
            break;
    }
}

/**
 * Handle the /compact command.
 *
 * Calls the server RPC to compress the current session context.
 * Does not show a success toast immediately (waits for Live push to update session state).
 * Shows an error toast on failure.
 */
async function handleCompactCommand(
    customInstruction: string | undefined,
    deps: CommandDeps,
): Promise<void> {
    const { persistenceLayer, currentSessionId, toast, logger } = deps;

    if (!currentSessionId) {
        toast.show(msg("没有活动的会话"), "error");
        return;
    }

    if (!persistenceLayer) {
        toast.show(msg("服务未连接"), "error");
        return;
    }

    toast.show(msg("正在压缩上下文..."), "info");

    try {
        await persistenceLayer.compactSession(currentSessionId, customInstruction);
        // Success: don't show toast immediately, wait for Live push to update session.
    } catch (err) {
        logger.error("/compact failed:", err);
        const message = err instanceof Error ? err.message : msg("压缩上下文失败");
        toast.show(message, "error");
    }
}
