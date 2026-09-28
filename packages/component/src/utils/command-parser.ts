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
    /** Whether the input is a command */
    isCommand: boolean;
    /** Command name (without the '/' prefix) */
    name?: string;
    /** Command arguments (remaining content after command name, trimmed) */
    args?: string;
}

/**
 * Parse user input to determine if it's a slash command
 *
 * Parsing rules:
 * 1. Input must start with '/'
 * 2. There must be at least one non-whitespace character after '/' as the command name
 * 3. The command name consists of consecutive non-whitespace characters (up to the first space)
 * 4. Content after the command name is treated as arguments (passed after trimming)
 */
export function parseCommand(input: string): ParsedCommand {
    const trimmed = input.trim();

    // Must start with '/'
    if (!trimmed.startsWith('/')) {
        return { isCommand: false };
    }

    // Remove '/' prefix
    const withoutSlash = trimmed.slice(1);

    // There must be content after '/'
    if (withoutSlash.length === 0) {
        return { isCommand: false };
    }

    // Split command name and arguments
    const spaceIndex = withoutSlash.search(/\s/);

    if (spaceIndex === -1) {
        // No arguments, the entire input is the command name
        return {
            isCommand: true,
            name: withoutSlash.toLowerCase(),
        };
    }

    const name = withoutSlash.slice(0, spaceIndex).toLowerCase();
    const args = withoutSlash.slice(spaceIndex).trim();

    // Command name cannot be empty
    if (name.length === 0) {
        return { isCommand: false };
    }

    return {
        isCommand: true,
        name,
        args: args || undefined,
    };
}
