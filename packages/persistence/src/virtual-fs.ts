/**
 * Virtual File System
 *
 * IndexedDB-based virtual file system providing file operation APIs for LLM.
 *
 * ## Relationship to FileCacheRepository
 *
 * VirtualFS and FileCacheRepository are intentionally independent systems with
 * no overlap in their data domains:
 *
 * | Aspect            | VirtualFS                        | FileCacheRepository                |
 * |-------------------|----------------------------------|------------------------------------|
 * | Purpose           | User-created structured content  | S3 downloaded binary file cache    |
 * | Content type      | Text (Markdown, scripts)         | Binary blobs (images, attachments) |
 * | Key scheme        | Semantic path (/functions/...)   | Content hash ([md5+ext])           |
 * | Lifecycle         | Persistent (user-managed)        | Ephemeral (TTL-based eviction)     |
 * | Sync model        | N/A (local-only)                 | Offline-first (pending/syncing/synced/failed) |
 *
 * VirtualFS NEVER stores the same file as FileCacheRepository. If a file exists in
 * both systems, it indicates a bug — the file type should determine which system owns it:
 * - User-created functions/scenarios/scripts/agent docs → VirtualFS
 * - Downloaded attachments/binary assets → FileCacheRepository
 *
 * Design highlights:
 * - Path normalization: unified absolute paths, .. traversal is forbidden
 * - Auto directory creation: parent directories are auto-created on write (logical directories, not stored)
 * - Index support: queries accelerated via IndexedDB indexes
 * - Class-based structure (rather than module-level functions): facilitates injecting different
 *   database instances or configurations in the future
 */

import {
  getDatabase,
  type FileSystemEntry,
  type FileSystemEntryType,
  type FileSystemEntryMetadata,
} from './database.js';
import { createLogger } from '@rtc-agent/protocol';
import type Dexie from 'dexie';
import { LifecycleGuard } from './lifecycle-guard.js';

const log = createLogger('VirtualFS');

// C3-FIX: File size limit to prevent abuse and memory issues
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Path-related error.
 */
