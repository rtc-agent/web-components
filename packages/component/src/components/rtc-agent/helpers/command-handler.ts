/**
 * Slash command dispatch for <rtc-agent>.
 *
 * Extracted from rtc-agent.ts to keep the root component lean.
 * Each command is a pure async function that takes its dependencies explicitly.
 */
import { msg, str } from '@lit/localize';
import type { PersistenceLayer } from '@rtc-agent/persistence';
import type { Logger } from '@rtc-agent/client';
import type { ToastActions } from '../../../controllers/toast.controller.js';
import type { Session, Message } from '../../../types/index.js';
import { exportSession } from '../../../utils/session-exporter.js';
import { showExportDialog } from './dialog-helpers.js';
import type { ExportOptions } from '../../overlay/rtc-export-dialog.js';

// ── Dependency interfaces ──

export interface CommandDeps {
    persistenceLayer: PersistenceLayer | undefined;
    currentSessionId: string | null;
    /** Current session object (for commands that need session metadata like title, tokens). */
    currentSession?: Session;
    /** Current session messages (for commands that need message data like /export). */
    currentMessages?: Message[];
    /** Shadow root host for showing dialogs. */
    host?: ShadowRoot;
    toast: ToastActions;
    logger: Logger;
}

// ── Public API ──

/**
 * Handle slash commands dispatched from the input area.
 *
 * Currently supported:
 * - /compact [custom_instruction]: compress current session context
 * - /export: export current session to HTML file
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
        case "export":
            await handleExportCommand(deps);
            break;
        default:
            deps.toast.show(msg(str`未知命令: /${name}`), "error");
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

/**
 * Handle the /export command.
 *
 * Shows an export options dialog, then exports current session to HTML file.
 * Filters out streaming (incomplete) messages before export.
 * Applies user-selected options (limit, tool calls, thinking).
 */
async function handleExportCommand(deps: CommandDeps): Promise<void> {
    const { toast, logger, currentSession, currentMessages, host } = deps;

    if (!currentSession) {
        toast.show(msg('没有活动的会话'), 'error');
        return;
    }

    // Filter out streaming (incomplete) messages — they have partial content
    const allMessages = (currentMessages ?? []).filter(m => !m.streaming);
    if (allMessages.length === 0) {
        toast.show(msg('当前会话没有消息'), 'error');
        return;
    }

    // Show export options dialog
    if (!host) {
        logger.error('Cannot show export dialog: host is not available');
        return;
    }

    const options = await showExportDialog(allMessages.length, host);
    if (!options) {
        // User cancelled
        return;
    }

    // Apply filters based on options
    const messages = applyExportOptions(allMessages, options);
    if (messages.length === 0) {
        toast.show(msg('没有符合条件的消息'), 'error');
        return;
    }

    try {
        await exportSession(currentSession, messages);
        toast.show(msg('导出成功'), 'success');
    } catch (err) {
        logger.error('/export failed:', err);
        toast.show(msg('导出失败'), 'error');
    }
}

/**
 * Apply export options to filter and limit messages.
 *
 * - If limit > 0, take the most recent `limit` messages
 * - If includeToolCalls is false, filter out toolcall_input and toolcall_output
 * - If includeThinking is false, filter out thinking messages
 */
function applyExportOptions(messages: Message[], options: ExportOptions): Message[] {
    let result = messages;

    // Filter by content type
    if (!options.includeToolCalls) {
        result = result.filter(m =>
            m.content.type !== 'toolcall_input' && m.content.type !== 'toolcall_output'
        );
    }
    if (!options.includeThinking) {
        result = result.filter(m => m.content.type !== 'thinking');
    }

    // Apply limit (0 = all, otherwise take the most recent N)
    if (options.limit > 0 && options.limit < result.length) {
        result = result.slice(-options.limit);
    }

    return result;
}
