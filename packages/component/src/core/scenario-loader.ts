/**
 * Scenario Loader
 *
 * 从 URL 加载 Scenario markdown 文件
 */

import type { ScenarioManifest } from '../types/skill.js';
import { virtualFS } from '@rtc-agent/persistence';

/**
 * 解析 YAML frontmatter
 *
 * 格式：
 * ---
 * title: "标题"
 * tags: [tag1, tag2]
 * ---
 *
 * 内容...
 *
 * 支持的字段：title, id, name, description, tags, author, createdAt
 * 限制：不支持多行值、复杂 YAML 结构
 */
export function parseFrontmatter(content: string): {
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  tags?: string[];
  author?: string;
  createdAt?: string;
  body: string;
} {
  // 支持 \r\n 和 \n 换行符，支持末尾没有换行符
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) {
    return { body: content };
  }

  const yamlStr = match[1];
  const body = match[2];

  const result: {
    id?: string;
    title?: string;
    name?: string;
    description?: string;
    tags?: string[];
    author?: string;
    createdAt?: string;
    body: string;
  } = { body };

  // 简单解析 YAML（不引入 gray-matter 依赖）
  const lines = yamlStr.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // 移除引号
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case 'id':
        result.id = value;
        break;
      case 'title':
        result.title = value;
        break;
      case 'n':
      case 'name':
        result.name = value;
        break;
      case 'd':
      case 'description':
        result.description = value;
        break;
      case 'tags':
        // 解析数组格式：[tag1, tag2] 或 tag1, tag2
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1);
        }
        result.tags = value
          .split(',')
          .map(t => t.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
        break;
      case 'author':
        result.author = value;
        break;
      case 'createdAt':
        result.createdAt = value;
        break;
    }
  }

  return result;
}

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 从 URL 加载 Scenarios
 *
 * @param baseURL Scenario 文件的基础 URL（如 '/scenarios/'）
 * @param timeoutMs 每个请求的超时时间（毫秒，默认 10000）
 * @returns 加载的 Scenario 数量
 */
export async function loadScenariosFromURL(baseURL: string, timeoutMs: number = 10000): Promise<number> {
  // 确保 baseURL 以 / 结尾
  if (!baseURL.endsWith('/')) {
    baseURL += '/';
  }

  // 尝试加载 manifest.json
  let manifest: ScenarioManifest | null = null;

  try {
    const manifestUrl = baseURL + 'manifest.json';
    const response = await fetchWithTimeout(manifestUrl, timeoutMs);

    if (response.ok) {
      manifest = await response.json();
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[ScenarioLoader] manifest.json fetch timeout');
    } else {
      console.warn('[ScenarioLoader] manifest.json not found, will try to scan directory');
    }
  }

  let filesToLoad: string[];

  if (manifest && manifest.scenarios) {
    // 使用 manifest 中的文件列表
    filesToLoad = manifest.scenarios.map(s => s.file);
  } else {
    // 如果没有 manifest，尝试扫描目录（假设有一个列表接口）
    // 这里简化处理：要求宿主应用提供文件列表或使用 manifest
    console.warn('[ScenarioLoader] No manifest.json found. Please provide manifest.json or use writeScenario() API.');
    return 0;
  }

  // 加载每个 Scenario 文件
  let loadedCount = 0;

  for (const file of filesToLoad) {
    try {
      const url = baseURL + file;
      const response = await fetchWithTimeout(url, timeoutMs);

      if (!response.ok) {
        console.warn(`[ScenarioLoader] Failed to load ${file}: ${response.statusText}`);
        continue;
      }

      const content = await response.text();
      const parsed = parseFrontmatter(content);

      // 生成文件名（使用原始文件名）
      const filename = file.endsWith('.md') ? file : `${file}.md`;
      const path = `/scenarios/${filename}`;

      // 构建元数据
      const metadata: Record<string, unknown> = {};
      if (parsed.title) metadata.name = parsed.title;
      else if (parsed.name) metadata.name = parsed.name;
      if (parsed.description) metadata.description = parsed.description;
      if (parsed.tags) metadata.tags = parsed.tags;
      if (parsed.author) metadata.author = parsed.author;

      // 写入虚拟文件系统（使用新的 metadataOverride 参数）
      await virtualFS.write(path, content, 'overwrite', metadata as any);

      loadedCount++;
      console.log(`[ScenarioLoader] Loaded: ${file}`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.error(`[ScenarioLoader] Timeout loading ${file}`);
      } else {
        console.error(`[ScenarioLoader] Error loading ${file}:`, err);
      }
    }
  }

  // 更新 Scenarios 索引
  if (loadedCount > 0) {
    await updateScenariosIndex();
  }

  console.log(`[ScenarioLoader] Loaded ${loadedCount} scenarios`);
  return loadedCount;
}

/**
 * 更新 Scenarios 索引
 */
async function updateScenariosIndex(): Promise<void> {
  // 查询所有 scenario 文件
  const scenarios = await virtualFS.queryByType('scenario');

  // 使用 markdown-generator 中的共享函数
  const { generateScenariosIndex } = await import('./markdown-generator.js');
  const md = generateScenariosIndex(scenarios);

  await virtualFS.write('/scenarios/INDEX.md', md, 'overwrite');
}
