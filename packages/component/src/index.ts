/**
 * RTC Agent Component Library
 *
 * Public API — only <rtc-agent> is exported.
 * Internal components are registered as side-effects and not exported.
 */
export {RtcAgent} from './components/rtc-agent/rtc-agent.js';

// ===== Host Integration (Recommended Entry Points) =====

/**
 * 等待组件模块加载并初始化完成（ES module 风格的 ready 信号）
 *
 * @example
 * ```ts
 * import { whenReady } from '@rtc-agent/component';
 * await whenReady();
 * const agent = document.querySelector<RtcAgent>('#agent')!;
 * agent.agentConfig = { persona: '...', functions: [...] };
 * ```
 */
export {whenReady} from './core/ready.js';

/**
 * 国际化 API — 运行时切换语言
 *
 * @example
 * ```ts
 * import { switchLocale, getLocale } from '@rtc-agent/component';
 * await switchLocale('en-US');
 * console.log(getLocale()); // 'en-US'
 * ```
 */
export {
  switchLocale,
  initLocale,
  getLocale,
  persistLocale,
  sourceLocale,
  targetLocales,
  localeContext,
  isValidLocale,
} from './core/i18n.js';
export type { SupportedLocale, LocaleContextValue } from './core/i18n.js';

/**
 * 主题 API — 运行时切换主题
 *
 * @example
 * ```ts
 * import { switchTheme, getEffectiveTheme } from '@rtc-agent/component';
 * switchTheme('dark');
 * console.log(getEffectiveTheme()); // 'dark'
 * ```
 */
export {
  switchTheme,
  initTheme,
  getEffectiveTheme,
  getStoredTheme,
  persistTheme,
} from './core/theme.js';
export type { Theme } from './core/theme.js';

/**
 * Agent 声明式配置类型
 *
 * 用于 <rtc-agent>.agentConfig 属性 —— 宿主应用的主要集成方式。
 * 无需了解内部的 FunctionRegistry / toolRegistry 等概念。
 */
export type {AgentConfig, AgentFunctionGroup} from './types/agent-config.js';

/**
 * 组件事件 detail 类型映射（用于 TypeScript 类型安全的 addEventListener）
 *
 * 通过全局扩展 HTMLElementEventMap 生效，document.querySelector('rtc-agent')
 * 返回的 RtcAgent 实例自动获得 rtc-agent-ready 事件的类型提示。
 */
export type {RtcAgentEventDetailMap} from './types/events.js';

/**
 * 全局类型扩展（HTMLElementTagNameMap 等）
 *
 * 导入此模块后，document.querySelector('rtc-agent') 自动返回 RtcAgent 类型。
 * 通常无需显式导入 —— 主入口已包含此扩展。
 */
import './elements.js';

/**
 * 工厂函数 — 声明式创建 <rtc-agent> 实例
 *
 * @example
 * ```ts
 * import { createRtcAgent } from '@rtc-agent/component';
 *
 * const agent = createRtcAgent({
 *   appLabel: 'My Assistant',
 *   auth: { accessToken: '...', userId: 'user-123' },
 * });
 * document.body.appendChild(agent);
 * ```
 */
export { createRtcAgent } from './factory.js';
export type {
    RtcAgentConfig,
    RtcAgentWithLifecycle,
    AuthConfig,
    StaticTokenAuth,
    DynamicTokenAuth,
    AuthProvider,
    EventCallbacks,
} from './types/factory.js';

/**
 * Session and Message types
 *
 * Needed for EventCallbacks — consumers use these to type callback parameters.
 */
export type { Session, Message } from './types/index.js';

/**
 * ConnectionState type
 *
 * Used by the `connectionStateChange` callback in EventCallbacks.
 */
export type { ConnectionState } from '@rtc-agent/client';

/**
 * Window and ActivityBar configuration types
 *
 * Used by `RtcAgentConfig.window` and `RtcAgentConfig.activityBar`.
 */
export type { WindowConfig } from './types/window-config.js';
export type { ActivityBarConfig } from './types/activity-bar-config.js';

// ===== Skill System (Advanced API) =====

export { defineRegistry, FunctionRegistry, FunctionGroup } from './core/function-registry.js';
export { loadScenariosFromURL, loadScenariosContent, parseFrontmatter } from './core/scenario-loader.js';
export { generateFunctionMd, generateFunctionsIndex, generateScenariosIndex, generateAgentMd } from './core/markdown-generator.js';
export { EventBus, eventBus, createEventBus } from './core/event-bus.js';
export type { EventHandler, DefaultEventMap, FunctionRegistryEventMap } from './core/event-bus.js';
export { SkillController } from './controllers/skill.controller.js';
export type { SkillActions, SkillControllerConfig } from './controllers/skill.controller.js';
export { SkillContext, DEFAULT_SKILL_STATE } from './contexts/skill.js';
export type { SkillContextValue } from './contexts/skill.js';

// Skill Types
export type {
    OpenAPISchema,
    ParameterDef,
    ReturnDef,
    VisualHooks,
    FunctionDef,
    FunctionGroupDef,
    RegistryConfig,
    ScenarioDef,
    ScenarioManifest,
} from './types/skill.js';

// Skill Classes
export { CancelledError } from './types/skill.js';

// Event Types
export type {
    FunctionStartEvent,
    FunctionSuccessEvent,
    FunctionErrorEvent,
    FunctionProgressEvent,
} from './core/event-bus.js';

// ===== Validation (Zod Integration) =====

export {
    z,
    validateParams,
    formatValidationError,
    buildValidator,
    withValidation,
    zodToParams,
    openApiToZod,
    withMeta,
} from './validation/index.js';
export type {
    ValidationError,
    ValidationResult,
} from './validation/index.js';
