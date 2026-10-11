#!/usr/bin/env node

/**
 * 移除 JS 文件中的 sourcemap 引用注释
 * 用于实现生产环境的 "hidden" sourcemap 效果：
 * - 保留 .map 文件（可用于错误追踪工具）
 * - 移除 JS 中的引用（避免浏览器开发者工具暴露源码）
 *
 * 使用方法：node scripts/remove-sourcemap-refs.js [file...]
 * 如果不指定文件，默认处理 dist 目录下所有 JS 文件
 */

import { readFileSync, writeFileSync, existsSync, globSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// 匹配 //# sourceMappingURL=... 或 /*# sourceMappingURL=... */
const SOURCE_MAP_REGEX = /\/\/[#@]\s*sourceMappingURL=[\w.-]+\.map\s*$|\/\*[#@]\s*sourceMappingURL=[\w.-]+\.map\s*\*\//gm;

function removeSourceMapRefs(filePath) {
  const fullPath = join(__dirname, '..', filePath);

  if (!existsSync(fullPath)) {
    console.warn(`⚠️  文件不存在: ${fullPath}`);
    return false;
  }

  const content = readFileSync(fullPath, 'utf-8');
  const hasSourceMapRef = SOURCE_MAP_REGEX.test(content);

  if (hasSourceMapRef) {
    // 重置正则表达式的 lastIndex
    SOURCE_MAP_REGEX.lastIndex = 0;
    const newContent = content.replace(SOURCE_MAP_REGEX, '').trimEnd() + '\n';
    writeFileSync(fullPath, newContent, 'utf-8');
    console.log(`✅ 已移除 sourcemap 引用: ${filePath}`);
    return true;
  } else {
    console.log(`ℹ️  未找到 sourcemap 引用: ${filePath}`);
    return false;
  }
}

// 支持命令行参数或默认处理 dist 目录下所有 JS 文件
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
