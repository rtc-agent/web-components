/**
 * Function Registry
 *
 * 管理 Function 注册、解析、链式调用
 * 使用 Proxy 实现 rtcAgent.user.register() 语法
 */

import type {
  FunctionDef,
  FunctionGroupDef,
  RegistryConfig,
  ScenarioDef,
  VisualHooks,
} from '../types/skill.js';
import { CancelledError } from '../types/skill.js';
import { virtualFS } from '@rtc-agent/persistence';
import { generateFunctionMd, generateFunctionsIndex, generateAgentMd } from './markdown-generator.js';
import { eventBus, type FunctionStartEvent, type FunctionSuccessEvent, type FunctionErrorEvent, type FunctionProgressEvent } from './event-bus.js';

/**
 * FunctionGroup 实例
 * 支持链式注册和调用
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
   * 注册 Function 到当前 Group
   *
   * @param funcDef Function 定义，name 为必填（Group 内的函数名称，不含 Group 前缀）
   */
  register(funcDef: Omit<FunctionDef, 'name'> & { name: string }): FunctionDef {
    // 生成完整名称：group.name
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
   * 获取 Group 内的所有 Function
   */
  listFunctions(): FunctionDef[] {
    return Array.from(this.functions.values());
  }

  /**
   * 通过 Proxy 支持链式调用：rtcAgent.task.list(params)
   *
   * 白名单方法直接返回，其他属性名视为 Group 内的函数名，
   * 返回一个调用 registry.execute('group.funcName', params) 的函数。
   */
  createProxy(): FunctionGroup & Record<string, (params?: Record<string, unknown>) => Promise<unknown>> {
    const group = this;

    const PUBLIC_METHODS = new Set(['register', 'listFunctions', 'createProxy']);

    return new Proxy(this, {
      get(target, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return (target as Record<symbol, unknown>)[prop];
        }

        // 白名单方法
        if (PUBLIC_METHODS.has(prop)) {
          const value = (target as Record<string, unknown>)[prop];
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }

        // 检查是否是已注册的函数名
        const fullName = `${group.groupName}.${prop}`;
        if (group.functions.has(fullName)) {
          return (params: Record<string, unknown> = {}) => group.registry.execute(fullName, params);
        }

        return undefined;
      },
    }) as unknown as FunctionGroup & Record<string, (params?: Record<string, unknown>) => Promise<unknown>>;
  }
}

