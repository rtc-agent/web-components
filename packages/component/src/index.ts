/**
 * RTC Agent Component Library
 *
 * Public API — only <rtc-agent> is exported.
 * Internal components are registered as side-effects and not exported.
 */
export { RtcAgent } from './components/rtc-agent/rtc-agent.js';

// ===== Host Integration (Recommended Entry Points) =====

export type { LocaleContextValue, SupportedLocale } from './core/i18n.js';

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
  getLocale,
  initLocale,
  isValidLocale,
  localeContext,
  persistLocale,
  sourceLocale,
  switchLocale,
  targetLocales,
} from './core/i18n.js';
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
export { whenReady } from './core/ready.js';
export type { Theme } from './core/theme.js';
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
  getEffectiveTheme,
  getStoredTheme,
  initTheme,
  persistTheme,
  switchTheme,
} from './core/theme.js';

/**
 * Agent declarative configuration types
 *
 * Used for the <rtc-agent>.agentConfig property -- the primary integration method for host applications.
 * No need to understand internal concepts like FunctionRegistry / toolRegistry.
 */
export type { AgentConfig, AgentFunctionGroup } from './types/agent-config.js';

/**
 * Component event detail type mapping (for TypeScript type-safe addEventListener)
 *
 * Works via global extension of HTMLElementEventMap; the RtcAgent instance returned by
 * document.querySelector('rtc-agent') automatically gets type hints for the rtc-agent-ready event.
 */
export type { RtcAgentEventDetailMap } from './types/events.js';

/**
 * Global type extensions (HTMLElementTagNameMap, etc.)
 *
 * After importing this module, document.querySelector('rtc-agent') automatically returns the RtcAgent type.
 * Usually no explicit import is needed -- the main entry already includes this extension.
 */
import './elements.js';

/**
 * ConnectionState type
 *
 * Used by the `connectionStateChange` callback in EventCallbacks.
 */
export type { ConnectionState } from '@rtc-agent/client';
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
  Activity,
  ActivityBarConfig,
  ResolvedActivityBarConfig,
} from './types/activity-bar-config.js';
export {
  DEFAULT_ACTIVITY_BAR_CONFIG,
  resolveActivityBarConfig,
} from './types/activity-bar-config.js';
export type {
  AuthConfig,
  AuthProvider,
  EventCallbacks,
  ExchangeTokenHint,
  RtcAgentConfig,
  RtcAgentWithLifecycle,
} from './types/factory.js';
/**
 * Session and Message types
 *
 * Needed for EventCallbacks — consumers use these to type callback parameters.
 */
export type { Message, Session } from './types/index.js';
/**
 * Window and ActivityBar configuration types
 *
 * Used by `RtcAgentConfig.window` and `RtcAgentConfig.activityBar`.
 */
export type { WindowConfig } from './types/window-config.js';

// ===== Skill System (Advanced API) =====

export type { SkillContextValue } from './contexts/skill.js';
export { DEFAULT_SKILL_STATE, SkillContext } from './contexts/skill.js';
export type {
  SkillActions,
  SkillControllerConfig,
} from './controllers/skill.controller.js';
export { SkillController } from './controllers/skill.controller.js';
// Event Types
export type {
  DefaultEventMap,
  EventHandler,
  FunctionErrorEvent,
  FunctionProgressEvent,
  FunctionRegistryEventMap,
  FunctionStartEvent,
  FunctionSuccessEvent,
} from './core/event-bus.js';
export { createEventBus, EventBus, eventBus } from './core/event-bus.js';
export {
  defineRegistry,
  FunctionGroup,
  FunctionRegistry,
} from './core/function-registry.js';
export {
  generateAgentMd,
  generateFunctionMd,
  generateFunctionsIndex,
  generateScenariosIndex,
} from './core/markdown-generator.js';
export {
  loadScenariosContent,
  loadScenariosFromURL,
  parseFrontmatter,
} from './core/scenario-loader.js';
// Skill Types
export type {
  FunctionDef,
  FunctionGroupDef,
  OpenAPISchema,
  ParameterDef,
  RegistryConfig,
  ReturnDef,
  ScenarioDef,
  ScenarioManifest,
  VisualHooks,
} from './types/skill.js';
// Skill Classes
export { CancelledError } from './types/skill.js';

// ===== Validation (Zod Integration) =====

export type {
  ValidationError,
  ValidationResult,
} from './validation/index.js';
export {
  buildValidator,
  formatValidationError,
  openApiToZod,
  validateParams,
  withMeta,
  withValidation,
  z,
  zodToOpenAPISchema,
  zodToParams,
} from './validation/index.js';

// ===== Function Debugger Types =====

export type {
  DebugHistoryItem,
  ExecutionStatus,
  FunctionDebugState,
  HistoryPaginationState,
  LogEntry,
  LogLevel,
} from './types/functions-debug.js';
