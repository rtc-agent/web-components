/**
 * Skill Controller
 *
 * Lightweight ReactiveController that manages integration between the Skill system and components
 *
 * Responsibilities:
 * - Holds a FunctionRegistry instance reference
 * - Subscribes to eventBus events to drive UI updates (toast, confirm)
 * - Exposes actions to the host application
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { FunctionRegistry } from '../core/function-registry.js';
import { eventBus } from '../core/event-bus.js';
import type { SkillContextValue } from '../contexts/skill.js';
import { toolRegistry, virtualFS } from '@rtc-agent/persistence';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('SkillController');

/**
 * SkillController actions
 */
export interface SkillActions {
  /** Get FunctionRegistry instance */
  getRegistry(): FunctionRegistry | null;
  /** Set FunctionRegistry instance (called by host application) */
  setRegistry(registry: FunctionRegistry): void;
}

/**
 * SkillController configuration
 */
export interface SkillControllerConfig {
  /** Toast callback (injected by components) */
  onToast?: (message: string, type: 'info' | 'success' | 'error') => void;
  /** Confirm request callback (injected by components) */
  onConfirmRequest?: (requestId: string, path: string, message: string) => void;
}

/**
 * SkillController
 *
 * Manages integration between the Skill system and components
 */
export class SkillController implements ReactiveController {
  private _host: ReactiveControllerHost;
  private _registry: FunctionRegistry | null = null;
  private _config: SkillControllerConfig = {};

  /** Event unsubscribe functions */
  private _unsubscribes: Array<() => void> = [];

  constructor(host: ReactiveControllerHost, config?: SkillControllerConfig) {
    this._host = host;
    this._config = config || {};
    host.addController(this);
  }

  /**
   * Current state (for Context use)
   */
  get value(): SkillContextValue {
    return {
      registry: this._registry,
    };
  }

  /**
   * Actions (for host application to call)
   */
  get actions(): SkillActions {
    return {
      getRegistry: () => this._registry,
      setRegistry: (registry: FunctionRegistry) => {
        this._registry = registry;
        this._host.requestUpdate();

        // Automatically create rtcAgentAPI Proxy and inject into ToolRegistry
        // Allows script tool's eval to call registered functions
        this._bridgeToolRegistry(registry);
      },
    };
  }

  /**
   * Create rtcAgentAPI Proxy and inject into ToolRegistry
   *
   * This method bridges FunctionRegistry and ToolRegistry:
   * - callFunction/readFile/writeFile/listDir map to registry.execute and virtualFS
   * - Proxy's get trap forwards to registry's group proxy, supporting chain calls (rtcAgent.task.create())
   */
  private _bridgeToolRegistry(registry: FunctionRegistry): void {
    const rtcAgentAPI = new Proxy({
      callFunction: (path: string, params: Record<string, unknown>) => registry.execute(path, params),
      readFile: (path: string) => virtualFS.read(path),
      writeFile: (path: string, content: string) => virtualFS.write(path, content).then(() => {}),
      listDir: (path: string) => virtualFS.ls(path),
    }, {
      get(target, prop) {
        // Prefer returning API methods
        if (prop in target) return (target as Record<string, unknown>)[prop as string];
        // Otherwise forward to registry (get group proxy)
        return (registry as unknown as Record<string | symbol, unknown>)[prop];
      }
    });

    toolRegistry.setRtcAgent(rtcAgentAPI);
    log.info('rtcAgent API bridged to ToolRegistry');
  }

  /**
   * Set configuration (for deferred callback injection)
   */
  setConfig(config: SkillControllerConfig): void {
    this._config = config;
  }

  /**
   * ReactiveController: host connected
   */
  hostConnected(): void {
    // Subscribe to eventBus events
    this._subscribeEvents();
  }

  /**
   * ReactiveController: host disconnected
   */
  hostDisconnected(): void {
    // Unsubscribe all
    for (const unsub of this._unsubscribes) {
      unsub();
    }
    this._unsubscribes = [];
  }

  /**
   * Subscribe to eventBus events
   */
  private _subscribeEvents(): void {
    // Guard: unsubscribe previous listeners before re-subscribing.
    // Without this, disconnect → reconnect cycles accumulate duplicate handlers.
    for (const unsub of this._unsubscribes) {
      unsub();
    }
    this._unsubscribes = [];

    // Subscribe to ui:toast event
    const unsubToast = eventBus.on('ui:toast', (event: { message: string; type: string }) => {
      if (this._config.onToast) {
        this._config.onToast(event.message, event.type as 'info' | 'success' | 'error');
      }
    });
    this._unsubscribes.push(unsubToast);

    // Subscribe to ui:confirm-request event
    const unsubConfirm = eventBus.on('ui:confirm-request', (event: { requestId: string; path: string; message: string }) => {
      if (this._config.onConfirmRequest) {
        this._config.onConfirmRequest(event.requestId, event.path, event.message);
      }
    });
    this._unsubscribes.push(unsubConfirm);
  }

  /**
   * Respond to confirm request (called by components)
   */
  respondToConfirm(requestId: string, confirmed: boolean): void {
    eventBus.emit('ui:confirm-response', { requestId, confirmed });
  }
}
