import {createLogger} from '@rtc-agent/client';
const log = createLogger('FunctionRegistry');

/**
 * Function Registry
 *
 * Manages function registration, resolution, and chain calls.
 * Uses Proxy to implement rtcAgent.user.register() syntax.
 *
 * This file is intentionally large (660+ lines) because it provides a cohesive
 * API surface for the function registration system. The core class (FunctionRegistry)
 * and its helper (FunctionGroup) are tightly coupled: FunctionGroup delegates to
 * FunctionRegistry for storage, and FunctionRegistry exposes group proxies for
 * chain-call syntax. Splitting them would scatter the registration/execution/doc
 * pipeline across files, making the system harder to understand and maintain.
 */

import type {
  FunctionDef,
  FunctionGroupDef,
  RegistryConfig,
  ScenarioDef,
} from '../types/skill.js';
import { virtualFS } from '@rtc-agent/persistence';
import { generateFunctionMd, generateFunctionsIndex, generateAgentMd, generateScenariosIndex } from './markdown-generator.js';
import { registerBuiltinSystemGroup } from './builtin-system-group.js';
import { zodToParams, zodToOpenAPISchema } from '../validation/zod-to-openapi.js';
import { eventBus, type FunctionStartEvent, type FunctionSuccessEvent, type FunctionErrorEvent, type FunctionProgressEvent } from './event-bus.js';
import { buildValidator, validateParams, formatValidationError } from '../validation/index.js';

/**
 * FunctionGroup instance
 * Supports chain registration and invocation
 */
export class FunctionGroup {
  private registry: FunctionRegistry;
  private groupName: string;
  private functions = new Map<string, FunctionDef>();

  constructor(registry: FunctionRegistry, groupDef: FunctionGroupDef) {
    this.registry = registry;
    this.groupName = groupDef.name;
  }

  /**
   * Register a function to the current group
   *
   * @param funcDef Function definition, name is required (function name within the group, without group prefix)
   */
  register(funcDef: Omit<FunctionDef, 'name'> & { name: string }): FunctionDef {
    // Generate full name: group.name
    const fullName = `${this.groupName}.${funcDef.name}`;

    const fullDef: FunctionDef = {
      ...funcDef,
      name: fullName,
    };

    this.functions.set(fullName, fullDef);
    this.registry.registerInternal(fullDef, this.groupName);

    return fullDef;
  }

  /**
   * Get all functions within the group
   */
  listFunctions(): FunctionDef[] {
    return Array.from(this.functions.values());
  }

  /**
   * Support chain calls via Proxy: rtcAgent.task.list(params)
   *
   * Whitelist methods are returned directly; other property names are treated as function names within the group,
   * returning a function that calls registry.execute('group.funcName', params).
   */
  createProxy(): FunctionGroup & Record<string, (params?: Record<string, unknown>) => Promise<unknown>> {
    const group = this;

    const PUBLIC_METHODS = new Set(['register', 'listFunctions', 'createProxy']);

    return new Proxy(this, {
      get(target, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return (target as Record<symbol, unknown>)[prop];
        }

        // Whitelist methods
        if (PUBLIC_METHODS.has(prop)) {
          const value = (target as Record<string, unknown>)[prop];
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }

        // Check if it's a registered function name
        const fullName = `${group.groupName}.${prop}`;
        if (group.functions.has(fullName)) {
          return (params: Record<string, unknown> = {}) => group.registry.execute(fullName, params);
        }

        // Unknown property: log a warning to help debug typos or missing registrations
        log.warn(`Function '${fullName}' is not registered. Available functions: ${Array.from(group.functions.keys()).map(k => k.split('.')[1]).join(', ')}`);
        return undefined;
      },
    }) as unknown as FunctionGroup & Record<string, (params?: Record<string, unknown>) => Promise<unknown>>;
  }
}

/**
 * FunctionRegistry - Global registry
 */
export class FunctionRegistry {
  private config: RegistryConfig;
  private functions = new Map<string, FunctionDef>();
  private groups = new Map<string, FunctionGroup>();
  private groupProxies = new Map<string, FunctionGroup & Record<string, (params?: Record<string, unknown>) => Promise<unknown>>>();
  private groupDefs = new Map<string, FunctionGroupDef>();

  constructor(config: RegistryConfig) {
    this.config = config;
  }