export class PathError extends Error {
  constructor(
    public code: 'ENOENT' | 'EINVAL',
    message: string,
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
 *
 * Case sensitivity: Paths are case-sensitive, matching Linux filesystem behavior.
 * This is intentional for consistency with server-side file systems. If case-insensitive
 * behavior is needed (e.g., for macOS/Windows clients), it should be handled at the API
 * layer or via a configuration option, not in the core path normalization.
 */
export function normalizePath(path: string): string {
  if (!path || typeof path !== 'string') {
    throw new PathError(
      'EINVAL',
      `Path must be a non-empty string, got: ${JSON.stringify(path)}`,
    );
  }

  let normalized = path.startsWith('/') ? path : '/' + path;

  const segments = normalized.split('/').filter((s) => s && s !== '.');

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
    .replace(new RegExp(DOUBLE_STAR_PLACEHOLDER, 'g'), DOT_STAR_PLACEHOLDER) // ** -> placeholder
    .replace(/\*/g, '[^\\/]*') // * matches anything except /
    .replace(/\?/g, '[^\\/]') // ? matches single char except /
    .replace(new RegExp(DOT_STAR_PLACEHOLDER, 'g'), '.*'); // finally replace with .*

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}

/**
 * Result of a grep operation.
 */
export interface GrepResult {
  /** Output mode */
  mode: 'files_with_matches' | 'content' | 'count';
  /** Formatted content string (for 'content' and 'count' modes) */
  content?: string;
  /** Matching file paths (for 'files_with_matches' mode) */
  filenames?: string[];
  /** Number of matching files */
  numFiles: number;
  /** Number of matching lines (for 'content' mode) */
  numLines?: number;
  /** Total match count (for 'count' mode) */
  numMatches?: number;
  /** Whether a limit was applied */
  appliedLimit?: number;
  /** Whether an offset was applied */
  appliedOffset?: number;
  /** Files skipped due to size limit (>10MB) */
  skippedFiles?: string[];
}

/**
 * Virtual file system.
 *
 * Uses class structure rather than module-level functions to facilitate injecting
 * different database instances or configurations in the future.
 */
export class VirtualFS {
  /**
   * P0-FIX: LifecycleGuard to prevent operations on closed database.
   * All DB operations must call assertActive() before proceeding.
   */
  private _lifecycleGuard = new LifecycleGuard('VirtualFS');

  /**
   * P0-FIX: Per-file write locks to prevent TOCTOU race conditions.
   * Uses promise chaining to queue concurrent writes to the same file.
   * Key: normalized file path, Value: promise chain for sequential writes.
   */
  private _writeLocks = new Map<string, Promise<unknown>>();

  /**
   * P0-FIX: Execute an async operation with a file-level write lock.
   *
   * Ensures that concurrent writes to the same file are serialized,
   * preventing TOCTOU (Time-Of-Check-Time-Of-Use) race conditions where
   * a second write could overwrite changes made by a first write that
   * was still in progress.
   *
   * Uses promise chaining (not mutex) so operations queue sequentially.
   * Each call for the same path waits for the previous operation to settle
   * before starting its own. Different files run in parallel.
   *
   * Cleanup: the map entry is deleted in the `finally` block when the current
   * promise is still the head of the chain (i.e., no subsequent operation has
   * been queued after it). This avoids unbounded map growth while remaining
   * safe under concurrent access.
   *
   * @param path Normalized file path
   * @param fn Async function to execute under the lock
   * @param timeoutMs Optional timeout in milliseconds (default: 30000). Throws if lock not acquired.
   * @returns Result of the fn operation
   * @throws Error if lock acquisition times out
   */
  private async withFileLock<T>(
    path: string,
    fn: () => Promise<T>,
    timeoutMs: number = 30000,
  ): Promise<T> {
    const prev = this._writeLocks.get(path) ?? Promise.resolve();

    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`File lock timeout: ${path} locked for >${timeoutMs}ms`)), timeoutMs);
    });

    // Chain the new operation after the previous one settles, with timeout
    const next = Promise.race([
      prev.then(
        () => fn(),
        () => fn(),
      ),
      timeoutPromise,
    ]);

    // Wrap so we can detect when this specific operation completes
    const settled = next.then(
      (v) => v,
      (e) => {
        throw e;
      },
    );

    this._writeLocks.set(
      path,
      settled
        .finally(() => {
          // Clean up map entry only when this operation is the current head of
          // the chain. If a subsequent operation has already been queued (i.e.,
          // the map entry has been updated to a newer promise), skip deletion.
          // This avoids the fragile isFirstInChain tracking from earlier versions.
          if (this._writeLocks.get(path) === settled) {
            this._writeLocks.delete(path);
          }
        })
        .catch(() => {
          // Error is already propagated to the caller via `next`.
          // This catch prevents unhandled rejection on the lock-tracking
          // branch (settled + finally), which is only used for cleanup.
        }),
    );

    return next;
  }
  /**
   * Read file content.
   *
   * @param path File path
   * @param offset Starting line number (1-indexed). Only provide if the file is too large to read at once.
   * @param limit Maximum number of lines to read. Only provide if the file is too large to read at once.
   * @throws PathError ENOENT if file does not exist
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async read(path: string, offset?: number, limit?: number): Promise<string> {
    this._lifecycleGuard.assertActive();
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
      // PERFORMANCE: For large files (>1MB), use a more memory-efficient line extraction.
      // Instead of splitting the entire content into an array, we find line boundaries
      // using indexOf and extract only the requested range.
      if (content.length > 1024 * 1024) {
        // Large file: use efficient line boundary detection
        content = this._extractLines(content, offset, limit);
      } else {
        // Small file: use simple split (faster for small content)
        const lines = content.split('\n');
        // offset is 1-indexed, convert to 0-indexed
        const startLine = offset !== undefined ? Math.max(0, offset - 1) : 0;
        const endLine = limit !== undefined ? startLine + limit : lines.length;
        content = lines.slice(startLine, endLine).join('\n');
      }
    }

    log.debug('read: success, content length:', content.length);
    return content;
  }

  /**
   * Extract specific lines from content without splitting into array.
   * PERFORMANCE: Memory-efficient for large files (>1MB).
   * Uses indexOf to find line boundaries instead of creating a large array.
   *
   * @param content Full file content
   * @param offset Starting line number (1-indexed, undefined = start from beginning)
   * @param limit Maximum number of lines to read (undefined = read to end)
   * @returns Extracted lines joined by newlines
   */
  private _extractLines(content: string, offset?: number, limit?: number): string {
    // offset is 1-indexed, convert to 0-indexed
    const startLine = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const endLine = limit !== undefined ? startLine + limit : Infinity;

    let result = '';
    let currentLine = 0;
    let lineStart = 0;
    let lineEnd = content.indexOf('\n');

    while (lineStart < content.length) {
      if (lineEnd === -1) {
        // Last line (no trailing newline)
        lineEnd = content.length;
      }

      if (currentLine >= startLine && currentLine < endLine) {
        // This line is in the requested range
        if (result.length > 0) {
          result += '\n';
        }
        result += content.substring(lineStart, lineEnd);
      } else if (currentLine >= endLine) {
        // Past the requested range, stop
        break;
      }

      currentLine++;
      lineStart = lineEnd + 1;
      lineEnd = content.indexOf('\n', lineStart);
    }

    return result;
  }

  /**
   * Write a file.
   *
   * P0-FIX: Now uses file-level write lock to prevent TOCTOU race conditions.
   * Concurrent writes to the same file are serialized via withFileLock().
   *
   * @param path File path
   * @param content File content
   * @param mode Write mode: overwrite, append, or create-new (skip if file exists)
   * @param metadataOverride Optional partial metadata override
   * @returns Total byte count of the file after write; in create-new mode returns existing file byte count if file already exists
   * @throws Error if content exceeds MAX_FILE_SIZE (10MB) or contains invalid characters
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async write(
    path: string,
    content: string,
    mode: 'overwrite' | 'append' | 'create-new' = 'overwrite',
    metadataOverride?: Partial<FileSystemEntryMetadata>,
  ): Promise<number> {
    this._lifecycleGuard.assertActive();
    // P1-FIX: Use TextEncoder to calculate actual byte size instead of character count.
    // For UTF-8 encoded content (especially CJK characters), byte size can be up to 3x character count.
    // This ensures accurate enforcement of the 10MB limit regardless of character encoding.
    // PERFORMANCE: Encode once and reuse the result to avoid redundant encoding.
    const contentBytes = new TextEncoder().encode(content);
    if (contentBytes.byteLength > MAX_FILE_SIZE) {
      throw new Error(
        `File content exceeds maximum size limit of ${MAX_FILE_SIZE} bytes (current: ${contentBytes.byteLength} bytes)`,
      );
    }

    // C3-FIX: Basic content validation - check for null bytes which could indicate corruption.
    //
    // PERFORMANCE NOTE: String.includes('\0') is O(n) but highly optimized in V8 (native memcmp).
    // For a 10MB string, this takes ~1-2ms — acceptable for a security validation.
    // Alternatives like TextEncoder.encode() + Uint8Array.includes() would require allocating
    // and copying 10MB+ of memory, which is actually slower and increases GC pressure.
    // We check ALL content (not just a prefix) because null bytes anywhere indicate corruption.
    if (content.includes('\0')) {
      throw new Error('File content contains null bytes, which is not allowed');
    }

    const normalizedPath = normalizePath(path);
    const db = getDatabase();

    const type = this.inferFileType(normalizedPath);

    // P0-FIX: Wrap entire operation in file lock to prevent TOCTOU race conditions.
    // Concurrent writes to the same file are now serialized.
    return this.withFileLock(normalizedPath, async () => {
      // Wrap read-modify-write in transaction to prevent race conditions
      return db.transaction(
        'rw',
        db.fileSystemEntries,
        async () => {
          const existing = await db.fileSystemEntries.get(normalizedPath);

          // create-new mode: skip write if file already exists
          if (mode === 'create-new' && existing) {
            return new TextEncoder().encode(existing.content).byteLength;
          }

          let finalContent = content;
          let finalByteLength = contentBytes.byteLength;
          let metadata: FileSystemEntryMetadata;

          if (existing && mode === 'append') {
            finalContent = existing.content + content;
            // P1-FIX: Validate combined content byte size for append mode
            finalByteLength = new TextEncoder().encode(finalContent).byteLength;
            if (finalByteLength > MAX_FILE_SIZE) {
              throw new Error(
                `Appended file content exceeds maximum size limit of ${MAX_FILE_SIZE} bytes (current: ${finalByteLength} bytes)`,
              );
            }
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
          // Return byte count, not character count (reuse pre-computed value)
          return finalByteLength;
        },
      );
    });
  }

  /**
   * Batch write multiple files in a single transaction.
   *
   * P0-FIX: Performance optimization for batchWriteFiles. Instead of calling write()
   * for each file (which acquires per-file locks and opens nested transactions),
   * this method performs all writes in a single transaction without per-file locking.
   *
   * P1-FIX: Now uses nested withFileLock calls to prevent concurrent write conflicts.
   * All files in the batch are locked before the transaction starts, ensuring atomicity
   * while preventing TOCTOU race conditions with concurrent single-file operations.
   *
   * Use cases: Initial agent.md setup, batch file synchronization. These are one-time
   * operations where concurrent writes to the same file are not expected, so per-file
   * locking is unnecessary overhead.
   *
   * Transaction behavior: Opens its own transaction, but if called within an existing
   * transaction (e.g., from batchWriteFiles), Dexie will reuse the outer transaction
   * (nested transaction support).
   *
   * @param files Array of file write operations
   * @throws Error if any file exceeds MAX_FILE_SIZE or contains null bytes
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async writeBatch(
    files: Array<{
      path: string;
      content: string;
      mode?: 'overwrite' | 'append' | 'create-new';
      metadataOverride?: Partial<FileSystemEntryMetadata>;
    }>,
  ): Promise<void> {
    this._lifecycleGuard.assertActive();
    // P1-FIX: Validate all files first using byte size (not character count)
    // to prevent abuse and memory issues with CJK content
    for (const file of files) {
      const contentBytes = new TextEncoder().encode(file.content).byteLength;
      if (contentBytes > MAX_FILE_SIZE) {
        throw new Error(
          `File content exceeds maximum size limit of ${MAX_FILE_SIZE} bytes ` +
            `(file: ${file.path}, current: ${contentBytes} bytes)`,
        );
      }
      if (file.content.includes('\0')) {
        throw new Error(
          `File content contains null bytes, which is not allowed: ${file.path}`,
        );
      }
    }

    const db = getDatabase();
    const normalizedPaths = files.map((f) => normalizePath(f.path));

    // P1-FIX: Use recursive nested locks to hold all file locks during the transaction.
    // Each path is locked before proceeding to the next, and all locks are held until
    // the transaction completes. This prevents concurrent write() operations from
    // interfering with the batch.
    const executeWithAllLocks = async (
      paths: string[],
      index: number,
    ): Promise<void> => {
      if (index >= paths.length) {
        // All locks acquired, execute the transaction
        await db.transaction('rw', db.fileSystemEntries, async () => {
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const normalizedPath = normalizedPaths[i];
            if (file === undefined || normalizedPath === undefined) continue;
            const existing = await db.fileSystemEntries.get(normalizedPath);
            const mode = file.mode || 'overwrite';

            // create-new mode: skip if file already exists
            if (mode === 'create-new' && existing) {
              continue;
            }

            let finalContent = file.content;
            let metadata: FileSystemEntryMetadata;
            const type = this.inferFileType(normalizedPath);

            if (existing && mode === 'append') {
              finalContent = existing.content + file.content;
              // P1-FIX: Validate combined content byte size for append mode
              const finalBytes = new TextEncoder().encode(finalContent).byteLength;
              if (finalBytes > MAX_FILE_SIZE) {
                throw new Error(
                  `Appended file content exceeds maximum size limit of ${MAX_FILE_SIZE} bytes ` +
                    `(file: ${file.path}, current: ${finalBytes} bytes)`,
                );
              }
              metadata = {
                ...existing.metadata,
                ...file.metadataOverride,
                updatedAt: new Date(),
              };
            } else {
              const now = new Date();
              metadata = {
                name: getFileName(normalizedPath),
                description: '',
                createdAt: existing?.metadata?.createdAt || now,
                updatedAt: now,
                ...file.metadataOverride,
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
          }
        });
        return;
      }

      // Acquire lock for current path, then recursively acquire remaining locks
      const currentPath = paths[index];
      if (currentPath === undefined) return; // Guard: index should be within bounds
      await this.withFileLock(currentPath, () =>
        executeWithAllLocks(paths, index + 1),
      );
    };

    await executeWithAllLocks(normalizedPaths, 0);
  }

  /**
   * List directory contents.
   *
   * @param path Directory path (default: root)
   * @returns File name list (without full paths)
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async ls(path: string = '/'): Promise<string[]> {
    this._lifecycleGuard.assertActive();
    const normalizedPath = normalizePath(path);
    log.debug('ls:', normalizedPath);
    const db = getDatabase();

    const children = new Set<string>();

    if (normalizedPath === '/') {
      // PERF: Use keys() to avoid loading full entry content (content can be large).
      // Only the primary key (path) is needed to extract top-level directory names.
      const allKeys = await db.fileSystemEntries.toCollection().keys();
      for (const key of allKeys) {
        const parts = (key as string).split('/').filter(Boolean);
        const firstPart = parts[0];
        if (firstPart !== undefined) {
          children.add(firstPart);
        }
      }
    } else {
      const prefix = normalizedPath + '/';
      // Use startsWith for efficient index-based query; keys() avoids loading content
      const keys = await db.fileSystemEntries
        .where('path')
        .startsWith(prefix)
        .keys();

      for (const key of keys) {
        const remaining = (key as string).substring(prefix.length);
        const parts = remaining.split('/');
        const firstPart = parts[0];
        if (firstPart !== undefined) {
          children.add(firstPart);
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
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async find(pattern: string, path: string = '/'): Promise<string[]> {
    this._lifecycleGuard.assertActive();
    const normalizedPath = normalizePath(path);
    log.debug('find: pattern:', pattern, 'path:', normalizedPath);
    const db = getDatabase();

    let paths: string[];

    if (normalizedPath === '/') {
      // PERF: Use keys() — only paths are needed for glob matching, not file content
      paths = (await db.fileSystemEntries.toCollection().keys()) as string[];
    } else {
      const prefix = normalizedPath + '/';
      // Use startsWith for efficient index-based query; keys() avoids loading content
      paths = (await db.fileSystemEntries
        .where('path')
        .startsWith(prefix)
        .keys()) as string[];
    }

    const matches: string[] = [];

    for (const p of paths) {
      const relativePath =
        normalizedPath === '/'
          ? p.substring(1)
          : p.substring(normalizedPath.length + 1);

      if (matchGlob(pattern, relativePath) || matchGlob(pattern, p)) {
        matches.push(p);
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
   * @throws LifecycleClosedError if the VirtualFS has been closed
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
    outputMode:
      | 'content'
      | 'files_with_matches'
      | 'count' = 'files_with_matches',
    multiline: boolean = false,
    glob?: string,
    type?: string,
  ): Promise<GrepResult> {
    this._lifecycleGuard.assertActive();
    const normalizedPath = normalizePath(path);
    log.debug(
      'grep: pattern:',
      pattern,
      'path:',
      normalizedPath,
      'caseSensitive:',
      caseSensitive,
      'outputMode:',
      outputMode,
    );
    const db = getDatabase();

    let regex: RegExp;
    try {
      // Always include 'g' flag for correct match counting and iteration.
      // Individual test() calls reset lastIndex explicitly to avoid state bugs.
      const flags = (caseSensitive ? '' : 'i') + 'g';
      const regexPattern = multiline
        ? pattern.replace(/\./g, '[\\s\\S]')
        : pattern;
      regex = new RegExp(regexPattern, flags + (multiline ? 'm' : ''));
    } catch (err) {
      log.warn('grep: invalid regex pattern:', pattern, err);
      throw new SyntaxError(`Invalid regex pattern: ${pattern}`);
    }

    // P1-FIX: Use cursor-based processing to avoid loading all entries into memory.
    // This prevents memory overflow when searching large file collections.
    const matchedFiles: string[] = [];
    // P0-FIX: Cache matched entries during initial scan to avoid re-reading from IndexedDB
    // in count/content modes. Without caching, each matched file would be loaded twice:
    // once during scan and once during result formatting, doubling I/O operations.
    const matchedEntries = new Map<string, FileSystemEntry>();
    const skippedFiles: string[] = []; // P1-FIX: Track files skipped due to size
    const vcsDirs = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'];

    // Build collection based on path scope
    let collection: Dexie.Collection<FileSystemEntry, unknown>;
    if (normalizedPath === '/') {
      collection = db.fileSystemEntries.toCollection();
    } else {
      const prefix = normalizedPath + '/';
      collection = db.fileSystemEntries.where('path').startsWith(prefix);
    }

    // P1-FIX: Process files using cursor (each) to avoid loading all into memory.
    // Files >10MB are skipped to prevent memory issues.
    const startTime = performance.now();
    let processedCount = 0;

    await collection.each((entry) => {
      processedCount++;

      // Exclude VCS directories
      const pathParts = entry.path.split('/');
      if (pathParts.some((part) => vcsDirs.includes(part))) {
        return;
      }

      // Filter by type if specified
      if (type) {
        const ext = entry.path.split('.').pop()?.toLowerCase();
        if (ext !== type.toLowerCase()) {
          return;
        }
      }

      // Filter by glob pattern if specified
      if (glob) {
        const filename = entry.path.split('/').pop() || '';
        const relativePath =
          normalizedPath === '/'
            ? entry.path.substring(1)
            : entry.path.substring(normalizedPath.length + 1);
        if (
          !matchGlob(glob, filename) &&
          !matchGlob(glob, relativePath) &&
          !matchGlob(glob, entry.path)
        ) {
          return;
        }
      }

      // P1-FIX: Skip files larger than 10MB to prevent memory overflow
      // Use byte size (not character count) for accurate size check
      const fileSizeBytes = new TextEncoder().encode(entry.content).byteLength;
      if (fileSizeBytes > MAX_FILE_SIZE) {
        skippedFiles.push(entry.path);
        log.warn(
          `grep: skipping large file (${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB):`,
          entry.path,
        );
        return;
      }

      // Reset lastIndex since regex has 'g' flag and test() maintains state
      regex.lastIndex = 0;
      if (regex.test(entry.content)) {
        matchedFiles.push(entry.path);
        // P0-FIX: Cache the matched entry to avoid re-reading from IndexedDB later
        matchedEntries.set(entry.path, entry);
      }
    });

    const elapsedMs = performance.now() - startTime;
    log.debug(
      `grep: scanned ${processedCount} files in ${elapsedMs.toFixed(2)}ms, ` +
      `${matchedFiles.length} matches, ${skippedFiles.length} skipped`,
    );

    if (outputMode === 'files_with_matches') {
      // Return list of matching file paths
      // Apply offset and limit
      const limitedFiles = matchedFiles.slice(
        offset,
        offset + (maxResults || matchedFiles.length),
      );

      return {
        mode: 'files_with_matches',
        filenames: limitedFiles,
        numFiles: limitedFiles.length,
        appliedLimit:
          maxResults && matchedFiles.length - offset > maxResults
            ? maxResults
            : undefined,
        appliedOffset: offset > 0 ? offset : undefined,
        skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
      };
    }

    if (outputMode === 'count') {
      // Return match counts per file
      const countResults: Array<{ file: string; count: number }> = [];
      let totalMatches = 0;

      // P0-FIX: Use cached entries from initial scan instead of re-reading from IndexedDB.
      // This eliminates redundant I/O operations that would double the load on IndexedDB.
      for (const filePath of matchedFiles) {
        const entry = matchedEntries.get(filePath);
        if (!entry) continue;

        const matches = entry.content.match(regex);
        const count = matches ? matches.length : 0;
        if (count > 0) {
          countResults.push({ file: entry.path, count });
          totalMatches += count;
        }
      }

      // Apply offset and limit
      const limitedResults = countResults.slice(
        offset,
        offset + (maxResults || countResults.length),
      );

      return {
        mode: 'count',
        content: limitedResults.map((r) => `${r.file}:${r.count}`).join('\n'),
        numFiles: limitedResults.length,
        numMatches: totalMatches,
        appliedLimit:
          maxResults && countResults.length - offset > maxResults
            ? maxResults
            : undefined,
        appliedOffset: offset > 0 ? offset : undefined,
        skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
      };
    }

    // outputMode === 'content'
    const contentResults: Array<{
      file: string;
      lineNumber: number;
      line: string;
    }> = [];

    // P0-FIX: Use cached entries from initial scan instead of re-reading from IndexedDB.
    // This eliminates redundant I/O operations that would double the load on IndexedDB.
    for (const filePath of matchedFiles) {
      const entry = matchedEntries.get(filePath);
      if (!entry) continue;

      // Multiline mode: match against full content, not line-by-line.
      // A multiline regex can span lines, so line-by-line testing would miss matches.
      // We find the match position, then determine which lines it covers.
      if (multiline) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(entry.content)) !== null) {
          // Determine line range of the match
          const beforeMatch = entry.content.substring(0, match.index);
          const startLine = beforeMatch.split('\n').length - 1; // 0-indexed
          const matchText = match[0];
          const endLine = startLine + matchText.split('\n').length - 1;

          const lines = entry.content.split('\n');
          const contextStart = Math.max(0, startLine - contextBefore);
          const contextEnd = Math.min(lines.length - 1, endLine + contextAfter);

          for (let j = contextStart; j <= contextEnd; j++) {
            const contextLine = lines[j];
            if (contextLine === undefined) continue;
            contentResults.push({
              file: entry.path,
              lineNumber: j + 1,
              line: contextLine,
            });
          }

          // Prevent infinite loop on zero-length matches
          if (match[0].length === 0) {
            regex.lastIndex++;
          }
        }
        continue;
      }

      // Non-multiline mode: line-by-line processing
      const lines = entry.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        // Reset lastIndex since regex has 'g' flag
        regex.lastIndex = 0;
        if (regex.test(line)) {
          // Add context lines
          const startLine = Math.max(0, i - contextBefore);
          const endLine = Math.min(lines.length - 1, i + contextAfter);

          for (let j = startLine; j <= endLine; j++) {
            const contextLine = lines[j];
            if (contextLine === undefined) continue;
            contentResults.push({
              file: entry.path,
              lineNumber: j + 1,
              line: contextLine,
            });
          }
        }
      }
    }

    // Apply offset and limit
    const limitedResults = contentResults.slice(
      offset,
      offset + (maxResults || contentResults.length),
    );

    // Format output
    const formattedLines = limitedResults.map((r) => {
      const lineNum = showLineNumbers ? `${r.lineNumber}:` : '';
      return `${r.file}:${lineNum}${r.line}`;
    });

    return {
      mode: 'content',
      content: formattedLines.join('\n'),
      numLines: formattedLines.length,
      filenames: [],
      numFiles: 0,
      appliedLimit:
        maxResults && contentResults.length - offset > maxResults
          ? maxResults
          : undefined,
      appliedOffset: offset > 0 ? offset : undefined,
      skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
    };
  }

  /**
   * Query files by type.
   *
   * @param type File type
   * @returns File entry list
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async queryByType(type: FileSystemEntryType): Promise<FileSystemEntry[]> {
    this._lifecycleGuard.assertActive();
    const db = getDatabase();
    return db.fileSystemEntries.where('type').equals(type).toArray();
  }

  /**
   * Edit a file by exact string replacement.
   *
   * P1-FIX: String processing is now done outside the transaction to minimize
   * transaction duration. Only the final write happens inside the transaction.
   * Uses file-level lock to prevent race conditions with concurrent edits.
   *
   * @param path File path
   * @param oldString The text to replace
   * @param newString The text to replace it with
   * @param replaceAll Replace all occurrences (default: false)
   * @throws PathError ENOENT if file does not exist
   * @throws Error if oldString is not found, matches multiple times (with replaceAll=false),
   *         or oldString equals newString
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async edit(
    path: string,
    oldString: string,
    newString: string,
    replaceAll: boolean = false,
  ): Promise<{ replaced: number }> {
    this._lifecycleGuard.assertActive();
    const normalizedPath = normalizePath(path);
    log.debug('edit:', normalizedPath, 'replaceAll:', replaceAll);
    const db = getDatabase();

    if (oldString === '') {
      throw new Error('old_string must not be empty');
    }

    if (oldString === newString) {
      throw new Error(
        'No changes to make: old_string and new_string are exactly the same',
      );
    }

    // P1-FIX: Use file-level lock to serialize concurrent edits to the same file.
    // This prevents TOCTOU race conditions while keeping transaction scope small.
    return this.withFileLock(normalizedPath, async () => {
      // Step 1: Read file content OUTSIDE transaction (but inside lock)
      const entry = await db.fileSystemEntries.get(normalizedPath);
      if (!entry) {
        throw new PathError('ENOENT', `File not found: ${normalizedPath}`);
      }

      const content = entry.content;

      // P1-FIX: Warn about large file edits to prevent memory issues.
      // Files >5MB may cause performance problems when processed in memory (split/join).
      const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB
      if (content.length > LARGE_FILE_THRESHOLD) {
        log.warn(
          `Editing large file (${(content.length / (1024 * 1024)).toFixed(2)}MB): ${normalizedPath}. ` +
            `String processing (split/join) happens in memory and may cause performance issues. ` +
            `Consider breaking the file into smaller chunks if possible.`,
        );
      }

      // Step 2: Perform string processing OUTSIDE transaction
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
        throw new Error(
          `String to replace not found in file.\nString: ${oldString}`,
        );
      }

      if (matchCount > 1 && !replaceAll) {
        throw new Error(
          `Found ${matchCount} matches of the string to replace, but replace_all is false. ` +
            `Either provide more context to make the match unique, or set replace_all to true.`,
        );
      }

      // Perform replacement
      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

      // Step 3: Write back INSIDE transaction (fast operation)
      await db.transaction('rw', db.fileSystemEntries, async () => {
        const metadata: FileSystemEntryMetadata = {
          ...entry.metadata,
          updatedAt: new Date(),
        };

        await db.fileSystemEntries.put({
          ...entry,
          content: newContent,
          metadata,
        });
      });

      log.debug('edit: success, replaced:', replaceAll ? matchCount : 1);
      return { replaced: replaceAll ? matchCount : 1 };
    });
  }

  /**
   * Check if a file exists.
   *
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async exists(path: string): Promise<boolean> {
    this._lifecycleGuard.assertActive();
    const normalizedPath = normalizePath(path);
    const db = getDatabase();
    const entry = await db.fileSystemEntries.get(normalizedPath);
    return entry !== undefined;
  }

  /**
   * Delete a file.
   *
   * CRITICAL FIX: Use transaction to prevent TOCTOU race condition where concurrent
   * write could create a file between the exists() check and delete() call.
   *
   * BEHAVIOR: This method is **non-idempotent** (strict mode). It throws ENOENT if the
   * file does not exist. This is intentional: it allows callers to distinguish between
   * "file was deleted" and "file never existed", which is important for LLM tool results
   * where the distinction matters for error reporting.
   *
   * If idempotent deletion is needed (delete-if-exists), use `removeIfExists()` instead.
   *
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async remove(path: string): Promise<void> {
    this._lifecycleGuard.assertActive();
    const normalizedPath = normalizePath(path);
    log.debug('remove:', normalizedPath);
    const db = getDatabase();

    // FIX: Perform existence check and delete within the same transaction
    await db.transaction(
      'rw',
      db.fileSystemEntries,
      async () => {
        const entry = await db.fileSystemEntries.get(normalizedPath);
        if (!entry) {
          log.debug('remove: file not found:', normalizedPath);
          throw new PathError('ENOENT', `File not found: ${normalizedPath}`);
        }
        await db.fileSystemEntries.delete(normalizedPath);
      },
    );
    log.debug('remove: success:', normalizedPath);
  }

  /**
   * Delete a file if it exists (idempotent).
   *
   * Unlike `remove()`, this method does NOT throw ENOENT if the file is missing.
   * Returns true if the file was deleted, false if it didn't exist.
   *
   * Use this when the caller wants "delete if present" semantics without error handling.
   *
   * @throws LifecycleClosedError if the VirtualFS has been closed
   */
  async removeIfExists(path: string): Promise<boolean> {
    this._lifecycleGuard.assertActive();
    const normalizedPath = normalizePath(path);
    log.debug('removeIfExists:', normalizedPath);
    const db = getDatabase();

    let deleted = false;
    await db.transaction(
      'rw',
      db.fileSystemEntries,
      async () => {
        const entry = await db.fileSystemEntries.get(normalizedPath);
        if (entry) {
          await db.fileSystemEntries.delete(normalizedPath);
          deleted = true;
        }
      },
    );
    log.debug(
      'removeIfExists:',
      deleted ? 'deleted' : 'not found',
      normalizedPath,
    );
    return deleted;
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

  /**
   * Close the lifecycle guard to prevent further operations.
   *
   * P0-FIX: Called by PersistenceLayer during shutdown to reject any VirtualFS
   * operations attempted after the database has been closed. This prevents
   * DatabaseClosedError from Dexie by providing early, semantic rejection.
   *
   * After calling this, any attempt to use VirtualFS methods will throw
   * LifecycleClosedError instead of the opaque DatabaseClosedError.
   */
  closeLifecycleGuard(): void {
    this._lifecycleGuard.close();
  }
}

/**
 * Global VirtualFS singleton instance.
 */
export const virtualFS = new VirtualFS();
