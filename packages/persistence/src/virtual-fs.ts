/**
 * Virtual File System
 *
 * 基于 IndexedDB 的虚拟文件系统，为 LLM 提供文件操作接口。
 *
 * 设计要点：
 * - 路径规范化：统一为绝对路径，禁止 .. 路径遍历
 * - 目录自动创建：写入文件时自动创建父目录（逻辑目录，不存储）
 * - 索引支持：通过 IndexedDB 索引加速查询
 * - 使用类结构（而非模块级函数）：便于未来注入不同数据库实例或配置
 */

import { getDatabase, type FileSystemEntry, type FileSystemEntryType, type FileSystemEntryMetadata } from './database.js';

/**
 * 路径错误
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
 * 规范化路径
 *
 * - 转换为绝对路径（添加前导 /）
 * - 移除多余的 /
 * - 禁止 .. 路径遍历
 * - 移除尾部的 /（根目录除外）
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
 * 获取父路径
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
 * 获取文件名（不含路径）
 */
export function getFileName(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  return normalized.substring(lastSlash + 1);
}

/**
 * 检查路径是否是指定目录的子路径
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
 * 简单的 glob pattern 匹配
 *
 * 支持：
 * - * 匹配任意字符（不含 /）
 * - ? 匹配单个字符
 *
 * 不支持：
 * - ** 递归匹配（v1 限制，TODO: 未来版本支持）
 */
export function matchGlob(pattern: string, path: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}

/**
 * 虚拟文件系统
 *
 * 使用类结构而非模块级函数，便于未来注入不同数据库实例或配置
 */
export class VirtualFS {
  /**
   * 读取文件内容
   *
   * @param path 文件路径
   * @param offset 起始位置（字符位置，非字节）
   * @param limit 最大读取字符数
   * @throws PathError ENOENT 文件不存在
   */
  async read(path: string, offset?: number, limit?: number): Promise<string> {
    const normalizedPath = normalizePath(path);
    const db = getDatabase();

    const entry = await db.fileSystemEntries.get(normalizedPath);
    if (!entry) {
      throw new PathError('ENOENT', `File not found: ${normalizedPath}`);
    }

    let content = entry.content;

    if (offset !== undefined || limit !== undefined) {
      const start = offset || 0;
      const end = limit !== undefined ? start + limit : undefined;
      content = content.substring(start, end);
    }

    return content;
  }

  /**
   * 写入文件
   *
   * @param path 文件路径
   * @param content 文件内容
   * @param mode 写入模式：overwrite（覆盖）或 append（追加）
   * @param metadataOverride 可选的元数据覆盖（部分字段）
   * @returns 写入后的文件总字符数
   */
  async write(
    path: string,
    content: string,
    mode: 'overwrite' | 'append' = 'overwrite',
    metadataOverride?: Partial<FileSystemEntryMetadata>
  ): Promise<number> {
    const normalizedPath = normalizePath(path);
    const db = getDatabase();

    const type = this.inferFileType(normalizedPath);
    const existing = await db.fileSystemEntries.get(normalizedPath);

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
    return finalContent.length;
  }

  /**
   * 列出目录内容
   *
   * @param path 目录路径（默认根目录）
   * @returns 文件名列表（不含完整路径）
   */
  async ls(path: string = '/'): Promise<string[]> {
    const normalizedPath = normalizePath(path);
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
   * 按文件名搜索
   *
   * @param pattern glob pattern（支持 * 和 ?）
   * @param path 搜索范围（默认根目录）
   * @returns 匹配的文件路径列表
   */
  async find(pattern: string, path: string = '/'): Promise<string[]> {
    const normalizedPath = normalizePath(path);
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
   * 按内容搜索
   *
   * @param pattern 正则表达式
   * @param path 搜索范围（默认根目录）
   * @param caseSensitive 是否大小写敏感（默认 false）
   * @returns 匹配结果列表
   */
  async grep(
    pattern: string,
    path: string = '/',
    caseSensitive: boolean = false
  ): Promise<Array<{ file: string; line: string; lineNumber: number }>> {
    const normalizedPath = normalizePath(path);
    const db = getDatabase();

    let regex: RegExp;
    try {
      const flags = caseSensitive ? '' : 'i';
      regex = new RegExp(pattern, flags);
    } catch (err) {
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
        }
      }
    }

    return results;
  }

  /**
   * 查询指定类型的文件
   *
   * @param type 文件类型
   * @returns 文件条目列表
   */
  async queryByType(type: FileSystemEntryType): Promise<FileSystemEntry[]> {
    const db = getDatabase();
    return db.fileSystemEntries.where('type').equals(type).toArray();
  }

  /**
   * 检查文件是否存在
   */
  async exists(path: string): Promise<boolean> {
    const normalizedPath = normalizePath(path);
    const db = getDatabase();
    const entry = await db.fileSystemEntries.get(normalizedPath);
    return entry !== undefined;
  }

  /**
   * 删除文件
   */
  async remove(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    const db = getDatabase();

    const exists = await this.exists(normalizedPath);
    if (!exists) {
      throw new PathError('ENOENT', `File not found: ${normalizedPath}`);
    }

    await db.fileSystemEntries.delete(normalizedPath);
  }

  /**
   * 推断文件类型
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
    if (path.endsWith('/INDEX.md') || path === '/AGENT.md') {
      return 'index';
    }
    return 'index';
  }

  /**
   * 从路径提取分组名称
   *
   * 例如：/functions/user/register.md -> 'user'
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
 * 全局 VirtualFS 实例
 */
export const virtualFS = new VirtualFS();
