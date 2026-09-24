import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    VirtualFS,
    PathError,
    normalizePath,
    getParentPath,
    getFileName,
    isChildPath,
    matchGlob,
} from './virtual-fs.js';
import { getDatabase, closeDatabase } from './database.js';

describe('virtual-fs', () => {
    const DB_NAME = 'rtc-agent-test-virtual-fs';
    let vfs: VirtualFS;

    beforeEach(() => {
        getDatabase(DB_NAME);
        vfs = new VirtualFS();
    });

    afterEach(async () => {
        const db = getDatabase();
        await db.fileSystemEntries.clear();
        await closeDatabase();
    });

    // ── Path Utilities ──

    describe('normalizePath', () => {
        it('should add leading slash to relative paths', () => {
            expect(normalizePath('file.txt')).toBe('/file.txt');
            expect(normalizePath('dir/file.txt')).toBe('/dir/file.txt');
        });

        it('should keep absolute paths unchanged', () => {
            expect(normalizePath('/file.txt')).toBe('/file.txt');
            expect(normalizePath('/dir/file.txt')).toBe('/dir/file.txt');
        });

        it('should remove redundant slashes', () => {
            expect(normalizePath('//file.txt')).toBe('/file.txt');
            expect(normalizePath('/dir//file.txt')).toBe('/dir/file.txt');
            expect(normalizePath('///a///b///c.txt')).toBe('/a/b/c.txt');
        });

        it('should remove trailing slash except for root', () => {
            expect(normalizePath('/dir/')).toBe('/dir');
            expect(normalizePath('/dir/file/')).toBe('/dir/file');
            expect(normalizePath('/')).toBe('/');
        });

        it('should handle current directory (.) segments', () => {
            expect(normalizePath('/dir/./file.txt')).toBe('/dir/file.txt');
            expect(normalizePath('./file.txt')).toBe('/file.txt');
            expect(normalizePath('/a/./b/./c.txt')).toBe('/a/b/c.txt');
        });

        it('should forbid parent directory (..) traversal', () => {
            expect(() => normalizePath('../file.txt')).toThrow(PathError);
            expect(() => normalizePath('/dir/../file.txt')).toThrow(PathError);
            expect(() => normalizePath('dir/..')).toThrow(PathError);
        });

        it('should throw PathError with EINVAL for empty path', () => {
            expect(() => normalizePath('')).toThrow(PathError);
            expect(() => normalizePath('')).toThrow(/Path must be a non-empty string/);
        });

        it('should throw PathError with EINVAL for non-string input', () => {
            expect(() => normalizePath(null as any)).toThrow(PathError);
            expect(() => normalizePath(undefined as any)).toThrow(PathError);
            expect(() => normalizePath(123 as any)).toThrow(PathError);
        });

        it('should handle complex paths correctly', () => {
            expect(() => normalizePath('/a/b/../c')).toThrow(PathError);
            expect(normalizePath('/a/./b/./c/./d.txt')).toBe('/a/b/c/d.txt');
            expect(normalizePath('a//b///c////d.txt')).toBe('/a/b/c/d.txt');
        });
    });

    describe('getParentPath', () => {
        it('should return parent path', () => {
            expect(getParentPath('/a/b/c.txt')).toBe('/a/b');
            expect(getParentPath('/a/b')).toBe('/a');
            expect(getParentPath('/a')).toBe('/');
        });

        it('should return root for root', () => {
            expect(getParentPath('/')).toBe('/');
        });

        it('should normalize path before extracting parent', () => {
            expect(getParentPath('a/b/c.txt')).toBe('/a/b');
            expect(getParentPath('/a/b/')).toBe('/a');
        });
    });

    describe('getFileName', () => {
        it('should extract file name from path', () => {
            expect(getFileName('/a/b/c.txt')).toBe('c.txt');
            expect(getFileName('/file.txt')).toBe('file.txt');
            expect(getFileName('/dir/subdir/file.md')).toBe('file.md');
        });

        it('should normalize path before extracting name', () => {
            expect(getFileName('a/b/c.txt')).toBe('c.txt');
            expect(getFileName('/dir/file/')).toBe('file');
        });
    });

    describe('isChildPath', () => {
        it('should return true for direct child', () => {
            expect(isChildPath('/a', '/a/b')).toBe(true);
            expect(isChildPath('/a/b', '/a/b/c.txt')).toBe(true);
        });

        it('should return true for nested child', () => {
            expect(isChildPath('/a', '/a/b/c/d.txt')).toBe(true);
        });

        it('should return false for non-child paths', () => {
            expect(isChildPath('/a', '/b')).toBe(false);
            expect(isChildPath('/a/b', '/a/bc')).toBe(false);
            expect(isChildPath('/a', '/a')).toBe(false);
        });

        it('should treat root as parent of everything', () => {
            expect(isChildPath('/', '/a')).toBe(true);
            expect(isChildPath('/', '/a/b/c.txt')).toBe(true);
            expect(isChildPath('/', '/')).toBe(true);
        });

        it('should normalize paths before checking', () => {
            expect(isChildPath('a', 'a/b')).toBe(true);
            expect(isChildPath('/a/', '/a/b/')).toBe(true);
        });
    });

    describe('matchGlob', () => {
        it('should match * wildcard', () => {
            expect(matchGlob('*.txt', 'file.txt')).toBe(true);
            expect(matchGlob('*.txt', 'dir/file.txt')).toBe(false); // * doesn't match /
            expect(matchGlob('dir/*', 'dir/file.txt')).toBe(true);
        });

        it('should match ? wildcard', () => {
            expect(matchGlob('file?.txt', 'file1.txt')).toBe(true);
            expect(matchGlob('file?.txt', 'file12.txt')).toBe(false);
            expect(matchGlob('?.txt', 'a.txt')).toBe(true);
        });

        it('should escape RegExp metacharacters', () => {
            expect(matchGlob('file.txt', 'file.txt')).toBe(true);
            expect(matchGlob('file.txt', 'fileXtxt')).toBe(false);
            expect(matchGlob('a+b.txt', 'a+b.txt')).toBe(true);
            expect(matchGlob('a+b.txt', 'aab.txt')).toBe(false);
        });

        it('should not match across directory boundaries', () => {
            expect(matchGlob('*', 'a/b')).toBe(false);
            expect(matchGlob('a/*', 'a/b/c')).toBe(false);
        });

        it('should handle complex patterns', () => {
            expect(matchGlob('dir/*.md', 'dir/file.md')).toBe(true);
            expect(matchGlob('dir/*.md', 'dir/file.txt')).toBe(false);
            expect(matchGlob('*/*.txt', 'a/file.txt')).toBe(true);
        });
    });

    // ── VirtualFS Class ──

    describe('read', () => {
        it('should read file content', async () => {
            await vfs.write('/test.txt', 'Hello, World!');
            const content = await vfs.read('/test.txt');
            expect(content).toBe('Hello, World!');
        });

        it('should read with offset (line-based, 1-indexed)', async () => {
            await vfs.write('/test.txt', 'Line 1\nLine 2\nLine 3\nLine 4');
            const content = await vfs.read('/test.txt', 3); // start from line 3
            expect(content).toBe('Line 3\nLine 4');
        });

        it('should read with limit (number of lines)', async () => {
            await vfs.write('/test.txt', 'Line 1\nLine 2\nLine 3\nLine 4');
            const content = await vfs.read('/test.txt', undefined, 2); // first 2 lines
            expect(content).toBe('Line 1\nLine 2');
        });

        it('should read with offset and limit', async () => {
            await vfs.write('/test.txt', 'Line 1\nLine 2\nLine 3\nLine 4');
            const content = await vfs.read('/test.txt', 2, 2); // lines 2-3
            expect(content).toBe('Line 2\nLine 3');
        });

        it('should handle offset beyond content length', async () => {
            await vfs.write('/test.txt', 'Line 1\nLine 2');
            const content = await vfs.read('/test.txt', 100);
            expect(content).toBe('');
        });

        it('should handle limit beyond remaining lines', async () => {
            await vfs.write('/test.txt', 'Line 1\nLine 2');
            const content = await vfs.read('/test.txt', 1, 100);
            expect(content).toBe('Line 1\nLine 2');
        });

        it('should throw PathError ENOENT for non-existent file', async () => {
            await expect(vfs.read('/nonexistent.txt')).rejects.toThrow(PathError);
            await expect(vfs.read('/nonexistent.txt')).rejects.toThrow(/File not found/);
        });

        it('should normalize path', async () => {
            await vfs.write('/test.txt', 'content');
            const content = await vfs.read('test.txt');
            expect(content).toBe('content');
        });

        it('should return single-line file correctly with offset=1', async () => {
            await vfs.write('/test.txt', 'Hello');
            const content = await vfs.read('/test.txt', 1);
            expect(content).toBe('Hello');
        });

        it('should handle empty file', async () => {
            await vfs.write('/test.txt', '');
            const content = await vfs.read('/test.txt');
            expect(content).toBe('');
        });
    });

    describe('write', () => {
        it('should create new file with overwrite mode', async () => {
            const length = await vfs.write('/new.txt', 'content');
            expect(length).toBe(7);
            expect(await vfs.exists('/new.txt')).toBe(true);
        });

        it('should overwrite existing file', async () => {
            await vfs.write('/file.txt', 'old content');
            await vfs.write('/file.txt', 'new content');
            const content = await vfs.read('/file.txt');
            expect(content).toBe('new content');
        });

        it('should append to existing file', async () => {
            await vfs.write('/file.txt', 'Hello');
            await vfs.write('/file.txt', ', World!', 'append');
            const content = await vfs.read('/file.txt');
            expect(content).toBe('Hello, World!');
        });

        it('should create file when append mode and file does not exist', async () => {
            await vfs.write('/new.txt', 'content', 'append');
            const content = await vfs.read('/new.txt');
            expect(content).toBe('content');
        });

        it('should skip write in create-new mode when file exists', async () => {
            await vfs.write('/file.txt', 'existing');
            const length = await vfs.write('/file.txt', 'new', 'create-new');
            expect(length).toBe(8); // existing content length
            expect(await vfs.read('/file.txt')).toBe('existing');
        });

        it('should create file in create-new mode when file does not exist', async () => {
            const length = await vfs.write('/new.txt', 'content', 'create-new');
            expect(length).toBe(7);
            expect(await vfs.read('/new.txt')).toBe('content');
        });

        it('should preserve createdAt on overwrite', async () => {
            await vfs.write('/file.txt', 'v1');
            const db = getDatabase();
            const entry1 = await db.fileSystemEntries.get('/file.txt');
            const originalCreatedAt = entry1!.metadata.createdAt;

            await new Promise(resolve => setTimeout(resolve, 10));
            await vfs.write('/file.txt', 'v2');

            const entry2 = await db.fileSystemEntries.get('/file.txt');
            expect(entry2!.metadata.createdAt).toEqual(originalCreatedAt);
            expect(entry2!.metadata.updatedAt.getTime()).toBeGreaterThan(
                originalCreatedAt.getTime()
            );
        });

        it('should apply metadata override', async () => {
            await vfs.write('/file.txt', 'content', 'overwrite', {
                description: 'Test file',
                tags: ['test', 'example'],
            });

            const db = getDatabase();
            const entry = await db.fileSystemEntries.get('/file.txt');
            expect(entry!.metadata.description).toBe('Test file');
            expect(entry!.metadata.tags).toEqual(['test', 'example']);
        });

        it('should update metadata on append', async () => {
            await vfs.write('/file.txt', 'v1', 'overwrite', { description: 'Original' });
            await vfs.write('/file.txt', 'v2', 'append', { description: 'Updated' });

            const db = getDatabase();
            const entry = await db.fileSystemEntries.get('/file.txt');
            expect(entry!.metadata.description).toBe('Updated');
        });

        it('should infer type from path', async () => {
            const db = getDatabase();

            await vfs.write('/functions/user/register.md', 'content');
            const funcEntry = await db.fileSystemEntries.get('/functions/user/register.md');
            expect(funcEntry!.type).toBe('function');
            expect(funcEntry!.metadata.group).toBe('user');

            await vfs.write('/scenarios/login.md', 'content');
            const scenarioEntry = await db.fileSystemEntries.get('/scenarios/login.md');
            expect(scenarioEntry!.type).toBe('scenario');

            await vfs.write('/scripts/test.js', 'content');
            const scriptEntry = await db.fileSystemEntries.get('/scripts/test.js');
            expect(scriptEntry!.type).toBe('script');

            await vfs.write('/docs/readme.md', 'content');
            const indexEntry = await db.fileSystemEntries.get('/docs/readme.md');
            expect(indexEntry!.type).toBe('index');
        });

        it('should extract group for function type', async () => {
            const db = getDatabase();

            await vfs.write('/functions/auth/login.md', 'content');
            const entry1 = await db.fileSystemEntries.get('/functions/auth/login.md');
            expect(entry1!.metadata.group).toBe('auth');

            await vfs.write('/functions/api/users/list.md', 'content');
            const entry2 = await db.fileSystemEntries.get('/functions/api/users/list.md');
            expect(entry2!.metadata.group).toBe('api');

            await vfs.write('/functions/standalone.md', 'content');
            const entry3 = await db.fileSystemEntries.get('/functions/standalone.md');
            expect(entry3!.metadata.group).toBeUndefined();
        });

        it('should return total character count after write', async () => {
            expect(await vfs.write('/file.txt', 'Hello')).toBe(5);
            expect(await vfs.write('/file.txt', ' World!', 'append')).toBe(12);
            expect(await vfs.write('/file.txt', 'New', 'overwrite')).toBe(3);
        });
    });

    describe('ls', () => {
        it('should list root directory', async () => {
            await vfs.write('/file1.txt', 'content1');
            await vfs.write('/file2.txt', 'content2');
            await vfs.write('/dir/file3.txt', 'content3');

            const items = await vfs.ls('/');
            expect(items).toEqual(['dir', 'file1.txt', 'file2.txt']);
        });

        it('should list subdirectory', async () => {
            await vfs.write('/dir/file1.txt', 'content1');
            await vfs.write('/dir/file2.txt', 'content2');
            await vfs.write('/dir/subdir/file3.txt', 'content3');

            const items = await vfs.ls('/dir');
            expect(items).toEqual(['file1.txt', 'file2.txt', 'subdir']);
        });

        it('should return empty array for empty directory', async () => {
            await vfs.write('/file.txt', 'content');
            const items = await vfs.ls('/empty');
            expect(items).toEqual([]);
        });

        it('should return sorted results', async () => {
            await vfs.write('/c.txt', 'content');
            await vfs.write('/a.txt', 'content');
            await vfs.write('/b.txt', 'content');

            const items = await vfs.ls('/');
            expect(items).toEqual(['a.txt', 'b.txt', 'c.txt']);
        });

        it('should normalize path', async () => {
            await vfs.write('/dir/file.txt', 'content');
            const items = await vfs.ls('dir');
            expect(items).toEqual(['file.txt']);
        });

        it('should only show direct children', async () => {
            await vfs.write('/a/b/c/d/file.txt', 'content');
            const items = await vfs.ls('/a');
            expect(items).toEqual(['b']);
        });
    });

    describe('find', () => {
        beforeEach(async () => {
            await vfs.write('/readme.md', 'readme');
            await vfs.write('/docs/guide.md', 'guide');
            await vfs.write('/docs/api/reference.md', 'reference');
            await vfs.write('/src/index.ts', 'index');
            await vfs.write('/src/utils/helper.ts', 'helper');
        });

        it('should find files matching * pattern', async () => {
            const results = await vfs.find('*.md');
            expect(results).toEqual(['/readme.md']);
        });

        it('should find files with path prefix', async () => {
            const results = await vfs.find('docs/*.md');
            expect(results).toEqual(['/docs/guide.md']);
        });

        it('should find files matching ? pattern', async () => {
            const results = await vfs.find('src/index.?s');
            expect(results).toEqual(['/src/index.ts']);
        });

        it('should search within specified path', async () => {
            const results = await vfs.find('*.md', '/docs');
            expect(results).toEqual(['/docs/guide.md']);
        });

        it('should return sorted results', async () => {
            await vfs.write('/a.txt', 'content');
            await vfs.write('/c.txt', 'content');
            await vfs.write('/b.txt', 'content');

            const results = await vfs.find('*.txt');
            expect(results).toEqual(['/a.txt', '/b.txt', '/c.txt']);
        });

        it('should return empty array when no match', async () => {
            const results = await vfs.find('*.xyz');
            expect(results).toEqual([]);
        });
    });

    describe('grep', () => {
        beforeEach(async () => {
            await vfs.write('/file1.txt', 'Hello World\nThis is a test\nHello again');
            await vfs.write('/file2.txt', 'Another file\nWith multiple lines\nTest content');
        });

        it('should find files matching pattern (files_with_matches mode)', async () => {
            const result = await vfs.grep('Hello', '/', false, 250, 0, 0, 0, true, 'files_with_matches');
            expect(result.mode).toBe('files_with_matches');
            expect(result.filenames).toHaveLength(1);
            expect(result.filenames[0]).toBe('/file1.txt');
        });

        it('should be case-insensitive by default', async () => {
            const result = await vfs.grep('hello', '/', false, 250, 0, 0, 0, true, 'content');
            expect(result.numLines).toBeGreaterThan(0);
        });

        it('should support case-sensitive mode', async () => {
            const result1 = await vfs.grep('Hello', '/', true, 250, 0, 0, 0, true, 'content');
            expect(result1.numLines).toBeGreaterThan(0);

            const result2 = await vfs.grep('hello', '/', true, 250, 0, 0, 0, true, 'files_with_matches');
            expect(result2.numFiles).toBe(0);
        });

        it('should search within specified path', async () => {
            await vfs.write('/dir/file.txt', 'Hello in dir');
            const result = await vfs.grep('Hello', '/dir', false, 250, 0, 0, 0, true, 'files_with_matches');
            expect(result.filenames).toHaveLength(1);
            expect(result.filenames[0]).toBe('/dir/file.txt');
        });

        it('should respect headLimit limit', async () => {
            for (let i = 0; i < 20; i++) {
                await vfs.write(`/file${i}.txt`, 'test line');
            }

            const result = await vfs.grep('test', '/', false, 5, 0, 0, 0, true, 'files_with_matches');
            expect(result.filenames.length).toBeLessThanOrEqual(5);
        });

        it('should throw SyntaxError for invalid regex', async () => {
            await expect(vfs.grep('[invalid')).rejects.toThrow(SyntaxError);
            await expect(vfs.grep('[invalid')).rejects.toThrow(/Invalid regex/);
        });

        it('should return content with line numbers in content mode', async () => {
            await vfs.write('/test.txt', 'line1\nline2\nline3');
            const result = await vfs.grep('line2', '/', false, 250, 0, 0, 0, true, 'content');
            expect(result.mode).toBe('content');
            expect(result.content).toContain('line2');
            expect(result.content).toContain('2:');
        });

        it('should return count mode results', async () => {
            await vfs.write('/test.txt', 'test test test\nanother line');
            const result = await vfs.grep('test', '/', false, 250, 0, 0, 0, true, 'count');
            expect(result.mode).toBe('count');
            expect(result.numMatches).toBeGreaterThan(0);
        });

        it('should support context lines', async () => {
            await vfs.write('/test.txt', 'line1\nline2\ntarget\nline4\nline5');
            const result = await vfs.grep('target', '/', false, 250, 0, 1, 1, true, 'content');
            expect(result.content).toContain('line2');
            expect(result.content).toContain('target');
            expect(result.content).toContain('line4');
        });

        it('should support glob filtering', async () => {
            await vfs.write('/file.ts', 'test content');
            await vfs.write('/file.js', 'test content');
            const result = await vfs.grep('test', '/', false, 250, 0, 0, 0, true, 'files_with_matches', false, '*.ts');
            expect(result.filenames).toHaveLength(1);
            expect(result.filenames[0]).toBe('/file.ts');
        });

        it('should support ** recursive glob filtering', async () => {
            await vfs.write('/src/a/b/c.ts', 'test content');
            await vfs.write('/src/a/d.ts', 'test content');
            await vfs.write('/src/e.js', 'test content');
            const result = await vfs.grep('test', '/', false, 250, 0, 0, 0, true, 'files_with_matches', false, '**/*.ts');
            expect(result.filenames).toHaveLength(2);
            expect(result.filenames).toContain('/src/a/b/c.ts');
            expect(result.filenames).toContain('/src/a/d.ts');
        });
    });

    describe('queryByType', () => {
        beforeEach(async () => {
            await vfs.write('/functions/auth/login.md', 'content');
            await vfs.write('/functions/api/users.md', 'content');
            await vfs.write('/scenarios/test.md', 'content');
            await vfs.write('/scripts/test.js', 'content');
            await vfs.write('/docs/readme.md', 'content');
        });

        it('should query by function type', async () => {
            const results = await vfs.queryByType('function');
            expect(results).toHaveLength(2);
            expect(results.every(e => e.type === 'function')).toBe(true);
        });

        it('should query by scenario type', async () => {
            const results = await vfs.queryByType('scenario');
            expect(results).toHaveLength(1);
            expect(results[0].path).toBe('/scenarios/test.md');
        });

        it('should query by script type', async () => {
            const results = await vfs.queryByType('script');
            expect(results).toHaveLength(1);
            expect(results[0].path).toBe('/scripts/test.js');
        });

        it('should query by index type', async () => {
            const results = await vfs.queryByType('index');
            expect(results).toHaveLength(1);
            expect(results[0].path).toBe('/docs/readme.md');
        });
    });

    describe('exists', () => {
        it('should return true for existing file', async () => {
            await vfs.write('/file.txt', 'content');
            expect(await vfs.exists('/file.txt')).toBe(true);
        });

        it('should return false for non-existing file', async () => {
            expect(await vfs.exists('/nonexistent.txt')).toBe(false);
        });

        it('should normalize path', async () => {
            await vfs.write('/file.txt', 'content');
            expect(await vfs.exists('file.txt')).toBe(true);
        });
    });

    describe('remove', () => {
        it('should delete existing file', async () => {
            await vfs.write('/file.txt', 'content');
            expect(await vfs.exists('/file.txt')).toBe(true);

            await vfs.remove('/file.txt');
            expect(await vfs.exists('/file.txt')).toBe(false);
        });

        it('should throw PathError ENOENT for non-existing file', async () => {
            await expect(vfs.remove('/nonexistent.txt')).rejects.toThrow(PathError);
            await expect(vfs.remove('/nonexistent.txt')).rejects.toThrow(/File not found/);
        });

        it('should normalize path', async () => {
            await vfs.write('/file.txt', 'content');
            await vfs.remove('file.txt');
            expect(await vfs.exists('/file.txt')).toBe(false);
        });
    });

    // ── Edge Cases & Integration ──

    describe('edge cases', () => {
        it('should handle special characters in paths', async () => {
            await vfs.write('/file with spaces.txt', 'content');
            expect(await vfs.exists('/file with spaces.txt')).toBe(true);

            await vfs.write('/file-with-dashes.txt', 'content');
            expect(await vfs.exists('/file-with-dashes.txt')).toBe(true);

            await vfs.write('/file_with_underscores.txt', 'content');
            expect(await vfs.exists('/file_with_underscores.txt')).toBe(true);
        });

        it('should handle Unicode characters', async () => {
            await vfs.write('/中文文件.txt', '内容');
            expect(await vfs.read('/中文文件.txt')).toBe('内容');

            await vfs.write('/emoji-😀.txt', 'content');
            expect(await vfs.exists('/emoji-😀.txt')).toBe(true);
        });

        it('should handle large files', async () => {
            const largeContent = 'x'.repeat(100000);
            await vfs.write('/large.txt', largeContent);
            const content = await vfs.read('/large.txt');
            expect(content.length).toBe(100000);
        });

        it('should handle empty file', async () => {
            await vfs.write('/empty.txt', '');
            const content = await vfs.read('/empty.txt');
            expect(content).toBe('');
        });

        it('should handle file with only newlines', async () => {
            await vfs.write('/newlines.txt', '\n\n\n');
            const content = await vfs.read('/newlines.txt');
            expect(content).toBe('\n\n\n');
        });

        it('should handle concurrent writes to same file', async () => {
            const writes = [];
            for (let i = 0; i < 10; i++) {
                writes.push(vfs.write('/concurrent.txt', `content-${i}`));
            }
            await Promise.all(writes);

            const content = await vfs.read('/concurrent.txt');
            expect(content).toMatch(/^content-\d+$/);
        });

        it('should handle concurrent reads and writes', async () => {
            await vfs.write('/file.txt', 'initial');

            const operations = [];
            for (let i = 0; i < 5; i++) {
                operations.push(vfs.write('/file.txt', `v${i}`));
                operations.push(vfs.read('/file.txt'));
            }

            await Promise.all(operations);
            const finalContent = await vfs.read('/file.txt');
            expect(finalContent).toMatch(/^v\d+$/);
        });

        it('should maintain data integrity after multiple operations', async () => {
            await vfs.write('/file.txt', 'v1');
            await vfs.write('/file.txt', 'v2', 'append');
            await vfs.write('/file.txt', 'v3', 'overwrite');
            await vfs.write('/file.txt', 'v4', 'append');

            const content = await vfs.read('/file.txt');
            expect(content).toBe('v3v4');
        });
    });

    describe('edit', () => {
        it('should replace exact string match', async () => {
            await vfs.write('/test.txt', 'Hello World');
            const result = await vfs.edit('/test.txt', 'World', 'Universe');
            expect(result.replaced).toBe(1);
            expect(await vfs.read('/test.txt')).toBe('Hello Universe');
        });

        it('should replace with multi-line content', async () => {
            await vfs.write('/test.txt', 'Line 1\nLine 2\nLine 3');
            await vfs.edit('/test.txt', 'Line 2', 'New Line 2');
            expect(await vfs.read('/test.txt')).toBe('Line 1\nNew Line 2\nLine 3');
        });

        it('should throw when old_string not found', async () => {
            await vfs.write('/test.txt', 'Hello World');
            await expect(vfs.edit('/test.txt', 'Foo', 'Bar')).rejects.toThrow(/String to replace not found/);
        });

        it('should throw when old_string matches multiple times and replace_all is false', async () => {
            await vfs.write('/test.txt', 'aaa bbb aaa');
            await expect(vfs.edit('/test.txt', 'aaa', 'ccc')).rejects.toThrow(/Found 2 matches/);
        });

        it('should replace all occurrences when replace_all is true', async () => {
            await vfs.write('/test.txt', 'aaa bbb aaa ccc aaa');
            const result = await vfs.edit('/test.txt', 'aaa', 'xxx', true);
            expect(result.replaced).toBe(3);
            expect(await vfs.read('/test.txt')).toBe('xxx bbb xxx ccc xxx');
        });

        it('should throw when old_string equals new_string', async () => {
            await vfs.write('/test.txt', 'Hello');
            await expect(vfs.edit('/test.txt', 'Hello', 'Hello')).rejects.toThrow(/No changes to make/);
        });

        it('should throw when old_string is empty', async () => {
            await vfs.write('/test.txt', 'Hello');
            await expect(vfs.edit('/test.txt', '', 'New')).rejects.toThrow(/old_string must not be empty/);
        });

        it('should throw PathError ENOENT for non-existent file', async () => {
            await expect(vfs.edit('/nonexistent.txt', 'old', 'new')).rejects.toThrow(PathError);
        });

        it('should allow new_string to be empty (deletion)', async () => {
            await vfs.write('/test.txt', 'Hello World');
            const result = await vfs.edit('/test.txt', ' World', '');
            expect(result.replaced).toBe(1);
            expect(await vfs.read('/test.txt')).toBe('Hello');
        });

        it('should preserve file metadata on edit', async () => {
            await vfs.write('/file.txt', 'v1 content');
            const db = getDatabase();
            const entry1 = await db.fileSystemEntries.get('/file.txt');
            const originalCreatedAt = entry1!.metadata.createdAt;

            await vfs.edit('/file.txt', 'v1', 'v2');

            const entry2 = await db.fileSystemEntries.get('/file.txt');
            expect(entry2!.metadata.createdAt).toEqual(originalCreatedAt);
            expect(entry2!.metadata.updatedAt.getTime()).toBeGreaterThanOrEqual(originalCreatedAt.getTime());
        });
    });

    describe('PathError', () => {
        it('should have correct name and code', () => {
            const error = new PathError('ENOENT', 'File not found');
            expect(error.name).toBe('PathError');
            expect(error.code).toBe('ENOENT');
            expect(error.message).toBe('File not found');
        });

        it('should be instanceof Error', () => {
            const error = new PathError('EINVAL', 'Invalid path');
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(PathError);
        });
    });
});
