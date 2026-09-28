/**
 * Scenario Loader
 *
 * Loads Scenario markdown files from a URL
 */

import type { ScenarioManifest } from '../types/skill.js';
import { virtualFS, type FileSystemEntryMetadata } from '@rtc-agent/persistence';
import { generateScenariosIndex } from './markdown-generator.js';
import {createLogger} from '@rtc-agent/client';

const log = createLogger('ScenarioLoader');

/**
 * Parse YAML frontmatter
 *
 * Format:
 * ---
 * title: "Title"
 * tags: [tag1, tag2]
 * ---
 *
 * Content...
 *
 * Supported fields: title, id, name, description, tags, author, createdAt
 * Limitations: does not support multi-line values or complex YAML structures
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
  // Supports \r\n and \n line endings, supports no trailing newline
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

  // Simple YAML parsing (without gray-matter dependency)
  const lines = yamlStr.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Strip quotes
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
        // Parse array format: [tag1, tag2] or tag1, tag2
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
 * Fetch with timeout
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
 * Load Scenarios from URL
 *
 * @param baseURL Base URL for Scenario files (e.g. '/scenarios/')
 * @param timeoutMs Timeout per request in milliseconds (default 10000)
 * @returns Number of Scenarios loaded
 */
export async function loadScenariosFromURL(baseURL: string, timeoutMs: number = 10000): Promise<number> {
  // Ensure baseURL ends with /
  if (!baseURL.endsWith('/')) {
    baseURL += '/';
  }

  // Try loading manifest.json
  let manifest: ScenarioManifest | null = null;

  try {
    const manifestUrl = baseURL + 'manifest.json';
    const response = await fetchWithTimeout(manifestUrl, timeoutMs);

    if (response.ok) {
      manifest = await response.json();
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.warn('manifest.json fetch timeout');
    } else {
      log.warn('manifest.json not found, will try to scan directory');
    }
  }

  let filesToLoad: string[];

  if (manifest && manifest.scenarios) {
    // Use file list from manifest
    filesToLoad = manifest.scenarios.map(s => s.file);
  } else {
    // No manifest — try scanning directory (assumes a list endpoint exists)
    // Simplified: requires host app to provide file list or use manifest
    log.warn('No manifest.json found. Please provide manifest.json or use writeScenario() API.');
    return 0;
  }

  // Load each Scenario file
  let loadedCount = 0;

  for (const file of filesToLoad) {
    try {
      const url = baseURL + file;
      const response = await fetchWithTimeout(url, timeoutMs);

      if (!response.ok) {
        log.warn(`Failed to load ${file}: ${response.statusText}`);
        continue;
      }

      const content = await response.text();
      const parsed = parseFrontmatter(content);

      // Generate filename (use original filename)
      const filename = file.endsWith('.md') ? file : `${file}.md`;
      const path = `/scenarios/${filename}`;

      // Build metadata (aligned to FileSystemEntryMetadata to avoid `any` escape)
      // Note: FileSystemEntryMetadata has no author field; author info is preserved in original frontmatter
      const metadata: Partial<FileSystemEntryMetadata> = {
        name: parsed.title ?? parsed.name,
        description: parsed.description,
        tags: parsed.tags,
      };

      // Write to virtual file system (uses new metadataOverride parameter)
      await virtualFS.write(path, content, 'overwrite', metadata);

      loadedCount++;
      log.info(`Loaded: ${file}`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        log.error(`Timeout loading ${file}`);
      } else if (err instanceof Error && err.message.includes('getDatabase() called without a name')) {
        // Database not yet initialized — expected timing issue, connectedCallback will reload later
        continue;
      } else {
        log.error(`Error loading ${file}:`, err);
      }
    }
  }

  // Update Scenarios index
  if (loadedCount > 0) {
    await updateScenariosIndex();
  }

  log.info(`Loaded ${loadedCount} scenarios`);
  return loadedCount;
}

/**
 * Load Scenarios content from URL (without writing to VirtualFS), and compute orphan paths to delete
 *
 * Usage: main thread fetches content, then sends it via WorkerBridge.batchWriteFiles() to the Worker for writing.
 * Also queries existing scenario files in VFS to compute orphan paths not in the manifest, passing them to the Worker for deletion.
 *
 * @param baseURL Base URL for Scenario files
 * @param timeoutMs Timeout per request
 * @returns files: files to write, deletePaths: orphan paths to delete
 */
export async function loadScenariosContent(
  baseURL: string,
  timeoutMs: number = 10000
): Promise<{
  files: Array<{path: string; content: string; metadata: {name?: string; description?: string; tags?: string[]}}>
  deletePaths: string[];
}> {
  // Ensure baseURL ends with /
  if (!baseURL.endsWith('/')) {
    baseURL += '/';
  }

  // Try loading manifest.json
  let manifest: ScenarioManifest | null = null;

  try {
    const manifestUrl = baseURL + 'manifest.json';
    const response = await fetchWithTimeout(manifestUrl, timeoutMs);

    if (response.ok) {
      manifest = await response.json();
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.warn('manifest.json fetch timeout');
    } else {
      log.warn('manifest.json not found');
    }
  }

  if (!manifest || !manifest.scenarios) {
    log.warn('No manifest.json found.');
    return { files: [], deletePaths: [] };
  }

  const filesToLoad = manifest.scenarios.map(s => s.file);
  const files: Array<{path: string; content: string; metadata: {name?: string; description?: string; tags?: string[]}}> = [];

  for (const file of filesToLoad) {
    try {
      const url = baseURL + file;
      const response = await fetchWithTimeout(url, timeoutMs);

      if (!response.ok) {
        log.warn(`Failed to load ${file}: ${response.statusText}`);
        continue;
      }

      const content = await response.text();
      const parsed = parseFrontmatter(content);

      const filename = file.endsWith('.md') ? file : `${file}.md`;
      const path = `/scenarios/${filename}`;

      const metadata: {name?: string; description?: string; tags?: string[]} = {};
      if (parsed.title || parsed.name) metadata.name = parsed.title ?? parsed.name;
      if (parsed.description) metadata.description = parsed.description;
      if (parsed.tags) metadata.tags = parsed.tags;

      files.push({path, content, metadata});
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        log.error(`Timeout loading ${file}`);
      } else {
        log.error(`Error loading ${file}:`, err);
      }
    }
  }

  // Compute orphan paths: existing scenario files in VFS not in the current manifest
  let deletePaths: string[] = [];
  try {
    const currentPaths = new Set(files.map(f => f.path));
    const existingScenarios = await virtualFS.queryByType('scenario');
    deletePaths = existingScenarios
      .map(s => s.path)
      .filter(p => p !== '/scenarios/INDEX.md' && !currentPaths.has(p));
    if (deletePaths.length > 0) {
      log.info('Found orphan scenario docs to delete:', deletePaths);
    }
  } catch (err) {
    log.warn('Failed to query existing scenarios for reconciliation:', err);
  }

  return { files, deletePaths };
}

/**
 * Update Scenarios index
 */
async function updateScenariosIndex(): Promise<void> {
  // Query all scenario files
  const scenarios = await virtualFS.queryByType('scenario');

  // Use shared function from markdown-generator (static import, already imported at top of file)
  const md = generateScenariosIndex(scenarios);

  await virtualFS.write('/scenarios/INDEX.md', md, 'overwrite');
}
