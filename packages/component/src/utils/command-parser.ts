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
  /** Validation error message if command is invalid */
  error?: string;
  /** Suggested command names if input is ambiguous (for autocomplete) */
  suggestions?: string[];
}

/**
 * Validate command name format
 *
 * Rules:
 * - Must be 1-64 characters
 * - Only allows lowercase letters, numbers, hyphens, underscores
 * - Cannot start or end with hyphen/underscore
 * - Cannot contain consecutive hyphens/underscores
 *
 * @param name - Command name to validate
 * @returns Error message if invalid, undefined if valid
 */
export function validateCommandName(name: string): string | undefined {
  if (!name || name.length === 0) {
    return 'Command name cannot be empty';
  }

  if (name.length > 64) {
    return 'Command name cannot exceed 64 characters';
  }

  // Check for valid characters (lowercase letters, numbers, hyphens, underscores)
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return 'Command name can only contain lowercase letters, numbers, hyphens, and underscores';
  }

  // Check for leading/trailing hyphens or underscores
  if (/^[-_]|[-_]$/.test(name)) {
    return 'Command name cannot start or end with hyphen or underscore';
  }

  // Check for consecutive hyphens or underscores
  if (/[-_]{2,}/.test(name)) {
    return 'Command name cannot contain consecutive hyphens or underscores';
  }

  return undefined;
}

/**
 * Find similar command names for autocomplete suggestions
 *
 * Uses simple prefix matching and Levenshtein-like similarity.
 *
 * @param input - Partial command name
 * @param availableCommands - List of available command names
 * @param maxSuggestions - Maximum number of suggestions (default: 5)
 * @returns Array of suggested command names
 */
export function findCommandSuggestions(
  input: string,
  availableCommands: string[],
  maxSuggestions: number = 5,
): string[] {
  if (!input || availableCommands.length === 0) return [];

  const normalizedInput = input.toLowerCase();

  // First: prefix matches (highest priority)
  const prefixMatches = availableCommands
    .filter((cmd) => cmd.toLowerCase().startsWith(normalizedInput))
    .slice(0, maxSuggestions);

  if (prefixMatches.length >= maxSuggestions) {
    return prefixMatches;
  }

  // Second: simple similarity (commands that contain the input)
  const containsMatches = availableCommands
    .filter((cmd) => {
      const normalizedCmd = cmd.toLowerCase();
      return (
        normalizedCmd.includes(normalizedInput) && !prefixMatches.includes(cmd)
      );
    })
    .slice(0, maxSuggestions - prefixMatches.length);

  return [...prefixMatches, ...containsMatches];
}

/**
 * Parse user input to determine if it's a slash command
 *
 * Parsing rules:
 * 1. Input must start with '/'
 * 2. There must be at least one non-whitespace character after '/' as the command name
 * 3. The command name consists of consecutive non-whitespace characters (up to the first space)
 * 4. Content after the command name is treated as arguments (passed after trimming)
 *
 * @param input - User input string
 * @param availableCommands - Optional list of available commands for validation and suggestions
 * @returns Parsed command object
 */
export function parseCommand(
  input: string,
  availableCommands?: string[],
): ParsedCommand {
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
    const name = withoutSlash.toLowerCase();

    // Validate command name if we have available commands
    if (availableCommands?.length) {
      const validationError = validateCommandName(name);
      if (validationError) {
        return {
          isCommand: true,
          name,
          error: validationError,
          suggestions: findCommandSuggestions(name, availableCommands),
        };
      }

      // Check if command exists
      if (!availableCommands.includes(name)) {
        return {
          isCommand: true,
          name,
          error: `Unknown command: ${name}`,
          suggestions: findCommandSuggestions(name, availableCommands),
        };
      }
    }

    return {
      isCommand: true,
      name,
    };
  }

  const name = withoutSlash.slice(0, spaceIndex).toLowerCase();
  const args = withoutSlash.slice(spaceIndex).trim();

  // Command name cannot be empty
  if (name.length === 0) {
    return { isCommand: false };
  }

  // Validate command name if we have available commands
  if (availableCommands?.length) {
    const validationError = validateCommandName(name);
    if (validationError) {
      return {
        isCommand: true,
        name,
        args: args || undefined,
        error: validationError,
        suggestions: findCommandSuggestions(name, availableCommands),
      };
    }

    // Check if command exists
    if (!availableCommands.includes(name)) {
      return {
        isCommand: true,
        name,
        args: args || undefined,
        error: `Unknown command: ${name}`,
        suggestions: findCommandSuggestions(name, availableCommands),
      };
    }
  }

  return {
    isCommand: true,
    name,
    args: args || undefined,
  };
}
