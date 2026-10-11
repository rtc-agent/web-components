/**
 * Shared type definitions for the RTC Agent component library.
 *
 * NOTE: These are UI-layer types for rendering. Once @rtc-agent/protocol
 * is fully integrated, import canonical types from there and re-export.
 *
 * MIGRATION PLAN:
 * - UI-layer types (camelCase) are prefixed with "UI" to distinguish from protocol types (snake_case)
 * - New code should use `Session`/`Message` from `@rtc-agent/protocol` for type safety
 * - Legacy UI types are maintained for backward compatibility during migration
 */

// Re-export ContentData and TodoItem from protocol
export type {
  ContentData,
  TodoItem,
  UserMessageContent,
  ScenarioRef,
  FileAttachment,
  PromptContent,
  ToolCall,
} from '@rtc-agent/protocol';
import type { ContentData, TodoItem, ToolCall } from '@rtc-agent/protocol';

// Re-export enum types from protocol (both value and type)
export {
  SessionStatus,
  MessageRole,
  SyncStatus,
  TodoStatus,
} from '@rtc-agent/protocol';
import type {
  SessionStatus,
  MessageRole,
  SyncStatus,
} from '@rtc-agent/protocol';

/* ── Messages ── */

// MessageRole is imported from @rtc-agent/protocol above

/**
 * UI-layer Message type with camelCase fields for frontend rendering.
 * @deprecated For new code, prefer using `Message` from `@rtc-agent/protocol` (snake_case) for type safety.
 * This type is maintained for backward compatibility with existing UI components.
 * Migration: Use `Message` from `@rtc-agent/protocol` and add camelCase conversion layer if needed.
 */
export interface UIMessage {
  clientId: string;
  role: MessageRole;
  content: ContentData;
  timestamp: number;
  /** Is the message still being streamed? */
  streaming?: boolean;
  /** Sync status */
  syncStatus: SyncStatus;
  /**
   * The clientId of the parent message.
   * toolcall_output points to its corresponding toolcall_input via this field.
   * Mapped from the protocol layer's Message.parent_message_id (server UUID -> resolved as client_id).
   */
  parentClientId?: string;
}

/**
 * @deprecated Alias for UIMessage. Use UIMessage instead for clarity.
 */
export type Message = UIMessage;

/* ── Sessions ── */

// SessionStatus is imported from @rtc-agent/protocol above

/**
 * UI-layer Session type with camelCase fields for frontend rendering.
 * @deprecated For new code, prefer using `Session` from `@rtc-agent/protocol` (snake_case) for type safety.
 * This type is maintained for backward compatibility with existing UI components.
 * Migration: Use `Session` from `@rtc-agent/protocol` and add camelCase conversion layer if needed.
 */
export interface UISession {
  clientId: string;
  /** Device ID that created this Session (from JWT Token), used by the frontend to determine RTC request ownership */
  deviceId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  todoList?: TodoItem[];
  /**
   * The clientId of the parent root session (forked child sessions point to their root session).
   * If empty, this session is itself a root session.
   */
  rootClientSessionId?: string;
  /** Session runtime status: active (agent generating) / idle (waiting for input) / closed (terminated) */
  status?: SessionStatus;

  // ── Token Usage (passed through from LocalSession, populated after backend session.updated push) ──

  /** Cumulative net input token count (excluding cached read/write) */
  totalInputTokens?: number;
  /** Cumulative output token count */
  totalOutputTokens?: number;
  /** Cumulative total token count (including all types) */
  totalTokens?: number;
  /** Actual current context token count (rewritten after compression, used for compression progress calculation) */
  currentContextTokens?: number;
  /** Cumulative cache read token count */
  totalCachedReadTokens?: number;
  /** Cumulative cache write token count */
  totalCachedWriteTokens?: number;
  /** Cumulative reasoning token count */
  totalReasoningTokens?: number;
  /** Cumulative cost (USD) */
  totalCostUsd?: number;
  /** Last token stats update time (ISO 8601) */
  lastTokenUpdateAt?: string;

  // ── Token Estimation (real-time computation by backend, pushed via session.updated) ──

