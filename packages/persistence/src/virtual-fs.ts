/**
 * Virtual File System
 *
 * IndexedDB-based virtual file system providing file operation APIs for LLM.
 *
 * Design highlights:
 * - Path normalization: unified absolute paths, .. traversal is forbidden
 * - Auto directory creation: parent directories are auto-created on write (logical directories, not stored)
 * - Index support: queries accelerated via IndexedDB indexes
 * - Class-based structure (rather than module-level functions): facilitates injecting different
 *   database instances or configurations in the future
 */

import { getDatabase, type FileSystemEntry, type FileSystemEntryType, type FileSystemEntryMetadata } from './database.js';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('VirtualFS');

/**
 * Path-related error.
 */
export class PathError extends Error {
  constructor(
    public code: 'ENOENT' | 'EINVAL',
    message: string
  ) {
    super(message);
    this.name = 'PathError';
  }
}

/**
 * Normalize a path.
 *
 * - Convert to absolute path (add leading /)
 * - Remove redundant /
 * - Forbid .. path traversal
 * - Remove trailing / (except for root)
 */
export function normalizePath(path: string): string {
  if (!path || typeof path !== 'string') {
    throw new PathError('EINVAL', 'Path must be a non-empty string');
  }

  let normalized = path.startsWith('/') ? path : '/' + path;

  const segments = normalized.split('/').filter(s => s && s !== '.');

  for (const segment of segments) {
    if (segment === '..') {
      throw new PathError('EINVAL', 'Path traversal (..) is not allowed');
    }
  }

  normalized = '/' + segments.join('/');

  if (normalized === '/') {
    return '/';
  }

  return normalized.replace(/\/$/, '');
}

/**
 * Get the parent path.
 */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return '/';
  }
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === 0 ? '/' : normalized.substring(0, lastSlash);
}

/**
 * Get the file name (without path).
 */
export function getFileName(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return normalized.substring(lastSlash + 1);
}

/**
 * Check whether a path is a child of the specified directory.
 */
export function isChildPath(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);

  if (normalizedParent === '/') {
    return true;
  }

  return normalizedChild.startsWith(normalizedParent + '/');
}

/**
 * Simple glob pattern matching.
 *
 * Supports:
 * - * matches any character except /
 * - ** matches any character including / (recursive)
 * - ? matches a single character except /
 *
 * Note: `/` inside RegExp character classes must be escaped as `\/`, otherwise some engines
 * (e.g. older Safari) interpret the `/` in `[^/]` as the end of the regex literal, causing
 * `*` to incorrectly match the path separator and break directory boundary isolation.
 * RegExp metacharacters like `+` must also be escaped to avoid `a+b` being interpreted as
 * "one or more a followed by b".
 */
export function matchGlob(pattern: string, path: string): boolean {
  // First, handle ** (recursive matching) by replacing with a unique placeholder
  const DOUBLE_STAR_PLACEHOLDER = '\0DOUBLESTAR\0';
  const DOT_STAR_PLACEHOLDER = '\0DOTSTAR\0';
  let processed = pattern.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER);

  // Escape regex metacharacters (but not our placeholder)
  const regexStr = processed
    .replace(/[.+^${}()|[\]\\/+]/g, '\\$&')
    .replace(new RegExp(DOUBLE_STAR_PLACEHOLDER, 'g'), DOT_STAR_PLACEHOLDER)  // ** -> placeholder
    .replace(/\*/g, '[^\\/]*')   // * matches anything except /
    .replace(/\?/g, '[^\\/]')   // ? matches single char except /
    .replace(new RegExp(DOT_STAR_PLACEHOLDER, 'g'), '.*');  // finally replace with .*

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}

/**
 * Virtual file system.
 *
 * Uses class structure rather than module-level functions to facilitate injecting
 * different database instances or configurations in the future.
 */
export class VirtualFS {
  /**
   * Read file content.
   *
   * @param path File path
   * @param offset Starting line number (1-indexed). Only provide if the file is too large to read at once.
   * @param limit Maximum number of lines to read. Only provide if the file is too large to read at once.
   * @throws PathError ENOENT if file does not exist
   */
  async read(path: string, offset?: number, limit?: number): Promise<string> {
    const normalizedPath = normalizePath(path);
    log.debug('read:', normalizedPath, 'offset:', offset, 'limit:', limit);
    const db = getDatabase();

    const entry = await db.fileSystemEntries.get(normalizedPath);
    if (!entry) {
      log.debug('read: file not found:', normalizedPath);
      throw new PathError('ENOENT', `File not found: ${normalizedPath}`);
    }

    let content = entry.content;

    if (offset !== undefined || limit !== undefined) {
      const lines = content.split('\n');
      // offset is 1-indexed, convert to 0-indexed
      const startLine = offset !== undefined ? Math.max(0, offset - 1) : 0;
      const endLine = limit !== undefined ? startLine + limit : lines.length;
      content = lines.slice(startLine, endLine).join('\n');
    }

    log.debug('read: success, content length:', content.length);
    return content;
  }