/**
 * FunctionRegistry - 全局注册表
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
   * 注册单个 Function
   *
   * M10: 注意，文档生成（_updateFunctionDoc）是异步的 fire-and-forget 操作。
   * register() 返回后，文档可能尚未写入虚拟文件系统。
   * 文档通常会在几百毫秒内就绪，但不保证在 register() 返回时已完成。
   * 如果需要确保文档就绪，请手动调用虚拟文件系统的 read 并等待。
   */
  register(funcDef: FunctionDef): FunctionDef {
    // 提取 group 名称（如果有）
    const parts = funcDef.name.split('.');
    const groupName = parts.length > 1 ? parts[0] : undefined;

    this.functions.set(funcDef.name, funcDef);

    // 自动生成文档
    // M10: fire-and-forget，文档可能延迟就绪（见上方注释）
    void this._updateFunctionDoc(funcDef, groupName);

    return funcDef;
  }

  /**
   * 内部方法：注册 Function（由 FunctionGroup 调用）
   *
   * @internal 仅供内部使用，外部应使用 register() 方法
   *
   * M10: 同 register()，文档生成是异步 fire-and-forget，可能延迟就绪。
   */
  registerInternal(funcDef: FunctionDef, groupName: string): void {
    this.functions.set(funcDef.name, funcDef);

    // 自动生成文档
    void this._updateFunctionDoc(funcDef, groupName);
  }

  /**
   * 创建 FunctionGroup
   *
   * 返回 Proxy 包装的 FunctionGroup，支持链式调用：
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
   * 注销 Function
   *
   * 删除内存中的 Function 定义，同时删除虚拟文件系统中的文档，并更新索引
   *
   * MD9: unregister 是 async 而 register 是 sync 的设计原因：
   * - register 只需更新内存 Map（同步操作），文档生成是后台 fire-and-forget
   * - unregister 需要删除虚拟文件系统中的文档文件并更新索引，这些是 I/O 操作
   * - 调用方通常需要在注销完成后确认文件系统已清理，因此 unregister 返回 Promise
   */
  async unregister(name: string): Promise<void> {
    const funcDef = this.functions.get(name);
    if (!funcDef) {
      return; // 不存在则直接返回
    }

    // 从内存中删除
    this.functions.delete(name);

    // 删除文档文件
    const parts = name.split('.');
    const groupName = parts.length > 1 ? parts[0] : undefined;
    const docPath = groupName
      ? `/functions/${groupName}/${parts[1]}.md`
      : `/functions/${name}.md`;

    try {
      await virtualFS.remove(docPath);
    } catch (err) {
      // 文件可能不存在，忽略错误
      console.warn(`[FunctionRegistry] Failed to remove doc file ${docPath}:`, err);
    }

    // 更新索引
    await this._updateFunctionsIndex();
    await this._updateAgentMd();
  }

  /**
   * 解析 Function 路径
   */
  resolve(path: string): FunctionDef | undefined {
    return this.functions.get(path);
  }

  /**
   * 列出所有 Function
   */
  listFunctions(): FunctionDef[] {
    return Array.from(this.functions.values());
  }

  /**
   * 列出所有 Group
   */
  listGroups(): FunctionGroupDef[] {
    return Array.from(this.groupDefs.values());
  }

  /**
   * 执行 Function
   *
   * 使用事件驱动架构，不直接调用 UI：
   * - 发出 function:start/success/error/progress 事件
   * - UI 层监听事件并处理
   *
   * CancelledError 处理：
   * - onStart 抛出的 CancelledError 不触发 onError
   *
   * M11: onSuccess 使用 fire-and-forget，与 eventBus.emit('function:success') 无顺序保证。
   *      onSuccess 可能在 function:success 事件之前或之后完成。
   *     如需严格顺序，请使用事件监听替代 hook。
   */
  async execute(path: string, params: Record<string, unknown>): Promise<unknown> {
    const funcDef = this.resolve(path);
    if (!funcDef) {
      throw new Error(`Function not found: ${path}`);
    }

    // 先发出 start 事件，再调用 onStart hook。
    // UI 层可以先收到通知（如显示 loading），然后 onStart 可能弹出确认框等。
    const startEvent: FunctionStartEvent = { path, params };
    eventBus.emit('function:start', startEvent);

    // 使用用户自定义 hooks
    const hooks = funcDef.hooks || {};

    // onStart 单独处理，CancelledError 直接抛出，不触发 onError
    if (hooks.onStart) {
      try {
        await hooks.onStart(params);
      } catch (error) {
        throw error;
      }
    }

    // 主执行逻辑
    try {
      // 创建进度回调，发出 progress 事件
      const onProgress = async (progress: number) => {
        const progressEvent: FunctionProgressEvent = { path, progress };
        eventBus.emit('function:progress', progressEvent);

        if (hooks.onProgress) {
          await hooks.onProgress(progress);
        }
      };

      // 执行 handler
      const result = await funcDef.handler(params, onProgress);

      // onSuccess 使用 fire-and-forget，不阻塞主流程
      if (hooks.onSuccess) {
        Promise.resolve()
          .then(() => hooks.onSuccess!(result))
          .catch(err => {
            console.error(`[FunctionRegistry] onSuccess hook failed for ${path}:`, err);
          });
      }

      // 发出 success 事件
      const successEvent: FunctionSuccessEvent = { path, result };
      eventBus.emit('function:success', successEvent);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // onError 使用 fire-and-forget，不阻塞主流程
      if (hooks.onError) {
        Promise.resolve()
          .then(() => hooks.onError!(err))
          .catch(hookErr => {
            console.error(`[FunctionRegistry] onError hook failed for ${path}:`, hookErr);
          });
      }

      // 发出 error 事件
      const errorEvent: FunctionErrorEvent = { path, error: err };
      eventBus.emit('function:error', errorEvent);

      throw error;
    }
  }

  /**
   * 写入 Scenario
   *
   * m8: scenario.id 字段被忽略，文件名始终从 title 生成 slug。
   * 原因：虚拟文件系统的文件路径基于 title slug，id 仅用于数据库索引。
   * scenario.id 在 scenario-loader 的 manifest 中用于唯一标识，但不影响文件存储路径。
   */
  async writeScenario(scenario: ScenarioDef): Promise<void> {
    // 生成文件名（使用 title 的 slug 版本）
    const slug = this._slugify(scenario.title);
    const filename = `${slug}.md`;
    const path = `/scenarios/${filename}`;

    // 生成 markdown 内容（包含 frontmatter）
    let content = '---\n';
    content += `title: "${scenario.title}"\n`;
    if (scenario.tags && scenario.tags.length > 0) {
      content += `tags: [${scenario.tags.map(t => `"${t}"`).join(', ')}]\n`;
    }
    content += '---\n\n';
    content += scenario.content;

    await virtualFS.write(path, content, 'overwrite');

    // 更新索引
    await this._updateScenariosIndex();
  }

  /**
   * 更新 Function 文档
   */
  private async _updateFunctionDoc(funcDef: FunctionDef, groupName?: string): Promise<void> {
    try {
      // 生成单个 Function 文档
      const md = generateFunctionMd(funcDef, groupName);
      const path = groupName
        ? `/functions/${groupName}/${funcDef.name.split('.')[1]}.md`
        : `/functions/${funcDef.name}.md`;

      await virtualFS.write(path, md, 'overwrite');

      // 更新 INDEX.md
      await this._updateFunctionsIndex();

      // 更新 AGENT.md
      await this._updateAgentMd();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.config.onError) {
        this.config.onError(error, `Failed to update documentation for function: ${funcDef.name}`);
      } else {
        console.error(`[FunctionRegistry] Failed to update documentation for ${funcDef.name}:`, err);
      }
    }
  }

  /**
   * 更新 Functions 索引
   */
  private async _updateFunctionsIndex(): Promise<void> {
    const functions = this.listFunctions();
    const groups = this.listGroups();
    const md = generateFunctionsIndex(functions, groups);
    await virtualFS.write('/functions/INDEX.md', md, 'overwrite');
  }

  /**
   * 更新 Scenarios 索引
   */
  private async _updateScenariosIndex(): Promise<void> {
    // 查询所有 scenario 文件
    const scenarios = await virtualFS.queryByType('scenario');

    // 使用 markdown-generator 中的共享函数
    const { generateScenariosIndex } = await import('./markdown-generator.js');
    const md = generateScenariosIndex(scenarios);

    await virtualFS.write('/scenarios/INDEX.md', md, 'overwrite');

    // 更新 AGENT.md
    await this._updateAgentMd();
  }

  /**
   * 更新 AGENT.md
   */
  private async _updateAgentMd(): Promise<void> {
    const functions = this.listFunctions();
    const groups = this.listGroups();
    const scenarios = await virtualFS.queryByType('scenario');

    const md = generateAgentMd(this.config, functions, groups, scenarios.length);
    await virtualFS.write('/AGENT.md', md, 'overwrite');
  }

  /**
   * 字符串转 slug
   *
   * 支持 CJK 字符（中文、日文、韩文）
   * 如果结果为空，则使用时间戳 + 随机数
   *
   * MD10: slug 截断到 100 字符，避免文件名过长
   */
  private _slugify(text: string): string {
    // 支持 Unicode 字符（包括 CJK）
    let slug = text
      .toLowerCase()
      // 保留字母数字、空格、连字符、以及 CJK 字符
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    // MD10: 截断到 100 字符
    if (slug.length > 100) {
      slug = slug.slice(0, 100).replace(/-+$/, '');
    }

    // 如果结果为空（纯特殊字符），使用时间戳 + 随机数
    if (!slug) {
      return `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    return slug;
  }

  /**
   * M12: 通过 Proxy 支持链式调用：rtcAgent.user.register(params)
   *
   * 使用白名单方式暴露方法，不暴露 functions/groups 等私有属性
   */
  createProxy(): FunctionRegistry & Record<string, FunctionGroup> {
    const registry = this;

    // M12: 白名单 - 只暴露这些方法和属性
    const PUBLIC_METHODS = new Set([
      'register',
      'registerInternal',
      'createGroup',
      'unregister',
      'resolve',
      'listFunctions',
      'listGroups',
      'execute',
      'writeScenario',
      'createProxy',
    ]);

    return new Proxy(this, {
      get(target, prop: string | symbol) {
        // 处理 Symbol 属性
        if (typeof prop === 'symbol') {
          return (target as Record<symbol, unknown>)[prop];
        }

        // M12: 只暴露白名单中的方法
        if (PUBLIC_METHODS.has(prop)) {
          const value = (target as Record<string, unknown>)[prop];
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }

        // 否则尝试返回 group proxy（支持链式调用）
        const groupProxy = registry.groupProxies.get(prop);
        if (groupProxy) {
          return groupProxy;
        }

        return undefined;
      },
    }) as unknown as FunctionRegistry & Record<string, FunctionGroup>;
  }
}

/**
 * 创建全局 Registry
 */
export function defineRegistry(config: RegistryConfig): FunctionRegistry & Record<string, FunctionGroup> {
  const registry = new FunctionRegistry(config);
  return registry.createProxy();
}