  /** Compression trigger threshold (contextTokensLimit - autoCompactBufferTokens) */
  compressionThreshold?: number;
  /** Compression progress (0-100) */
  compressionProgress?: number;
  /** Rounds until compression (-1 means threshold already exceeded) */
  roundsUntilCompression?: number;
  /** Estimated token count for the next round */
  estimatedNextRoundTokens?: number;
}

/**
 * @deprecated Alias for UISession. Use UISession instead for clarity.
 */
export type Session = UISession;

/* ── Session Tree ── */

/**
 * Session tree node (recursive structure)
 *
 * Root sessions serve as "folders"; child sessions (linked via rootClientSessionId)
 * are nested in the children array.
 */
export interface UISessionTreeNode {
  session: UISession;
  children: UISessionTreeNode[];
  isExpanded: boolean;
}

/**
 * @deprecated Alias for UISessionTreeNode. Use UISessionTreeNode instead for clarity.
 */
export type SessionTreeNode = UISessionTreeNode;

export interface UISessionTreeState {
  /** Root node list (sessions with empty rootClientSessionId) */
  rootNodes: UISessionTreeNode[];
}

/**
 * @deprecated Alias for UISessionTreeState. Use UISessionTreeState instead for clarity.
 */
export type SessionTreeState = UISessionTreeState;

export interface UISessionTreeActions {
  /** Toggle node expand/collapse state */
  toggleExpand(sessionId: string): void;
  /** Expand the specified node */
  expand(sessionId: string): void;
  /** Collapse the specified node */
  collapse(sessionId: string): void;
  /** Rebuild the entire tree (called when the session list changes) */
  rebuildTree(sessions: UISession[]): void;
}

/**
 * @deprecated Alias for UISessionTreeActions. Use UISessionTreeActions instead for clarity.
 */
export type SessionTreeActions = UISessionTreeActions;

/* ── Session Tab ── */

/**
 * Session tab
 *
 * Uses sessionId as the unique identifier; only one tab is allowed per session.
 */
export interface UISessionTab {
  /** Session clientId (unique identifier) */
  sessionId: string;
  /** Display title */
  title: string;
  /** Whether the title is a default/placeholder value (empty, "Untitled", "New Chat"). Used for title sync decisions. */
  isDefault?: boolean;
  /** Whether this Session has not been persisted yet (no messages sent). */
  isUnsaved?: boolean;
  /** Session runtime status: active (agent generating) / idle (waiting for input) / closed (terminated) */
  status?: SessionStatus;
  // ── Transient UI params (not persisted, cleared after consumption) ──
  /** Initial value pre-filled into the input area */
  initialInputValue?: string;
  /** Notice message displayed in the notice bar */
  noticeMessage?: string;
  /** Incremented on each setTransientParams call to defend against Lit dirty-check skipping */
  initialValueVersion?: number;
}

/**
 * @deprecated Alias for UISessionTab. Use UISessionTab instead for clarity.
 */
export type SessionTab = UISessionTab;

export interface UISessionTabState {
  /** Open tab list (order matches display order) */
  tabs: UISessionTab[];
  /** Currently active tab's sessionId */
  activeSessionId: string | null;
}

/**
 * @deprecated Alias for UISessionTabState. Use UISessionTabState instead for clarity.
 */
export type SessionTabState = UISessionTabState;

