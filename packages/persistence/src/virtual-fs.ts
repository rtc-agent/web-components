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
 * - * matches any character (not /)
 * - ? matches a single character
 *
 * Does not support:
 * - ** recursive matching (v1 limitation, TODO: support in future version)
 *
 * Note: `/` inside RegExp character classes must be escaped as `\/`, otherwise some engines
 * (e.g. older Safari) interpret the `/` in `[^/]` as the end of the regex literal, causing
 * `*` to incorrectly match the path separator and break directory boundary isolation.
 * RegExp metacharacters like `+` must also be escaped to avoid `a+b` being interpreted as
 * "one or more a followed by b".
 */
export function matchGlob(pattern: string, path: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\/+]/g, '\\$&')
    .replace(/\*/g, '[^\\/]*')
    .replace(/\?/g, '[^\\/]');

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
   * @param offset Starting position (character position, not byte)
   * @param limit Maximum number of characters to read
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
      const start = offset || 0;
      const end = limit !== undefined ? start + limit : undefined;
      content = content.substring(start, end);
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
   * @param maxResults Maximum result count (default: 100, prevents performance issues from large file scans)
   * @returns Matching result list
   */
  async grep(
    pattern: string,
    path: string = '/',
    caseSensitive: boolean = false,
    maxResults: number = 100
  ): Promise<Array<{ file: string; line: string; lineNumber: number }>> {
    const normalizedPath = normalizePath(path);
    log.debug('grep: pattern:', pattern, 'path:', normalizedPath, 'caseSensitive:', caseSensitive);
    const db = getDatabase();

    let regex: RegExp;
    try {
      const flags = caseSensitive ? '' : 'i';
      regex = new RegExp(pattern, flags);
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

    const results: Array<{ file: string; line: string; lineNumber: number }> = [];

    for (const entry of entries) {
      const lines = entry.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex.test(line)) {
          results.push({
            file: entry.path,
            line: line,
            lineNumber: i + 1,
          });
          // Early termination to prevent unbounded scans on large datasets
          if (results.length >= maxResults) {
            return results;
          }
        }
      }
    }

    return results;
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
