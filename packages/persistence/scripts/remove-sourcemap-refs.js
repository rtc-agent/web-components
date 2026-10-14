#!/usr/bin/env node

/**
 * Remove sourcemap references from JavaScript files (hidden sourcemaps).
 *
 * ## Purpose
 *
 * Production builds generate .map files alongside .js bundles. By default, bundlers
 * append a comment like `//# sourceMappingURL=app.js.map` at the end of each JS file,
 * which tells browsers where to find the corresponding sourcemap.
 *
 * This script removes those reference comments while keeping the .map files intact.
 * The result is "hidden" sourcemaps:
 * - The .map files still exist on disk (useful for error tracking tools like Sentry
 *   that can upload them server-side)
 * - Browser developer tools cannot discover them (users cannot reverse-engineer
 *   the original source code)
 *
 * ## Security Benefit
 *
 * Without this step, anyone could open browser DevTools and view the original
 * (potentially minified but still readable) source code, including:
 * - Internal API endpoint paths
 * - Business logic details
 * - Obfuscated-but-not-eliminated code structure
 *
 * ## Usage
 *
 *   node scripts/remove-sourcemap-refs.js [file...]
 *
 * If no files are specified, processes all .js files under dist/ directory.
 *
 * ## Integration
 *
 * Typically run as a postbuild step in package.json:
 *   "build": "vite build && node scripts/remove-sourcemap-refs.js"
 *
 * ## Pattern Matched
 *
 * Matches both standard formats:
 * - `//# sourceMappingURL=<filename>.map` (single-line comment)
 * - `/*#@ sourceMappingURL=<filename>.map *​/` (block comment variant)
 */

import { readFileSync, writeFileSync, existsSync, globSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Regex to match sourcemap reference comments.
 *
 * Matches:
 * - `//# sourceMappingURL=app.js.map` (most common, appended by Vite/Webpack/esbuild)
 * - `//@ sourceMappingURL=app.js.map` (legacy format, still seen in some tools)
 * - `/*#@ sourceMappingURL=app.js.map *​/` (block comment variant)
 *
 * Flags:
 * - `g` (global): match all occurrences in a file (typically only 1, but be safe)
 * - `m` (multiline): `^` and `$` match line boundaries, ensuring we only match
 *   comments at the end of a line (prevents false positives in code content)
 */
const SOURCE_MAP_REGEX = /\/\/[#@]\s*sourceMappingURL=[\w.-]+\.map\s*$|\/\*[#@]\s*sourceMappingURL=[\w.-]+\.map\s*\*\//gm;

/**
 * Remove sourcemap reference comments from a single file.
 *
 * @param filePath - Path relative to the package root (e.g., 'dist/app.js')
 * @returns true if the file was modified, false if no sourcemap reference was found
 */
function removeSourceMapRefs(filePath) {
  const fullPath = join(__dirname, '..', filePath);

  if (!existsSync(fullPath)) {
    console.warn(`⚠️  文件不存在: ${fullPath}`);
    return false;
  }

  const content = readFileSync(fullPath, 'utf-8');
  const hasSourceMapRef = SOURCE_MAP_REGEX.test(content);

  if (hasSourceMapRef) {
    // Reset regex lastIndex (global flag maintains state between test() calls)
    SOURCE_MAP_REGEX.lastIndex = 0;
    // Remove the sourcemap comment and trim trailing whitespace.
    // Append a final newline to ensure the file ends cleanly (POSIX compliance).
    const newContent = content.replace(SOURCE_MAP_REGEX, '').trimEnd() + '\n';
    writeFileSync(fullPath, newContent, 'utf-8');
    console.log(`✅ 已移除 sourcemap 引用: ${filePath}`);
    return true;
  } else {
    console.log(`ℹ️  未找到 sourcemap 引用: ${filePath}`);
    return false;
  }
}

// Accept file paths as CLI arguments, or default to processing all .js files in dist/
const files = process.argv.slice(2);
const packageRoot = join(__dirname, '..');
const filesToProcess = files.length > 0 ? files : globSync('dist/**/*.js', { cwd: packageRoot });

let removedCount = 0;
for (const file of filesToProcess) {
  if (removeSourceMapRefs(file)) {
    removedCount++;
  }
}

console.log(`\n处理完成: ${removedCount}/${filesToProcess.length} 个文件已移除 sourcemap 引用`);