export interface UISessionTabActions {
  /** Open or switch to a tab for the specified session. `options.isUnsaved` is for creating a new unsaved draft tab. `options.skipPersist` is for skipping localStorage writes during bulk restore. `options.initialInputValue` / `options.noticeMessage` are for passing transient UI params. */
  openOrActivate(
    sessionId: string,
    title: string,
    options?: {
      isUnsaved?: boolean;
      activate?: boolean;
      skipPersist?: boolean;
      initialInputValue?: string;
      noticeMessage?: string;
    },
  ): void;
  /** Close the specified tab. If closing the active tab, automatically activates an adjacent tab. */
  closeTab(sessionId: string): void;
  /** Set the active tab */
  setActiveTab(sessionId: string | null): void;
  /** Clear all tabs */
  clearAll(): void;
  /** Sync existing Tab titles with the latest titles from sessions */
  updateTabTitles(sessionTitleMap: Map<string, string>): void;
  /** Sync existing Tab statuses with the latest statuses from sessions */
  syncTabStatuses(sessionStatusMap: Map<string, SessionStatus>): void;
  /** Mark the specified tab as saved. */
  markSaved(sessionId: string): void;
  /** Find the current unsaved tab, returning the first tab where isUnsaved === true. */
  findUnsavedTab(): UISessionTab | undefined;
  /** Update the session runtime status of the specified tab. */
  updateTabStatus(sessionId: string, status: SessionStatus): void;
  /**
   * Restore the active Tab from localStorage
   *
   * Only called once on initial load: re-sets the activeSessionId from before the browser was closed.
   * If the stored id is not in the current tabs, no change is made.
   * Returns true if the active tab changed.
   */
  restoreActiveFromStorage(): boolean;
  /**
   * Read the last active Tab's sessionId from localStorage
   *
   * Used during tab loop restoration to determine which tab should have activate: true.
   * Returns null if localStorage is empty or unavailable.
   */
  getStoredActiveSessionId(): string | null;
  /** Set transient UI params (initialInputValue, noticeMessage) for the specified tab, also incrementing initialValueVersion. */
  setTransientParams(
    sessionId: string,
    params: { initialInputValue?: string; noticeMessage?: string },
  ): void;
  /** Clear transient UI params for the specified tab. */
  clearTransientParams(sessionId: string): void;
}

/**
 * @deprecated Alias for UISessionTabActions. Use UISessionTabActions instead for clarity.
 */
export type SessionTabActions = UISessionTabActions;

/* ── Modes ── */

export type Mode = 'manual' | 'edit' | 'plan' | 'auto' | 'bypass';

export interface ModeConfig {
  mode: Mode;
  label: string;
  icon: string;
  description: string;
}

/* ── Tool Calls ── */

// ToolCall is now imported from @rtc-agent/protocol (see above)
// ToolCallStatus is defined in the protocol package as RtcStatus enum

/* ── Window State ── */

export type WindowMode = 'normal' | 'maximized' | 'minimized';

export interface WindowState {
  mode: WindowMode;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** Snapshot before maximize/minimize for restore. */
  lastState?: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  };
}

/* ── Auth ── */

export interface AuthState {
  isLoggedIn: boolean;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  expiresAt?: number;
}

/* ── Window State Actions ── */

export interface WindowStateActions {
  setMode(mode: WindowMode): void;

  setPosition(pos: { x: number; y: number }): void;

  setSize(size: { width: number; height: number }): void;

  maximize(): void;

  minimize(): void;

  restore(): void;
}

/* ── Session Actions ── */

export interface UISessionState {
  sessions: UISession[];
  currentSessionId: string | null;
}

/**
 * @deprecated Alias for UISessionState. Use UISessionState instead for clarity.
 */
export type SessionState = UISessionState;

export interface UISessionActions {
  /** Create a new session and set it as current. Returns the new session's clientId (available synchronously to avoid context async propagation). */
  createSession(): string;

  switchSession(id: string): void;

  renameSession(
    id: string,
    title: string,
  ): Promise<{ ok: boolean; error?: string }>;

  deleteSession(id: string): Promise<{ ok: boolean; error?: string }>;

  /** Notify the backend to close the session (called when a Tab closes, fire-and-forget) */
  closeSession(sessionId: string): Promise<{ ok: boolean; error?: Error }>;

  /** Reopen a closed session (called when opening a closed session, transparent reopen) */
  reopenSession(sessionId: string): Promise<{ ok: boolean; error?: Error }>;

  /** Reset all session state */
  reset(): void;

  /** Clear currentSessionId only (keep sessions list). Used when starting a new conversation. */
  clearCurrentSession(): void;

  /** Set current session (upsert + select). Used by MessageController after persistence write. */
  setCurrentSession(session: UISession): void;

  /** Update sessions list without affecting currentSessionId. Used by UIUpdateBus subscription. */
  setSessions(sessions: UISession[]): void;
}

/**
 * @deprecated Alias for UISessionActions. Use UISessionActions instead for clarity.
 */
export type SessionActions = UISessionActions;

/* ── Message Actions ── */

export interface UIMessageState {
  messages: UIMessage[];
  /** Whether there are older messages available to load (backward pagination) */
  hasMore: boolean;
  /** Whether a loadMore (backward) request is in progress */
  isLoadingMore: boolean;
  /** Whether there are newer messages available to load (forward pagination) */
  hasMoreNewer?: boolean;
  /** Whether a loadNewer (forward) request is in progress */
  isLoadingNewer?: boolean;
}