  /**
   * Write a file.
   *
   * @param path File path
   * @param content File content
   * @param mode Write mode: overwrite, append, or create-new (skip if file exists)
   * @param metadataOverride Optional partial metadata override
   * @returns Total character count of the file after write; in create-new mode returns existing file length if file already exists
   */
  async write(
    path: string,
    content: string,
    mode: 'overwrite' | 'append' | 'create-new' = 'overwrite',
    metadataOverride?: Partial<FileSystemEntryMetadata>
  ): Promise<number> {
    const normalizedPath = normalizePath(path);
    log.debug('write:', normalizedPath, 'mode:', mode, 'content length:', content.length);
    const db = getDatabase();

    const type = this.inferFileType(normalizedPath);
    const existing = await db.fileSystemEntries.get(normalizedPath);

    // create-new mode: skip write if file already exists
    if (mode === 'create-new' && existing) {
      log.debug('write: file already exists in create-new mode, skipping:', normalizedPath);
      return existing.content.length;
    }

    let finalContent = content;
    let metadata: FileSystemEntryMetadata;

    if (existing && mode === 'append') {
      finalContent = existing.content + content;
      metadata = {
        ...existing.metadata,
        ...metadataOverride,
        updatedAt: new Date(),
      };
    } else {
      const now = new Date();
      metadata = {
        name: getFileName(normalizedPath),
        description: '',
        createdAt: existing?.metadata.createdAt || now,
        updatedAt: now,
        ...metadataOverride,
      };

      if (type === 'function') {
        const group = this.extractGroupFromPath(normalizedPath);
        if (group) {
          metadata.group = group;
        }
      }
    }

    const entry: FileSystemEntry = {
      path: normalizedPath,
      type,
      content: finalContent,
      metadata,
    };

    await db.fileSystemEntries.put(entry);
    log.debug('write: success, final content length:', finalContent.length);
    return finalContent.length;
  }

  /**
   * List directory contents.
   *
   * @param path Directory path (default: root)
   * @returns File name list (without full paths)
   */
  async ls(path: string = '/'): Promise<string[]> {
    const normalizedPath = normalizePath(path);
    log.debug('ls:', normalizedPath);
    const db = getDatabase();

    const children = new Set<string>();

    if (normalizedPath === '/') {
      const allEntries = await db.fileSystemEntries.toArray();
      for (const entry of allEntries) {
        const parts = entry.path.split('/').filter(Boolean);
        if (parts.length > 0) {
          children.add(parts[0]);
        }
      }
    } else {
      const prefix = normalizedPath + '/';
      const entries = await db.fileSystemEntries
        .filter(entry => entry.path.startsWith(prefix))
        .toArray();

      for (const entry of entries) {
        const remaining = entry.path.substring(prefix.length);
        const parts = remaining.split('/');
        if (parts.length > 0) {
          children.add(parts[0]);
        }
      }
    }

    return Array.from(children).sort();
  }

  /**
   * Search by file name pattern.
   *
   * @param pattern Glob pattern (supports * and ?)
   * @param path Search scope (default: root)
   * @returns Matching file path list
   */
  async find(pattern: string, path: string = '/'): Promise<string[]> {
    const normalizedPath = normalizePath(path);
    log.debug('find: pattern:', pattern, 'path:', normalizedPath);
    const db = getDatabase();

    let entries: FileSystemEntry[];

    if (normalizedPath === '/') {
      entries = await db.fileSystemEntries.toArray();
    } else {
      const prefix = normalizedPath + '/';
      entries = await db.fileSystemEntries
        .filter(entry => entry.path.startsWith(prefix))
        .toArray();
    }

    const matches: string[] = [];

    for (const entry of entries) {
      const relativePath = normalizedPath === '/'
        ? entry.path.substring(1)
        : entry.path.substring(normalizedPath.length + 1);

      if (matchGlob(pattern, relativePath) || matchGlob(pattern, entry.path)) {
        matches.push(entry.path);
      }
    }

    return matches.sort();
  }

