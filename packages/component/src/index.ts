/**
 * RTC Agent Component Library
 *
 * Public API — only <rtc-agent> is exported.
 * Internal components are registered as side-effects and not exported.
 */
export {RtcAgent} from './components/rtc-agent/rtc-agent.js';

// ===== Host Integration (Recommended Entry Points) =====

/**
 * Wait for the component module to load and initialize (ES module-style ready signal)
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
 * Internationalization API -- switch language at runtime
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
 * Theme API -- switch theme at runtime
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
 * Agent declarative configuration types
 *
 * Used for the <rtc-agent>.agentConfig property -- the primary integration method for host applications.
 * No need to understand internal concepts like FunctionRegistry / toolRegistry.
 */
export type {AgentConfig, AgentFunctionGroup} from './types/agent-config.js';

/**
 * Component event detail type mapping (for TypeScript type-safe addEventListener)
 *
 * Works via global extension of HTMLElementEventMap; the RtcAgent instance returned by
 * document.querySelector('rtc-agent') automatically gets type hints for the rtc-agent-ready event.
 */
export type {RtcAgentEventDetailMap} from './types/events.js';

/**
 * Global type extensions (HTMLElementTagNameMap, etc.)
 *
 * After importing this module, document.querySelector('rtc-agent') automatically returns the RtcAgent type.
 * Usually no explicit import is needed -- the main entry already includes this extension.
 */
import './elements.js';

/**
 * Factory function -- declaratively create an <rtc-agent> instance
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