/**
 * @deprecated Alias for UIMessageState. Use UIMessageState instead for clarity.
 */
export type MessageState = UIMessageState;

export interface UIMessageActions {
  sendMessage(content: ContentData): Promise<void>;

  /** Resend a failed message (preserves the original client_id for idempotent retry) */
  resendMessage(messageClientId: string, content: ContentData): Promise<void>;

  /** Fork a conversation: create a new session based on an old message, replacing message content */
  forkSession(params: {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    newMessageClientId: string;
    content: ContentData;
    limit?: number;
  }): Promise<void>;

  /** Called by the streaming handler as tokens arrive. */
  appendToLastMessage(chunk: string): void;

  /** Finalize the last streaming message. */
  finalizeLastMessage(): void;

  /** Clear all messages. Called on session switch, can also be a user-initiated action. */
  clearMessages(): void;
}

/**
 * @deprecated Alias for UIMessageActions. Use UIMessageActions instead for clarity.
 */
export type MessageActions = UIMessageActions;

/* ── Mode Actions ── */

export interface ModeState {
  currentMode: Mode;
}

export interface ModeActions {
  setMode(mode: Mode): void;
}

/* ── Tool Call Actions ── */

export interface ToolCallState {
  pendingCalls: ToolCall[];
}

export interface ToolCallActions {
  approve(id: string): void;

  approveAll(toolName: string): void;

  deny(id: string): void;
}

/* ── Skill System ── */

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
} from './skill.js';

/* ── Activity Bar Configuration ── */

export type {
  Activity,
  ActivityBarConfig,
  ResolvedActivityBarConfig,
} from './activity-bar-config.js';
export {
  DEFAULT_ACTIVITY_BAR_CONFIG,
  resolveActivityBarConfig,
} from './activity-bar-config.js';

/* ── Function Debugger ── */

export type {
  LogLevel,
  LogEntry,
  ExecutionStatus,
  DebugHistoryItem,
  FunctionDebugState,
  HistoryPaginationState,
} from './functions-debug.js';

/* ── File Explorer & Editor (Phase 1) ── */

/**
 * File tree node (recursive structure)
 *
 * Corresponds to VirtualFS directory/file entries. `children` being undefined means "not loaded"
 * (lazy-loading semantics), distinguished from an empty array (empty directory).
 */
export interface FileNode {
  /** Absolute path, e.g. '/scenarios/checkout.md' */
  path: string;
  /** File name (without path) */
  name: string;
  /** Node type */
  type: 'file' | 'folder';
  /** Child nodes. Only meaningful for folders; undefined means not yet loaded. */
  children?: FileNode[];
  /** Whether expanded. Only meaningful for folders. */
  isExpanded?: boolean;
  /** Whether child nodes are being lazy-loaded. Only meaningful for folders. */
  isLoading?: boolean;
}

/**
 * Editor view mode
 *
 * - edit: Show only the edit panel
 * - preview: Show only the preview panel
 * - split: Side-by-side (with a draggable splitter in the middle)
 */
export type EditorViewMode = 'edit' | 'preview' | 'split';

/**
 * Editor tab
 *
 * Uses filePath as the unique identifier; only one tab is allowed per path.
 */
export interface EditorTab {
  /** File path (unique identifier) */
  filePath: string;
  /** Current edited content */
  content: string;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Cursor position (line / column, both 1-based) */
  cursorPosition: { line: number; column: number };
  /** Current tab's view mode (each tab is independent) */
  viewMode: EditorViewMode;
}

/**
 * Status bar display information
 *
 * Derived by StatusBarController from EditorAreaController,
 * consumed by the rtc-status-bar component for rendering.
 */
export interface StatusBarInfo {
  /** File type label (e.g. "Markdown", "JavaScript") */
  fileType: string;
  /** Encoding (fixed "UTF-8", extensible later) */
  encoding: string;
  /** Cursor position (line / column, both 1-based) */
  cursor: { line: number; column: number };
  /** Save status: saved=changes saved, unsaved=has unsaved changes, none=no file open */
  saveStatus: 'saved' | 'unsaved' | 'none';
}
