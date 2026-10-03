/**
 * Slash command dispatch for <rtc-agent>.
 *
 * Extracted from rtc-agent.ts to keep the root component lean.
 * Each command is a pure async function that takes its dependencies explicitly.
 *
 * ## Command Registration
 *
 * Commands are registered in a registry pattern, making it easy to add new commands
 * without modifying the core dispatch logic. Built-in commands (compact, export) are
 * registered at module load time.
 *
 * To add a new command:
 * ```ts
 * import { registerCommand } from './command-handler.js';
 *
 * registerCommand('mycommand', async (args, deps) => {
 *   // Command implementation
 * });
 * ```
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

// ── Command Registry ──

/**
 * Command handler function signature
 */
export type CommandHandler = (
    args: string | undefined,
    deps: CommandDeps
) => Promise<void>;

/**
 * Command registry - maps command names to their handlers
 */
const commandRegistry = new Map<string, CommandHandler>();

/**
 * Register a new slash command
 *
 * @param name - Command name (without the leading slash)
 * @param handler - Async function to execute when the command is invoked
 *
 * @example
 * ```ts
 * registerCommand('hello', async (args, deps) => {
 *   deps.toast.show(`Hello ${args ?? 'World'}!`, 'info');
 * });
 * ```
 */
export function registerCommand(name: string, handler: CommandHandler): void {
    if (commandRegistry.has(name)) {
        console.warn(`[CommandHandler] Command '/${name}' is already registered. Overwriting.`);
    }
    commandRegistry.set(name, handler);
}

/**
 * Unregister a slash command
 */
export function unregisterCommand(name: string): boolean {
    return commandRegistry.delete(name);
}

/**
 * Get all registered command names
 */
export function getRegisteredCommands(): string[] {
    return Array.from(commandRegistry.keys());
}

// ── Public API ──

/**
 * Handle slash commands dispatched from the input area.
 *
 * Currently supported:
 * - /compact [custom_instruction]: compress current session context
 * - /export: export current session to HTML file
 *
 * New commands can be registered via `registerCommand()`.
 */
export async function handleCommand(
    name: string,
    args: string | undefined,
    deps: CommandDeps,
): Promise<void> {
    const handler = commandRegistry.get(name);
    if (handler) {
        await handler(args, deps);
    } else {
        deps.toast.show(msg(str`未知命令: /${name}`), "error");
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

// ── Built-in Commands Registration ──

/**
 * Register built-in commands at module load time
 */
registerCommand('compact', async (args, deps) => {
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
        await persistenceLayer.compactSession(currentSessionId, args);
        // Success: don't show toast immediately, wait for Live push to update session.
    } catch (err) {
        logger.error("/compact failed:", err);
        const message = err instanceof Error ? err.message : msg("压缩上下文失败");
        toast.show(message, "error");
    }
});

registerCommand('export', async (_args, deps) => {
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
});