  /**
   * Register a single function
   *
   * M10: Note that document generation (_updateFunctionDoc) is an async fire-and-forget operation.
   * After register() returns, the document may not yet be written to the virtual file system.
   * Documents will typically be ready within a few hundred milliseconds, but completion at register() return is not guaranteed.
   * If you need to ensure the document is ready, manually call the virtual file system's read and wait.
   *
   * If a function with the same name already exists, a warning is logged and the old definition is replaced.
   */
  register(funcDef: FunctionDef): FunctionDef {
    // Extract group name (if any)
    const parts = funcDef.name.split('.');
    const groupName = parts.length > 1 ? parts[0] : undefined;

    this.registerInternal(funcDef, groupName);
    return funcDef;
  }

  /**
   * Internal registration logic shared by register() and FunctionGroup.
   *
   * @internal For internal use only; external callers should use the register() method.
   */
  registerInternal(funcDef: FunctionDef, groupName?: string): void {
    // Warn on duplicate registration (prevents silent overwrites)
    if (this.functions.has(funcDef.name)) {
      log.warn(`Function '${funcDef.name}' is already registered and will be overwritten.`);
    }

    // Normalize: derive parameters and return schema from zodSchema if not explicitly set
    this._normalizeFunctionDef(funcDef);

    this.functions.set(funcDef.name, funcDef);

    // Auto-generate documentation
    // M10: fire-and-forget, document may be delayed in becoming ready (see comment above)
    void this._updateFunctionDoc(funcDef, groupName);
  }

  /**
   * Normalize a FunctionDef by deriving parameters/return schema from zodSchema when not explicitly set.
   *
   * Ensures all downstream consumers (debugger, default params, markdown generator)
   * can rely on `fn.parameters` and `fn.returns.schema` being populated.
   */
  private _normalizeFunctionDef(funcDef: FunctionDef): void {
    if (!funcDef.parameters && funcDef.zodSchema) {
      try {
        funcDef.parameters = zodToParams(funcDef.zodSchema);
      } catch (err) {
        log.warn(`Failed to convert zodSchema to parameters for ${funcDef.name}:`, err);
      }
    }

    // Also derive return schema from zodSchema if not already set
    if (!funcDef.returns?.schema && funcDef.returns?.zodSchema) {
      try {
        funcDef.returns.schema = zodToOpenAPISchema(funcDef.returns.zodSchema);
      } catch (err) {
        log.warn(`Failed to convert returns.zodSchema for ${funcDef.name}:`, err);
      }
    }
  }

  /**
   * Create a FunctionGroup
   *
   * Returns a Proxy-wrapped FunctionGroup supporting chain calls:
   * rtcAgent.task.list(params) → rtcAgent.execute('task.list', params)
   */
  createGroup(groupDef: FunctionGroupDef): FunctionGroup & Record<string, (params?: Record<string, unknown>) => Promise<unknown>> {
    if (this.groups.has(groupDef.name)) {
      throw new Error(`FunctionGroup already exists: ${groupDef.name}`);
    }

    const group = new FunctionGroup(this, groupDef);
    const proxy = group.createProxy();
    this.groups.set(groupDef.name, group);
    this.groupProxies.set(groupDef.name, proxy);
    this.groupDefs.set(groupDef.name, groupDef);

    return proxy;
  }

  /**
   * Unregister a function
   *
   * Removes the function definition from memory, deletes the document in the virtual file system, and updates the index.
   *
   * MD9: Design rationale for unregister being async while register is sync:
   * - register only updates the in-memory Map (synchronous operation); document generation is background fire-and-forget
   * - unregister needs to delete document files in the virtual file system and update the index, which are I/O operations
   * - Callers typically need to confirm file system cleanup after unregister completes, so unregister returns a Promise
   */
  async unregister(name: string): Promise<void> {
    const funcDef = this.functions.get(name);
    if (!funcDef) {
      return; // Does not exist, return directly
    }

    // Remove from memory
    this.functions.delete(name);

    // Delete document file
    const parts = name.split('.');
    const groupName = parts.length > 1 ? parts[0] : undefined;
    const docPath = groupName
      ? `/functions/${groupName}/${parts[1]}.md`
      : `/functions/${name}.md`;

    try {
      await virtualFS.remove(docPath);
    } catch (err) {
      // File may not exist, ignore error
      log.warn(`Failed to remove doc file ${docPath}:`, err);
    }

    // Update index
    await this._updateFunctionsIndex();
    await this._updateAgentMd();
  }