  /**
   * Search by content.
   *
   * @param pattern Regular expression
   * @param path Search scope (default: root)
   * @param caseSensitive Whether case-sensitive (default: false)
   * @param maxResults Maximum result count (default: 250, prevents performance issues from large file scans)
   * @param offset Skip first N results (default: 0)
   * @param contextBefore Lines of context before each match (default: 0)
   * @param contextAfter Lines of context after each match (default: 0)
   * @param showLineNumbers Show line numbers in output (default: true)
   * @param outputMode Output mode: content, files_with_matches, count (default: files_with_matches)
   * @param multiline Enable multiline matching (default: false)
   * @param glob Glob pattern to filter files
   * @param type File type to search
   * @returns Search results based on output mode
   */
  async grep(
    pattern: string,
    path: string = '/',
    caseSensitive: boolean = false,
    maxResults: number = 250,
    offset: number = 0,
    contextBefore: number = 0,
    contextAfter: number = 0,
    showLineNumbers: boolean = true,
    outputMode: 'content' | 'files_with_matches' | 'count' = 'files_with_matches',
    multiline: boolean = false,
    glob?: string,
    type?: string
  ): Promise<any> {
    const normalizedPath = normalizePath(path);
    log.debug('grep: pattern:', pattern, 'path:', normalizedPath, 'caseSensitive:', caseSensitive, 'outputMode:', outputMode);
    const db = getDatabase();

    let regex: RegExp;
    try {
      const flags = caseSensitive ? '' : 'i';
      const regexPattern = multiline ? pattern.replace(/\./g, '[\\s\\S]') : pattern;
      regex = new RegExp(regexPattern, flags + (multiline ? 'm' : ''));
    } catch (err) {
      log.warn('grep: invalid regex pattern:', pattern, err);
      throw new SyntaxError(`Invalid regex pattern: ${pattern}`);
    }

    let entries: FileSystemEntry[];

    if (normalizedPath === '/') {
      entries = await db.fileSystemEntries.toArray();
    } else {
      const prefix = normalizedPath + '/';
      entries = await db.fileSystemEntries
        .filter(entry => entry.path.startsWith(prefix))
        .toArray();
    }

    // Filter by type if specified
    if (type) {
      entries = entries.filter(entry => {
        const ext = entry.path.split('.').pop()?.toLowerCase();
        return ext === type.toLowerCase();
      });
    }

    // Filter by glob pattern if specified
    if (glob) {
      entries = entries.filter(entry => {
        const filename = entry.path.split('/').pop() || '';
        const relativePath = normalizedPath === '/'
          ? entry.path.substring(1)
          : entry.path.substring(normalizedPath.length + 1);
        return matchGlob(glob, filename) || matchGlob(glob, relativePath) || matchGlob(glob, entry.path);
      });
    }

    // Exclude VCS directories
    const vcsDirs = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'];
    entries = entries.filter(entry => {
      const pathParts = entry.path.split('/');
      return !pathParts.some(part => vcsDirs.includes(part));
    });

    if (outputMode === 'files_with_matches') {
      // Return list of matching file paths
      const matchedFiles: string[] = [];

      for (const entry of entries) {
        if (regex.test(entry.content)) {
          matchedFiles.push(entry.path);
        }
      }

      // Apply offset and limit
      const limitedFiles = matchedFiles.slice(offset, offset + (maxResults || matchedFiles.length));

      return {
        mode: 'files_with_matches',
        filenames: limitedFiles,
        numFiles: limitedFiles.length,
        appliedLimit: maxResults && matchedFiles.length - offset > maxResults ? maxResults : undefined,
        appliedOffset: offset > 0 ? offset : undefined,
      };
    }

    if (outputMode === 'count') {
      // Return match counts per file
      const countResults: Array<{ file: string; count: number }> = [];
      let totalMatches = 0;

      for (const entry of entries) {
        const matches = entry.content.match(regex);
        const count = matches ? matches.length : 0;
        if (count > 0) {
          countResults.push({ file: entry.path, count });
          totalMatches += count;
        }
      }

      // Apply offset and limit
      const limitedResults = countResults.slice(offset, offset + (maxResults || countResults.length));

      return {
        mode: 'count',
        content: limitedResults.map(r => `${r.file}:${r.count}`).join('\n'),
        numFiles: limitedResults.length,
        numMatches: totalMatches,
        appliedLimit: maxResults && countResults.length - offset > maxResults ? maxResults : undefined,
        appliedOffset: offset > 0 ? offset : undefined,
      };
    }

    // outputMode === 'content'
    const contentResults: Array<{ file: string; lineNumber: number; line: string }> = [];

    for (const entry of entries) {
      const lines = entry.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex.test(line)) {
          // Add context lines
          const startLine = Math.max(0, i - contextBefore);
          const endLine = Math.min(lines.length - 1, i + contextAfter);

          for (let j = startLine; j <= endLine; j++) {
            contentResults.push({
              file: entry.path,
              lineNumber: j + 1,
              line: lines[j],
            });
          }
        }
      }
    }

    // Apply offset and limit
    const limitedResults = contentResults.slice(offset, offset + (maxResults || contentResults.length));

    // Format output
    const formattedLines = limitedResults.map(r => {
      const lineNum = showLineNumbers ? `${r.lineNumber}:` : '';
      return `${r.file}:${lineNum}${r.line}`;
    });

    return {
      mode: 'content',
      content: formattedLines.join('\n'),
      numLines: formattedLines.length,
      filenames: [],
      numFiles: 0,
      appliedLimit: maxResults && contentResults.length - offset > maxResults ? maxResults : undefined,
      appliedOffset: offset > 0 ? offset : undefined,
    };
  }

  /**
   * Query files by type.
   *
   * @param type File type
   * @returns File entry list
   */
  async queryByType(type: FileSystemEntryType): Promise<FileSystemEntry[]> {
    const db = getDatabase();
    return db.fileSystemEntries.where('type').equals(type).toArray();
  }

  /**
   * Edit a file by exact string replacement.
   *
   * @param path File path
   * @param oldString The text to replace
   * @param newString The text to replace it with
   * @param replaceAll Replace all occurrences (default: false)
   * @throws PathError ENOENT if file does not exist
   * @throws Error if oldString is not found, matches multiple times (with replaceAll=false),
   *         or oldString equals newString
   */
  async edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll: boolean = false
  ): Promise<{ replaced: number }> {
    const normalizedPath = normalizePath(path);
    log.debug('edit:', normalizedPath, 'replaceAll:', replaceAll);
    const db = getDatabase();

    if (oldString === '') {
      throw new Error('old_string must not be empty');
    }

    if (oldString === newString) {
      throw new Error('No changes to make: old_string and new_string are exactly the same');
    }

    const entry = await db.fileSystemEntries.get(normalizedPath);
    if (!entry) {
      throw new PathError('ENOENT', `File not found: ${normalizedPath}`);
    }

    const content = entry.content;

    // Count matches
    let matchCount = 0;
    let idx = 0;
    while (true) {
      const pos = content.indexOf(oldString, idx);
      if (pos === -1) break;
      matchCount++;
      idx = pos + oldString.length;
    }

    if (matchCount === 0) {
      throw new Error(`String to replace not found in file.\nString: ${oldString}`);
    }

    if (matchCount > 1 && !replaceAll) {
      throw new Error(
        `Found ${matchCount} matches of the string to replace, but replace_all is false. ` +
        `Either provide more context to make the match unique, or set replace_all to true.`
      );
    }

    // Perform replacement
    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    // Write back
    const metadata: FileSystemEntryMetadata = {
      ...entry.metadata,
      updatedAt: new Date(),
    };

    await db.fileSystemEntries.put({
      ...entry,
      content: newContent,
      metadata,
    });

    log.debug('edit: success, replaced:', replaceAll ? matchCount : 1);
    return { replaced: replaceAll ? matchCount : 1 };
  }

  /**
   * Check if a file exists.
   */
  async exists(path: string): Promise<boolean> {
    const normalizedPath = normalizePath(path);
    const db = getDatabase();
    const entry = await db.fileSystemEntries.get(normalizedPath);
    return entry !== undefined;
  }

  /**
   * Delete a file.
   */
  async remove(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    log.debug('remove:', normalizedPath);
    const db = getDatabase();

    const exists = await this.exists(normalizedPath);
    if (!exists) {
      log.debug('remove: file not found:', normalizedPath);
      throw new PathError('ENOENT', `File not found: ${normalizedPath}`);
    }

    await db.fileSystemEntries.delete(normalizedPath);
    log.debug('remove: success:', normalizedPath);
  }

  /**
   * Infer file type from path.
   *
   * Determines file purpose based on path prefix, used for indexing and queries.
   * Defaults to 'index' as the generic document type.
   */
  private inferFileType(path: string): FileSystemEntryType {
    if (path.startsWith('/functions/')) {
      return 'function';
    }
    if (path.startsWith('/scenarios/')) {
      return 'scenario';
    }
    if (path.startsWith('/scripts/')) {
      return 'script';
    }
    // INDEX.md and AGENT.md are index files
    if (path.endsWith('/INDEX.md') || path === '/AGENT.md') {
      return 'index';
    }
    // Other Markdown or text files are classified as index (generic documents)
    return 'index';
  }

  /**
   * Extract group name from path.
   *
   * Example: /functions/user/register.md -> 'user'
   */
  private extractGroupFromPath(path: string): string | undefined {
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'functions') {
      return parts[1];
    }
    return undefined;
  }
}

/**
 * Global VirtualFS singleton instance.
 */
export const virtualFS = new VirtualFS();
