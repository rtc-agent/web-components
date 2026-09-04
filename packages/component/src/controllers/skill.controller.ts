/**
 * Skill Controller
 *
 * 轻量级 ReactiveController，管理 Skill 系统与组件的集成
 *
 * 职责：
 * - 持有 FunctionRegistry 实例引用
 * - 订阅 eventBus 事件，驱动 UI 更新（toast、confirm）
 * - 暴露 actions 给宿主应用
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { FunctionRegistry } from '../core/function-registry.js';
import { eventBus } from '../core/event-bus.js';
import type { SkillContextValue } from '../contexts/skill.js';
import { toolRegistry, virtualFS } from '@rtc-agent/persistence';

/**
 * SkillController actions
 */
export interface SkillActions {
  /** 获取 FunctionRegistry 实例 */
  getRegistry(): FunctionRegistry | null;
  /** 设置 FunctionRegistry 实例（宿主应用调用） */
  setRegistry(registry: FunctionRegistry): void;
}

/**
 * SkillController 配置
 */
export interface SkillControllerConfig {
  /** Toast 回调（由组件注入） */
  onToast?: (message: string, type: 'info' | 'success' | 'error') => void;
  /** 确认请求回调（由组件注入） */
  onConfirmRequest?: (requestId: string, path: string, message: string) => void;
}

/**
 * SkillController
 *
 * 管理 Skill 系统与组件的集成
 */
export class SkillController implements ReactiveController {
  private _host: ReactiveControllerHost;
  private _registry: FunctionRegistry | null = null;
  private _config: SkillControllerConfig = {};

  /** 事件取消订阅函数 */
  private _unsubscribes: Array<() => void> = [];

  constructor(host: ReactiveControllerHost, config?: SkillControllerConfig) {
    this._host = host;
    this._config = config || {};
    host.addController(this);
  }

  /**
   * 当前状态（供 Context 使用）
   */
  get value(): SkillContextValue {
    return {
      registry: this._registry,
    };
  }

  /**
   * Actions（供宿主应用调用）
   */
  get actions(): SkillActions {
    return {
      getRegistry: () => this._registry,
      setRegistry: (registry: FunctionRegistry) => {
        this._registry = registry;
        this._host.requestUpdate();

        // 自动创建 rtcAgentAPI Proxy 并注入 ToolRegistry
        // 让 script 工具的 eval 能调用已注册的 function
        this._bridgeToolRegistry(registry);
      },
    };
  }

  /**
   * 创建 rtcAgentAPI Proxy 并注入 ToolRegistry
   *
   * 此方法将 FunctionRegistry 与 ToolRegistry 桥接：
   * - callFunction/readFile/writeFile/listDir 映射到 registry.execute 和 virtualFS
   * - Proxy 的 get trap 转发到 registry 的 group proxy，支持链式调用（rtcAgent.task.create()）
   */
  private _bridgeToolRegistry(registry: FunctionRegistry): void {
    const rtcAgentAPI = new Proxy({
      callFunction: (path: string, params: Record<string, unknown>) => registry.execute(path, params),
      readFile: (path: string) => virtualFS.read(path),
      writeFile: (path: string, content: string) => virtualFS.write(path, content).then(() => {}),
      listDir: (path: string) => virtualFS.ls(path),
    }, {
      get(target, prop) {
        // 优先返回 API 方法
        if (prop in target) return (target as Record<string, unknown>)[prop as string];
        // 否则转发到 registry（获取 group proxy）
        return (registry as unknown as Record<string | symbol, unknown>)[prop];
      }
    });

    toolRegistry.setRtcAgent(rtcAgentAPI);
    console.log('[SkillController] rtcAgent API bridged to ToolRegistry');
  }

  /**
   * 设置配置（用于延迟注入回调）
   */
  setConfig(config: SkillControllerConfig): void {
    this._config = config;
  }

  /**
   * ReactiveController: host connected
   */
  hostConnected(): void {
    // 订阅 eventBus 事件
    this._subscribeEvents();
  }

  /**
   * ReactiveController: host disconnected
   */
  hostDisconnected(): void {
    // 取消所有订阅
    for (const unsub of this._unsubscribes) {
      unsub();
    }
    this._unsubscribes = [];
  }

  /**
   * 订阅 eventBus 事件
   */
  private _subscribeEvents(): void {
    // 订阅 ui:toast 事件
    const unsubToast = eventBus.on('ui:toast', (event: { message: string; type: string }) => {
      if (this._config.onToast) {
        this._config.onToast(event.message, event.type as 'info' | 'success' | 'error');
      }
    });
    this._unsubscribes.push(unsubToast);

    // 订阅 ui:confirm-request 事件
    const unsubConfirm = eventBus.on('ui:confirm-request', (event: { requestId: string; path: string; message: string }) => {
      if (this._config.onConfirmRequest) {
        this._config.onConfirmRequest(event.requestId, event.path, event.message);
      }
    });
    this._unsubscribes.push(unsubConfirm);
  }

  /**
   * 响应确认请求（由组件调用）
   */
  respondToConfirm(requestId: string, confirmed: boolean): void {
    eventBus.emit('ui:confirm-response', { requestId, confirmed });
  }
}