  /**
   * Resolve a function path
   */
  resolve(path: string): FunctionDef | undefined {
    return this.functions.get(path);
  }

  /**
   * List all functions
   */
  listFunctions(): FunctionDef[] {
    return Array.from(this.functions.values());
  }

  /**
   * List all groups
   */
  listGroups(): FunctionGroupDef[] {
    return Array.from(this.groupDefs.values());
  }

  /**
   * Regenerate all documents (used after database initialization)
   *
   * Solves timing issue: when register() is called before database initialization, document writes will fail.
   * After database initialization completes, call this method to regenerate all documents.
   *
   * Should use generateAllDocsContent() + WorkerBridge.batchWriteFiles()
   */
  async regenerateAllDocs(): Promise<void> {
    try {
      // Regenerate all function documents
      for (const funcDef of this.functions.values()) {
        const parts = funcDef.name.split('.');
        const groupName = parts.length > 1 ? parts[0] : undefined;
        await this._updateFunctionDoc(funcDef, groupName);
      }

      // Update functions index
      await this._updateFunctionsIndex();

      // Update scenarios index (scenarios are managed by scenario-loader, only the index is updated here)
      await this._updateScenariosIndex();

      // Update AGENT.md
      await this._updateAgentMd();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.config.onError) {
        this.config.onError(error, 'Failed to regenerate all docs');
      } else {
        log.error('Failed to regenerate all docs:', err);
      }
    }
  }

  /**
   * Generate all document content (without writing to VirtualFS), and calculate orphan paths to delete
   *
   * Usage: main thread generates content, sends it to Worker via WorkerBridge.batchWriteFiles() for writing.
   * Also queries existing function documents in VFS to calculate orphan paths that are no longer registered, and passes them to Worker for deletion.
   *
   * @param scenarioCount Number of scenarios (used for generating AGENT.md)
   * @returns files: list of files to write, deletePaths: orphan paths to delete
   */
  async generateAllDocsContent(scenarioCount = 0): Promise<{
    files: Array<{path: string; content: string}>;
    deletePaths: string[];
  }> {
    const files: Array<{path: string; content: string}> = [];

    // Generate all function documents
    const currentDocPaths = new Set<string>();
    for (const funcDef of this.functions.values()) {
      const parts = funcDef.name.split('.');
      const groupName = parts.length > 1 ? parts[0] : undefined;
      const md = generateFunctionMd(funcDef, groupName);
      const path = groupName
        ? `/functions/${groupName}/${funcDef.name.split('.')[1]}.md`
        : `/functions/${funcDef.name}.md`;
      files.push({path, content: md});
      currentDocPaths.add(path);
    }

    // Generate functions index
    const functions = this.listFunctions();
    const groups = this.listGroups();
    const indexPath = '/functions/INDEX.md';
    files.push({
      path: indexPath,
      content: generateFunctionsIndex(functions, groups),
    });

    // Generate AGENT.md
    files.push({
      path: '/AGENT.md',
      content: generateAgentMd(this.config, functions, groups, scenarioCount),
    });

    // Calculate orphan paths: function documents already in VFS that are not in the current registration list
    let deletePaths: string[] = [];
    try {
      const existingFiles = await virtualFS.find('**', '/functions/');
      deletePaths = existingFiles.filter(p =>
        p !== indexPath && !currentDocPaths.has(p)
      );
      if (deletePaths.length > 0) {
        log.info('Found orphan function docs to delete:', deletePaths);
      }
    } catch (err) {
      log.warn('Failed to query existing function docs for reconciliation:', err);
    }

    return { files, deletePaths };
  }

  /**
   * Execute a function
   *
   * Uses event-driven architecture, does not directly invoke UI:
   * - Emits function:start/success/error/progress events
   * - UI layer listens to events and handles them
   *
   * CancelledError handling:
   * - CancelledError thrown by onStart does not trigger onError
   *
   * M11: onSuccess uses fire-and-forget, no ordering guarantee with eventBus.emit('function:success').
   *      onSuccess may complete before or after the function:success event.
   *     For strict ordering, use event listeners instead of hooks.
   */
  async execute(path: string, params: Record<string, unknown>): Promise<unknown> {
    const funcDef = this.resolve(path);
    if (!funcDef) {
      throw new Error(`Function not found: ${path}`);
    }

    // Parameter validation: prefer zodSchema, otherwise generate from parameters
    const validator = buildValidator(funcDef.zodSchema, funcDef.parameters);
    if (validator) {
      const validation = validateParams(validator, params);
      if (!validation.success) {
        // Parse group name and function name
        const parts = path.split('.');
        const groupName = parts.length > 1 ? parts[0] : 'global';
        const funcName = parts.length > 1 ? parts[1] : parts[0];
        const errorMsg = formatValidationError(groupName, funcName, validation.errors!);
        throw new Error(errorMsg);
      }
      // Use validated data (may contain default values)
      params = validation.data!;
    }

    // Emit start event first, then call onStart hook.
    // UI layer can receive notification first (e.g., show loading), then onStart may show a confirmation dialog, etc.
    const startEvent: FunctionStartEvent = { path, params };
    eventBus.emit('function:start', startEvent);

    // Use user-defined hooks
    const hooks = funcDef.hooks || {};

    // onStart handled separately; CancelledError is thrown directly without triggering onError
    if (hooks.onStart) {
      await hooks.onStart(params);
    }

    // Main execution logic
    try {
      // Create progress callback, emit progress events
      const onProgress = async (progress: number) => {
        const progressEvent: FunctionProgressEvent = { path, progress };
        eventBus.emit('function:progress', progressEvent);

        if (hooks.onProgress) {
          await hooks.onProgress(progress);
        }
      };

      // Execute handler
      const result = await funcDef.handler(params, onProgress);

      // onSuccess uses fire-and-forget, does not block main flow
      if (hooks.onSuccess) {
        Promise.resolve()
          .then(() => hooks.onSuccess!(result))
          .catch(err => {
            log.error(` onSuccess hook failed for ${path}:`, err);
          });
      }

      // Emit success event
      const successEvent: FunctionSuccessEvent = { path, result };
      eventBus.emit('function:success', successEvent);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // onError uses fire-and-forget, does not block main flow
      if (hooks.onError) {
        Promise.resolve()
          .then(() => hooks.onError!(err))
          .catch(hookErr => {
            log.error(` onError hook failed for ${path}:`, hookErr);
          });
      }

      // Emit error event
      const errorEvent: FunctionErrorEvent = { path, error: err };
      eventBus.emit('function:error', errorEvent);

      throw error;
    }
  }

  /**
   * Write a scenario
   *
   * m8: scenario.id field is ignored; filename is always generated from title slug.
   * Reason: virtual file system paths are based on title slug; id is only used for database indexing.
   * scenario.id is used for unique identification in scenario-loader's manifest, but does not affect file storage path.
   *
   * Write strategy: uses 'create-new' mode; does not overwrite if file already exists (protects user-edited content)
   */
  async writeScenario(scenario: ScenarioDef): Promise<void> {
    // Generate filename (use title's slug version)
    const slug = this._slugify(scenario.title);
    const filename = `${slug}.md`;
    const path = `/scenarios/${filename}`;

    // Generate markdown content (including frontmatter)
    let content = '---\n';
    content += `title: "${scenario.title}"\n`;
    if (scenario.tags && scenario.tags.length > 0) {
      content += `tags: [${scenario.tags.map(t => `"${t}"`).join(', ')}]\n`;
    }
    content += '---\n\n';
    content += scenario.content;

    // Use 'create-new' mode: do not overwrite if file already exists
    await virtualFS.write(path, content, 'create-new');

    // Update index
    await this._updateScenariosIndex();
  }

  /**
   * Update function documentation
   */
  private async _updateFunctionDoc(funcDef: FunctionDef, groupName?: string): Promise<void> {
    try {
      // Generate single function document
      const md = generateFunctionMd(funcDef, groupName);
      const path = groupName
        ? `/functions/${groupName}/${funcDef.name.split('.')[1]}.md`
        : `/functions/${funcDef.name}.md`;

      await virtualFS.write(path, md, 'overwrite');

      // Update INDEX.md
      await this._updateFunctionsIndex();

      // Update AGENT.md
      await this._updateAgentMd();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // When the database has not been initialized yet, document writes will inevitably fail —
      // this is an expected timing issue; regenerateAllDocs() will regenerate after the database is ready, no need to report error.
      if (error.message.includes('getDatabase() called without a name')) {
        return;
      }
      if (this.config.onError) {
        this.config.onError(error, `Failed to update documentation for function: ${funcDef.name}`);
      } else {
        log.error(`Failed to update documentation for ${funcDef.name}:`, err);
      }
    }
  }

  /**
   * Update Functions index
   *
   * Write strategy: uses 'overwrite' mode (index file is always up to date)
   */
  private async _updateFunctionsIndex(): Promise<void> {
    const functions = this.listFunctions();
    const groups = this.listGroups();
    const md = generateFunctionsIndex(functions, groups);
    // Index file is always overwritten to keep it up to date
    await virtualFS.write('/functions/INDEX.md', md, 'overwrite');
  }

  /**
   * Update Scenarios index
   *
   * Write strategy: uses 'overwrite' mode (index file is always up to date)
   */
  private async _updateScenariosIndex(): Promise<void> {
    // Query all scenario files
    const scenarios = await virtualFS.queryByType('scenario');

    // Use the shared function from markdown-generator (static import, already imported at file top)
    const md = generateScenariosIndex(scenarios);

    // Index file is always overwritten to keep it up to date
    await virtualFS.write('/scenarios/INDEX.md', md, 'overwrite');

    // Update AGENT.md
    await this._updateAgentMd();
  }

  /**
   * Update AGENT.md
   *
   * Write strategy: uses 'overwrite' mode (AGENT.md is auto-generated and must always reflect
   * the current registry state; user edits are not expected here — use scenarios for customization)
   */
  private async _updateAgentMd(): Promise<void> {
    const functions = this.listFunctions();
    const groups = this.listGroups();
    const scenarios = await virtualFS.queryByType('scenario');

    const md = generateAgentMd(this.config, functions, groups, scenarios.length);
    // Use 'overwrite' mode: AGENT.md is always regenerated to stay consistent with registry
    await virtualFS.write('/AGENT.md', md, 'overwrite');
  }

  /**
   * Convert string to slug
   *
   * Supports CJK characters (Chinese, Japanese, Korean)
   * If the result is empty, uses timestamp + random number
   *
   * MD10: slug is truncated to 100 characters to avoid overly long filenames
   */
  private _slugify(text: string): string {
    // Defense-in-depth: reject path separators and traversal sequences before normalization
    const sanitized = text.replace(/[/\\]/g, '').replace(/\.\./g, '');

    // Support Unicode characters (including CJK)
    let slug = sanitized
      .toLowerCase()
      // Keep letters, numbers, spaces, hyphens, and CJK characters
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    // MD10: Truncate to 100 characters
    if (slug.length > 100) {
      slug = slug.slice(0, 100).replace(/-+$/, '');
    }

    // If result is empty (pure special characters), use timestamp + random number
    if (!slug) {
      return `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    return slug;
  }

  /**
   * M12: Support chain calls via Proxy: rtcAgent.user.register(params)
   *
   * Uses whitelist to expose methods, without exposing private properties like functions/groups
   */
  createProxy(): FunctionRegistry & Record<string, FunctionGroup> {
    const registry = this;

    // M12: Whitelist - only expose these methods and properties
    const PUBLIC_METHODS = new Set([
      'register',
      'createGroup',
      'unregister',
      'resolve',
      'listFunctions',
      'listGroups',
      'execute',
      'writeScenario',
      'createProxy',
      'regenerateAllDocs',
      'generateAllDocsContent',
    ]);

    return new Proxy(this, {
      get(target, prop: string | symbol) {
        // Handle Symbol properties
        if (typeof prop === 'symbol') {
          return (target as Record<symbol, unknown>)[prop];
        }

        // M12: Only expose whitelisted methods
        if (PUBLIC_METHODS.has(prop)) {
          const value = (target as Record<string, unknown>)[prop];
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }

        // Otherwise try to return group proxy (supports chain calls)
        const groupProxy = registry.groupProxies.get(prop);
        if (groupProxy) {
          return groupProxy;
        }

        // Unknown property: log a warning to help debug typos or missing registrations
        log.warn(`'${prop}' is not a registered function group or public method. Available groups: ${Array.from(registry.groupProxies.keys()).join(', ')}`);
        return undefined;
      },
    }) as unknown as FunctionRegistry & Record<string, FunctionGroup>;
  }
}

/**
 * Create global Registry
 *
 * Automatically registers the built-in system tool group (delay/uuid/now/random/time),
 * allowing scripts to access commonly used platform APIs sandboxed via rtcAgent.system.*.
 */
export function defineRegistry(config: RegistryConfig): FunctionRegistry & Record<string, FunctionGroup> {
  const registry = new FunctionRegistry(config);
  registerBuiltinSystemGroup(registry);
  return registry.createProxy();
}
