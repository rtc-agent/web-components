/**
 * Command Parser
 *
 * Parses slash commands from user input.
 * Format: /command_name [args...]
 *
 * Examples:
 *   "/compact"              → { isCommand: true, name: "compact" }
 *   "/compact summarize"    → { isCommand: true, name: "compact", args: "summarize" }
 *   "/compact 请总结对话"    → { isCommand: true, name: "compact", args: "请总结对话" }
 *   "hello world"           → { isCommand: false }
 *   "/"                     → { isCommand: false }
 *   "/ "                    → { isCommand: false }
 */

export interface ParsedCommand {
    /** 是否为命令输入 */
    isCommand: boolean;
    /** 命令名称（不含 '/' 前缀） */
    name?: string;
    /** 命令参数（命令名后的剩余内容，已 trim） */
    args?: string;
}

/**
 * 解析用户输入，判断是否为 slash 命令
 *
 * 解析规则：
 * 1. 输入必须以 '/' 开头
 * 2. '/' 后必须有至少一个非空白字符作为命令名
 * 3. 命令名由连续的非空白字符组成（到第一个空格为止）
 * 4. 命令名后的内容作为参数（trim 后传入）
 */
export function parseCommand(input: string): ParsedCommand {
    const trimmed = input.trim();

    // 必须以 '/' 开头
    if (!trimmed.startsWith('/')) {
        return { isCommand: false };
    }

    // 去掉 '/' 前缀
    const withoutSlash = trimmed.slice(1);

    // '/' 后必须有内容
    if (withoutSlash.length === 0) {
        return { isCommand: false };
    }

    // 分割命令名和参数
    const spaceIndex = withoutSlash.search(/\s/);

    if (spaceIndex === -1) {
        // 没有参数，整个输入就是命令名
        return {
            isCommand: true,
            name: withoutSlash.toLowerCase(),
        };
    }

    const name = withoutSlash.slice(0, spaceIndex).toLowerCase();
    const args = withoutSlash.slice(spaceIndex).trim();

    // 命令名不能为空
    if (name.length === 0) {
        return { isCommand: false };
    }

    return {
        isCommand: true,
        name,
        args: args || undefined,
    };
}
