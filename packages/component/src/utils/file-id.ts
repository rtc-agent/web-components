/**
 * File ID utility functions
 *
 * Shared utilities for parsing and manipulating file identifiers.
 */

/**
 * Parse a fileid into md5 and extension.
 *
 * @param fileid - File identifier in format "md5.ext"
 * @returns Object with md5 and ext properties
 * @throws Error if fileid format is invalid
 *
 * @example
 * ```typescript
 * const { md5, ext } = parseFileId('abc123def456.png');
 * // { md5: 'abc123def456', ext: 'png' }
 * ```
 */
export function parseFileId(fileid: string): {md5: string; ext: string} {
  const lastDot = fileid.lastIndexOf('.');
  if (lastDot === -1) {
    throw new Error(`Invalid fileid format: ${fileid}`);
  }
  return {
    md5: fileid.slice(0, lastDot),
    ext: fileid.slice(lastDot + 1),
  };
}
