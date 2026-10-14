/**
 * Message Controller
 *
 * Encapsulates message list management: send, streaming append, finalize, clear.
 * Dispatches `rtc-message-sent` event for external consumers.
 *
 * Cross-controller note: When the session switches, the root component calls
 * `reload()` on this controller to load the message history for the new session.
 *
 * Corresponds to: `messageContext` (defined in `contexts/message.ts`).
 * Provided by: `<rtc-agent>` (root)
 * Consumed by: `<rtc-content-area>`, `<rtc-message-list>`, `<rtc-input-area>`
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type {
  Message,
  MessageState,
  MessageActions,
  MessageRole,
  ContentData,
} from '../types/index.js';
import type { MessageContextValue } from '../contexts/message.js';
import type { IPersistenceLayer, LocalMessage } from '@rtc-agent/persistence';
import type { SessionController } from './session.controller.js';
import type { Session } from '../types/index.js';
import { MessageRepository, MESSAGE_PAGE_SIZE } from '../repositories/index.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('MessageController');

export class MessageController implements ReactiveController {
  host: ReactiveControllerHost & EventTarget;

  /** Message repository for multi-session support. */
  private _repository?: MessageRepository;

  /** Persistence layer — injected by root component after construction. */
  private _persistence?: IPersistenceLayer;

  /** Session controller — injected by root component after construction. */
  private _sessionController?: SessionController;

  /**
   * Per-session promise chain to serialize updateMessageFromBus calls.
   * Prevents race condition when multiple messages arrive concurrently from UIUpdateBus.
   * Key: sessionClientId, Value: pending promise chain for that session.
   *
   * **Memory Management Design**:
   * This map uses LRU (Least Recently Used) eviction to prevent unbounded memory growth
   * in long-lived tabs with many sessions. When the map reaches MAX_SESSION_CHAINS,
   * the oldest entry (first key in Map insertion order) is removed before adding new ones.
   *
   * The limit of 50 is chosen to balance:
   * - Memory pressure: Each chain entry is ~100 bytes (key string + Promise reference)
   * - Working set coverage: Most users have <20 sessions open in a typical work session
   * - Safety margin: 50 provides 2.5x headroom above typical usage
   *
   * In extreme cases (1000+ session switches in rapid succession), this prevents
   * memory leaks while maintaining serialization correctness for active sessions.
   */
  private _sessionUpdateChains = new Map<string, Promise<void>>();

  /** Maximum number of concurrent session chains to prevent memory leak */
  private static readonly MAX_SESSION_CHAINS = 50;

  /**
   * Get or create an update chain for a session.
   *
   * Implements LRU eviction: when the map is at capacity, the oldest entry
   * (first key in Map insertion order) is removed before adding the new one.
   * This prevents unbounded memory growth in long-lived tabs with many sessions.
   *
   * **Optimization**: When a session is accessed, it's moved to the end of the
   * Map (most recently used position) by deleting and re-inserting it. This
   * ensures the LRU eviction policy is accurate and fair.
   */
  private _getUpdateChain(sessionId: string): Promise<void> {
    // If at capacity, evict the oldest entry (LRU policy)
    if (
      this._sessionUpdateChains.size >= MessageController.MAX_SESSION_CHAINS &&
      !this._sessionUpdateChains.has(sessionId)
    ) {
      const firstKey = this._sessionUpdateChains.keys().next().value;
      if (firstKey !== undefined) {
        this._sessionUpdateChains.delete(firstKey);
        log.debug(
          `Evicted oldest session chain: ${firstKey} (size: ${this._sessionUpdateChains.size})`,
        );
      }
    }

    let chain = this._sessionUpdateChains.get(sessionId);
    if (!chain) {
      chain = Promise.resolve();
      this._sessionUpdateChains.set(sessionId, chain);
    } else {
      // Move to end (mark as most recently used) for accurate LRU tracking
      this._sessionUpdateChains.delete(sessionId);
      this._sessionUpdateChains.set(sessionId, chain);
    }
    return chain;
  }

  /**
   * Track the session ID currently being streamed to detect session switches.
   * When session switches during streaming, operations for the old session should be ignored.
   */
  private _streamingSessionId?: string;

  readonly actions: MessageActions;

  /** Setter for persistence injection (avoids circular deps). */
  set persistence(layer: IPersistenceLayer) {
    this._persistence = layer;
    // Initialize repository when persistence is set
    if (!this._repository) {
      this._repository = new MessageRepository({
        fetchMessages: async (sessionId: string) => {
          return this._fetchWithPagination({
            sessionId,
            direction: 'backward',
            isInitialLoad: true,
          });
        },
        fetchOlderMessages: async (
          sessionId: string,
          beforeCursor?: string,
        ) => {
          return this._fetchWithPagination({
            sessionId,
            cursor: beforeCursor,
            direction: 'backward',
            cursorType: 'oldest',
          });
        },
        fetchNewerMessages: async (sessionId: string, afterCursor?: string) => {
          return this._fetchWithPagination({
            sessionId,
            cursor: afterCursor,
            direction: 'forward',
            cursorType: 'newest',
          });
        },
      });
    }
  }

  /**
   * Fetch messages with pagination support.
   *
   * Consolidates the common logic for fetchMessages, fetchOlderMessages, and fetchNewerMessages.
   * Handles cursor tracking and pagination state updates.
   */
  private async _fetchWithPagination(params: {
    sessionId: string;
    cursor?: string;
    direction: 'backward' | 'forward';
    cursorType?: 'oldest' | 'newest';
    isInitialLoad?: boolean;
  }): Promise<Message[]> {
    if (!this._persistence) return [];

    const { sessionId, cursor, direction, cursorType, isInitialLoad } = params;

    const messages = await this._persistence.listMessages(
      sessionId,
      cursor,
      MESSAGE_PAGE_SIZE,
      direction,
    );

    // Track pagination cursors using (created_at, client_id) composite key
    if (messages.length > 0) {
      if (isInitialLoad) {
        // Initial load: set both oldest and newest cursors
        this._repository?.setOldestOffset(
          sessionId,
          this._buildCursor(new Date(messages[0].created_at).getTime(), messages[0].client_id),
        );
        this._repository?.setNewestOffset(
          sessionId,
          this._buildCursor(new Date(messages[messages.length - 1].created_at).getTime(), messages[messages.length - 1].client_id),
        );
      } else if (cursorType === 'oldest') {
        // Backward pagination: update oldest cursor
        this._repository?.setOldestOffset(
          sessionId,
          this._buildCursor(new Date(messages[0].created_at).getTime(), messages[0].client_id),
        );
      } else if (cursorType === 'newest') {
        // Forward pagination: update newest cursor
        this._repository?.setNewestOffset(
          sessionId,
          this._buildCursor(new Date(messages[messages.length - 1].created_at).getTime(), messages[messages.length - 1].client_id),
        );
      }
    }

    return messages.map((m) => this._localMessageToUI(m));
  }

  /**
   * Build pagination cursor from timestamp and clientId.
   *
   * Format: "${timestamp}|${clientId}" for (created_at, client_id) composite sorting.
   * Shared by both LocalMessage and UI Message code paths to avoid duplication.
   */
  private _buildCursor(timestamp: number, clientId: string): string {
    return `${timestamp}|${clientId}`;
  }

  /** Get the message repository for multi-session support. */
  get repository(): MessageRepository {
    if (!this._repository) {
      throw new Error(
        '[MessageController] Repository not initialized. Set persistence first.',
      );
    }
    return this._repository;
  }

  /** Setter for session controller injection (avoids circular deps). */
  set sessionController(controller: SessionController) {
    this._sessionController = controller;
  }

  /**
   * CRITICAL FIX: Value cache to prevent unnecessary Context consumer re-renders.
   * @lit/context uses `===` comparison, so creating new objects every time triggers
   * consumers even when the state hasn't changed. Cache the value object and only
   * recreate when underlying repository state changes.
   *
   * Note: We cache the MessageContextValue object itself, but always create fresh
   * shallow copies of the MessageState to prevent external mutation while still
   * allowing consumers to detect changes via reference comparison.
   */
  private _cachedValue?: MessageContextValue;
  private _cachedState?: MessageState;
  private _cachedSessionId?: string | null;
  private _cachedRepoVersion?: number;

  /**
   * Get the current message context value.
   *
   * **Object.freeze() Design Decision**:
   * This controller uses Object.freeze() to create immutable state and value objects.
   * This is a defensive measure specific to MessageController because:
   *
   * 1. **High-frequency state changes**: Messages are updated constantly during streaming,
   *    tool calls, and user interactions. Immutable state prevents accidental mutations
   *    from causing subtle bugs.
   *
   * 2. **Shared references**: The messages array is passed to multiple consumers
   *    (message-list, input-area, tool-call overlays). Freeze prevents any consumer
   *    from accidentally mutating the shared source of truth.
   *
   * 3. **Performance optimization**: Frozen objects can be safely returned by reference,
   *    reducing garbage collection pressure. Without freeze, we'd need to deep-copy
   *    on every access to prevent mutations.
   *
   * Other controllers (e.g., SessionController, ModeController) don't use freeze because:
   * - They have lower update frequency
   * - Their state is typically replaced entirely on updates (new object references)
   * - The cost of freeze() outweighs the benefit for rarely-accessed state
   *
   * @see CachedContextController for base caching logic
   */
  get value(): MessageContextValue {
    const currentSessionId =
      this._sessionController?.value.state.currentSessionId;
    // Derive state from repository (single source of truth)
    const source =
      currentSessionId && this._repository
        ? this._repository.getSessionState(currentSessionId)
        : { messages: [], hasMore: false, isLoadingMore: false };

    // Check if we need to refresh the cached source state
    const repoVersion = this._repository?.version ?? 0;
    let stateChanged = false;

    if (
      !this._cachedState ||
      this._cachedSessionId !== currentSessionId ||
      this._cachedRepoVersion !== repoVersion
    ) {
      this._cachedSessionId = currentSessionId;
      this._cachedRepoVersion = repoVersion;
      // P2-4: Use Object.freeze() to create immutable state, preventing external mutation
      // while avoiding unnecessary deep copies. Consumers can still read properties,
      // but attempts to modify will throw in strict mode (fail-fast principle).
      this._cachedState = Object.freeze({
        messages: Object.freeze([...source.messages]),
        hasMore: source.hasMore,
        isLoadingMore: source.isLoadingMore,
        hasMoreNewer: source.hasMoreNewer,
        isLoadingNewer: source.isLoadingNewer,
      } as MessageState);
      stateChanged = true;
    }

    // P2-4: Return frozen state directly - no need to create shallow copies on every access
    // Object.freeze() ensures immutability, so we can safely return the same reference.
    // This reduces garbage collection pressure and improves performance.
    const state = this._cachedState!;

    // Only recreate value object if state changed or first access
    // This prevents unnecessary object creation on every get() call
    if (!this._cachedValue || stateChanged) {
      this._cachedValue = Object.freeze({
        state,
        actions: this.actions,
        getUserMessageHistory: (sessionId: string, limit?: number) =>
          this.getUserMessageHistory(sessionId, limit),
      } as MessageContextValue);
    }

    return this._cachedValue;
  }

  constructor(host: ReactiveControllerHost & EventTarget) {
    this.host = host;
    this.host.addController(this);
    this.actions = {
      sendMessage: async (content: ContentData) => {
        await this._sendMessage(content);
      },
      resendMessage: async (messageClientId: string, content: ContentData) => {
        await this._resendMessage(messageClientId, content);
      },
      forkSession: async (params) => {
        await this._forkSession(params);
      },
      appendToLastMessage: (chunk: string) => this._appendToLastMessage(chunk),
      finalizeLastMessage: () => this._finalizeLastMessage(),
      clearMessages: () => this._clearMessages(),
    };
  }

  hostConnected() {}
  hostDisconnected() {
    // Clear pending update chains to prevent stale promises from referencing
    // disconnected host. Without this, in-flight UIUpdateBus updates for
    // sessions that were evicted could still call host.requestUpdate().
    const chainCount = this._sessionUpdateChains.size;
    if (chainCount > 0) {
      log.debug(`Clearing ${chainCount} pending session chains on disconnect`);
    }
    this._sessionUpdateChains.clear();
    // Cancel any in-flight streaming to prevent stale updates after reconnect.
    this._cancelStreaming();
  }

  /**
   * Add a mock assistant message (demo page only).
   *
   * **Note**: This method is NOT part of `MessageActions` and is not exposed
   * via Context. In a real environment, assistant messages are injected by the
   * protocol layer via `sendMessage` or a dedicated method.
   */
  addDemoAssistantMessage(content: string) {
    const msg: Message = {
      clientId: `msg-${Date.now()}-assistant`,
      role: 'assistant',
      content: { type: 'text', data: content },
      timestamp: Date.now(),
      syncStatus: 'synced',
    };

    // Update repository for the current session
    const currentSessionId =
      this._sessionController?.value.state.currentSessionId;
    if (this._repository && currentSessionId) {
      this._repository.appendMessage(currentSessionId, msg);
    }

    this.host.requestUpdate();
  }

  /**
   * Fetch initial messages for a session (if repository doesn't have data yet).
   * Called by rtc-message-list in willUpdate.
   */
  async fetchInitialMessages(sessionId: string): Promise<void> {
    if (!this._repository) return;

    const state = this._repository.getSessionState(sessionId);
    if (state.messages.length === 0) {
      await this._repository.fetchMessages(sessionId);
    }
    this.host.requestUpdate();
  }

  /**
   * Load more messages for a specific session (backward pagination).
   * Called by rtc-message-list when user scrolls to top.
   */
  async loadMoreForSession(sessionId: string): Promise<void> {
    if (!this._repository) return;
    await this._repository.loadMore(sessionId);
    this.host.requestUpdate();
  }

  /**
   * Load newer messages for a session (forward pagination).
   * Called by rtc-message-list when virtual scroll needs to load newer messages.
   */
  async loadNewerForSession(sessionId: string): Promise<void> {
    if (!this._repository) return;
    await this._repository.loadNewer(sessionId);
    this.host.requestUpdate();
  }

  /**
   * Load all messages for a session from persistence (for export/commands).
   *
   * Unlike the paginated UI methods, this loads the complete message history
   * without pagination limits. Use sparingly — for large sessions this loads
   * all messages into memory.
   *
   * Returns empty array if persistence is not available or session has no messages.
   */
  async loadAllMessages(sessionId: string): Promise<Message[]> {
    if (!this._persistence) return [];

    // Use a very large limit to effectively load all messages.
    // Internally, listMessages loads all from IndexedDB then slices,
    // so this doesn't cause extra DB work — just skips the slice.
    const localMessages = await this._persistence.listMessages(
      sessionId,
      undefined,
      Number.MAX_SAFE_INTEGER,
      'backward',
    );

    return localMessages.map((local) => this._localMessageToUI(local));
  }

  /**
   * Evict a session from the repository cache.
   * Called when a tab is closed to free memory.
   */
  evictSession(sessionId: string): void {
    log.debug(`Evicting session from repository cache: ${sessionId}`);
    this._repository?.evictSession(sessionId);
  }

  /**
   * Update a single message field from UIUpdateBus event.
   * More efficient than reload() for streaming updates.
   *
   * Handles both existing messages (patch) and new messages (append).
   *
   * Uses per-session promise chain to serialize updates and prevent race conditions
   * when multiple messages arrive concurrently from UIUpdateBus.
   *
   * @param entityId - Message client ID
   */
  async updateMessageFromBus(entityId: string): Promise<void> {
    if (!this._persistence || !this._repository) return;

    // Get the message from DB to find its session (read-only, no race)
    const localMsg = await this._persistence.getMessage(entityId);
    if (!localMsg) {
      log.debug(`message not found in DB: ${entityId}`);
      return;
    }

    const messageSessionId = localMsg.session_client_id;
    if (!messageSessionId) {
      log.debug(`message has no session_client_id: ${entityId}`);
      return;
    }

    // Get or create the chain for this session (with LRU eviction)
    const prev = this._getUpdateChain(messageSessionId);

    // Serialize the read-modify-write part per session to prevent race conditions.
    // Multiple concurrent calls for the same session must not interleave.
    // Errors are caught to prevent chain breaking — subsequent updates for the same
    // session will continue through the chain. This prevents duplicate operations
    // while maintaining chain integrity for future events.
    const next = prev
      .then(() => {
        try {
          this._applyBusUpdate(messageSessionId, entityId, localMsg);
        } catch (err) {
          // Catch synchronous errors from _applyBusUpdate to prevent chain breaking
          log.error(
            'bus update apply error, continuing chain:',
            err,
          );
        }
      })
      .catch((err) => {
        // Catch any Promise rejections from the chain itself
        // This ensures the chain never breaks, even on unexpected errors
        log.error(
          'bus update chain error, chain continues for future events:',
          err,
        );
      });

    this._sessionUpdateChains.set(messageSessionId, next);

    // Clean up the chain when it settles
    // Use unconditional delete to prevent race condition where finally() handlers
    // execute out of order, leaving stale entries in the map.
    next.finally(() => {
      // Only delete if this is still the current chain for this session
      // (a newer chain may have replaced it)
      const current = this._sessionUpdateChains.get(messageSessionId);
      if (current === next || current === undefined) {
        this._sessionUpdateChains.delete(messageSessionId);
      }
    });

    return next;
  }

  /**
   * Apply a single UIUpdateBus update to repository and legacy state.
   * Called within the per-session promise chain to ensure serialization.
   */
  private _applyBusUpdate(
    messageSessionId: string,
    entityId: string,
    localMsg: LocalMessage,
  ): void {
    if (!this._repository) return;

    const newMsg = this._localMessageToUI(localMsg);

    // Check if this is a new message (for event dispatch)
    const current = this._repository.getSessionState(messageSessionId);
    const isNew = !current.messages.some((m) => m.clientId === entityId);

    this._upsertMessage(messageSessionId, entityId, newMsg);
    this.host.requestUpdate();

    // Dispatch rtc-message-received for new messages only (not updates)
    if (isNew) {
      this.host.dispatchEvent(
        new CustomEvent('rtc-message-received', {
          detail: { message: newMsg },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /**
   * Reload messages from persistence. Public method for UIUpdateBus / root wiring.
   *
   * - With entityId: immutable single-message update (replace matching clientId).
   * - Without entityId: full reload for the current session (from SessionController).
   *
   * Race condition protection: If the current session changes during the reload,
   * the result is discarded to prevent updating the wrong session's messages.
   */
  async reload(entityId?: string) {
    if (!this._persistence) return;

    if (entityId) {
      const localMsg = await this._persistence.getMessage(entityId);
      if (localMsg) {
        const messageSessionId = localMsg.session_client_id;
        if (messageSessionId) {
          // Verify session hasn't changed during async operation
          const currentSessionId =
            this._sessionController?.value.state.currentSessionId;
          if (currentSessionId !== messageSessionId) {
            log.debug(
              `Session changed during reload: expected ${messageSessionId}, got ${currentSessionId}. Discarding result.`,
            );
            return;
          }

          const newMsg = this._localMessageToUI(localMsg);
          this._upsertMessage(messageSessionId, entityId, newMsg);
          this.host.requestUpdate();
        }
      }
    } else {
      const currentSessionId =
        this._sessionController?.value.state.currentSessionId;
      if (currentSessionId) {
        // Store the session ID before reload to detect changes
        const sessionIdBeforeReload = currentSessionId;
        await this._reloadFromDB(currentSessionId);

        // Verify session hasn't changed during reload
        const currentSessionIdAfterReload =
          this._sessionController?.value.state.currentSessionId;
        if (currentSessionIdAfterReload !== sessionIdBeforeReload) {
          log.warn(
            `Session changed during full reload: was ${sessionIdBeforeReload}, now ${currentSessionIdAfterReload}. ` +
            `Messages for ${sessionIdBeforeReload} may be stale.`,
          );
        }
      }
    }
  }

  /**
   * Upsert a single message into the repository.
   *
   * Shared by `reload(entityId)` and `_applyBusUpdate()` to eliminate duplication.
   * Uses explicit clientId check + sorted insert to prevent duplicates and ensure correct ordering.
   *
   * Why not use sort()?
   * - sort() relies on timestamp values, which may be inconsistent between client and server
   * - Direct insertion at correct position maintains order incrementally
   * - Prevents order flips that cause VirtualScroll diff to miscalculate prepend/append
   */
  private _upsertMessage(
    sessionId: string,
    messageId: string,
    newMsg: Message,
  ): void {
    if (!this._repository) return;

    const current = this._repository.getSessionState(sessionId);
    const existingIndex = current.messages.findIndex(
      (m) => m.clientId === messageId,
    );

    let messages: Message[];
    if (existingIndex >= 0) {
      // Existing message: update in place (no duplicate)
      messages = [...current.messages];
      messages[existingIndex] = newMsg;
      log.debug(
        `[upsert] UPDATE message=${messageId}, session=${sessionId}, ` +
        `index=${existingIndex}, totalMessages=${messages.length}`
      );
    } else {
      // New message: insert at correct position (maintain sorted order)
      messages = [...current.messages];
      // Find the first message that should come AFTER newMsg
      const insertIndex = messages.findIndex(
        (m) => this._compareMessages(newMsg, m) < 0,
      );

      // Defense-in-depth: check for duplicates before inserting
      // This prevents race conditions where the same message arrives via multiple paths
      if (insertIndex >= 0) {
        // Check if the previous message has the same clientId (duplicate)
        if (insertIndex > 0 && messages[insertIndex - 1].clientId === newMsg.clientId) {
          log.warn(`Duplicate message detected, skipping insert: ${newMsg.clientId}`);
          return;
        }
        messages.splice(insertIndex, 0, newMsg);
      } else {
        // newMsg should be at the end
        // Check if the last message has the same clientId (duplicate)
        if (messages.length > 0 && messages[messages.length - 1].clientId === newMsg.clientId) {
          log.warn(`Duplicate message detected, skipping append: ${newMsg.clientId}`);
          return;
        }
        messages.push(newMsg);
      }

      const finalIndex = insertIndex >= 0 ? insertIndex : messages.length - 1;
      log.debug(
        `[upsert] INSERT message=${newMsg.clientId}, session=${sessionId}, ` +
        `index=${finalIndex}, totalMessages=${messages.length}`
      );
    }

    this._repository.updateMessages(sessionId, messages);
  }

  /**
   * Compare two messages for sorting by (timestamp, role, clientId) composite key.
   *
   * Sorting priority:
   * 1. timestamp (ascending) - primary sort by creation time
   * 2. role priority (system < user < assistant) - ensures prompt messages appear before user messages
   *    when timestamps are equal or very close
   * 3. clientId (ascending) - final tiebreaker for deterministic ordering
   *
   * This matches the persistence layer (entity-repository.ts) and _mergeMessages() logic,
   * with added role priority to handle the common case of prompt+user message pairs.
   */
  private _compareMessages(a: Message, b: Message): number {
    // Primary: timestamp
    const tsDiff = a.timestamp - b.timestamp;
    if (tsDiff !== 0) return tsDiff;

    // Secondary: role priority (system < user < assistant)
    // This ensures prompt (system) messages appear before user messages when timestamps match
    const rolePriority: Record<string, number> = {
      system: 0,
      user: 1,
      assistant: 2,
    };
    const aPriority = rolePriority[a.role] ?? 1;
    const bPriority = rolePriority[b.role] ?? 1;
    if (aPriority !== bPriority) return aPriority - bPriority;

    // Tertiary: clientId (deterministic tiebreaker)
    return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
  }

  private async _sendMessage(content: ContentData) {
    if (!this._persistence) {
      log.error('persistence not set');
      return;
    }

    const messageClientId = crypto.randomUUID();

    // Determine session: use current session if set, otherwise create a new one.
    let sessionClientId: string;
    if (this._sessionController) {
      const currentSessionId =
        this._sessionController.value.state.currentSessionId;
      log.debug('currentSessionId before:', currentSessionId);
      sessionClientId = currentSessionId ?? crypto.randomUUID();
      log.debug(
        'sessionClientId to use:',
        sessionClientId,
        currentSessionId ? '(existing)' : '(NEW)',
      );
    } else {
      sessionClientId = crypto.randomUUID();
      log.debug(
        'No sessionController, created new sessionClientId:',
        sessionClientId,
      );
    }

    // Write to persistence (local-first + background sync).
    const result = await this._persistence.sendMessage({
      content,
      messageClientId,
      sessionClientId,
    });
    log.debug('persistence.sendMessage returned:', {
      sessionClientId: result.session.client_id,
      messageSessionClientId: result.message.session_client_id,
    });

    // Update session in SessionController (upsert + select).
    // Only update if the user hasn't moved to a different session in the meantime.
    if (this._sessionController) {
      const currentSessionId =
        this._sessionController.value.state.currentSessionId;
      log.debug(
        'currentSessionId after persistence:',
        currentSessionId,
        'result.session.client_id:',
        result.session.client_id,
      );
      // Only set if: no current session, or current session matches what we're updating
      if (!currentSessionId || currentSessionId === result.session.client_id) {
        const uiSession: Session = {
          clientId: result.session.client_id,
          title: result.session.title || '',
          createdAt: new Date(result.session.created_at).getTime(),
          updatedAt: new Date(result.session.updated_at).getTime(),
          todoList: result.session.todo_list,
        };
        log.debug(
          'setCurrentSession:',
          uiSession.clientId,
          'title:',
          `"${uiSession.title}"`,
        );

        // Defense-in-depth: re-check session state before mutating
        // This prevents race conditions where the session changes during the async operation
        const recheckSessionId =
          this._sessionController.value.state.currentSessionId;
        if (
          recheckSessionId &&
          recheckSessionId !== result.session.client_id
        ) {
          log.warn(
            `Session changed during _sendMessage: expected ${result.session.client_id}, got ${recheckSessionId}. Skipping update.`,
          );
          return;
        }

        this._sessionController.actions.setCurrentSession(uiSession);

        // Reload messages from DB to reflect the just-written message.
        await this._reloadFromDB(result.session.client_id);
      }
    }

    // Notify external listeners.
    this.host.dispatchEvent(
      new CustomEvent('rtc-message-sent', {
        bubbles: true,
        composed: true,
        detail: { message: result.message },
      }),
    );
  }

  /**
   * Re-send a failed message (preserves original client_id for idempotent retry).
   */
  private async _resendMessage(messageClientId: string, content: ContentData) {
    if (!this._persistence) {
      log.error('persistence not set');
      return;
    }

    // Must use current session (resend always happens within an existing session)
    const sessionClientId =
      this._sessionController?.value.state.currentSessionId;
    if (!sessionClientId) {
      log.error('cannot resend: no current session');
      return;
    }

    // Re-use the same messageClientId when calling persistence (idempotent retry)
    const result = await this._persistence.sendMessage({
      content,
      messageClientId,
      sessionClientId,
    });

    // Reload message list to reflect the state change
    await this._reloadFromDB(sessionClientId);

    // Notify external listeners.
    this.host.dispatchEvent(
      new CustomEvent('rtc-message-sent', {
        bubbles: true,
        composed: true,
        detail: { message: result.message },
      }),
    );
  }

  /**
   * Fork a conversation: create a new session based on an existing message.
   *
   * Note: After forking, setCurrentSession must be called to add the new
   * session to the sessions list, otherwise _ensureTabForSession cannot
   * immediately locate the session to fetch its real title.
   */
  private async _forkSession(params: {
    oldSessionClientId: string;
    oldMessageClientId: string;
    newSessionClientId: string;
    newMessageClientId: string;
    content: ContentData;
    limit?: number;
  }) {
    if (!this._persistence) {
      log.error('persistence not set');
      return;
    }

    // Call persistence layer's forkSession
    const result = await this._persistence.forkSession({
      oldSessionClientId: params.oldSessionClientId,
      oldMessageClientId: params.oldMessageClientId,
      newSessionClientId: params.newSessionClientId,
      newMessageClientId: params.newMessageClientId,
      content: params.content,
      limit: params.limit,
    });

    // Add new session to sessions list and set as currentSession
    // (consistent with _sendMessage, so _ensureTabForSession can locate it immediately)
    if (this._sessionController) {
      const uiSession: Session = {
        clientId: result.session.client_id,
        title: result.session.title || '',
        createdAt: new Date(result.session.created_at).getTime(),
        updatedAt: new Date(result.session.updated_at).getTime(),
        todoList: result.session.todo_list,
      };
      this._sessionController.actions.setCurrentSession(uiSession);
    }

    // Reload the new session's message list
    await this._reloadFromDB(result.session.client_id);

    // Notify external listeners
    this.host.dispatchEvent(
      new CustomEvent('rtc-message-sent', {
        bubbles: true,
        composed: true,
        detail: { message: result.message },
      }),
    );
  }

  private async _reloadFromDB(sessionClientId: string) {
    if (!this._persistence) return;

    const existing = this._repository?.getSessionState(sessionClientId);
    const existingMessages = existing?.messages ?? [];

    log.debug(
      `_reloadFromDB(${sessionClientId}): existingMessages=${existingMessages.length}, ` +
      `hasMore=${existing?.hasMore ?? 'N/A'}`
    );

    // For new sessions: if messages already exist in repository (loaded by fetchInitialMessages
    // or UIUpdateBus events), skip reload to avoid duplicate/overwrite issues.
    // This prevents race conditions between _reloadFromDB and concurrent message loading.
    if (existingMessages.length > 0) {
      log.debug(
        `_reloadFromDB(${sessionClientId}): skipped - messages already loaded (count: ${existingMessages.length})`
      );
      return;
    }

    log.debug(`_reloadFromDB(${sessionClientId}): loading messages from DB...`);

    // Load the latest messages (backward = from newest)
    const localMessages = await this._persistence.listMessages(
      sessionClientId,
      undefined,
      MESSAGE_PAGE_SIZE,
      'backward',
    );
    const freshMessages = localMessages.map((m) => this._localMessageToUI(m));

    // Merge: preserve existing messages not in fresh batch
    const merged = this._mergeMessages(existingMessages, freshMessages);

    // ── Cursor logic (critical fix) ──
    //
    // Cursor must point to the oldest/newest message in the MERGED array,
    // not the fresh batch from DB. Otherwise loadMore will use a wrong cursor
    // and return duplicate messages.
    //
    // Example:
    //   existing = [msg1..msg69], fresh = [msg20..msg69] (DB's latest 50)
    //   merged = [msg1..msg69]
    //   ❌ old: oldestCursor = cursor(msg20) → loadMore returns msg1..msg19 → duplicates!
    //   ✅ new: oldestCursor = cursor(msg1)  → loadMore requests before msg1 → no duplicates

    if (merged.length > 0) {
      const oldestInMerged = merged[0];
      const newestInMerged = merged[merged.length - 1];

      // hasMore logic:
      // - If merged[0] came from existing (preserved older loaded messages),
      //   inherit existing.hasMore (that question was already answered)
      // - If merged[0] came from fresh (no older messages preserved),
      //   use standard check: did DB return a full page?
      const freshClientIds = new Set(freshMessages.map((m) => m.clientId));
      const hasMore = freshClientIds.has(oldestInMerged.clientId)
        ? localMessages.length >= MESSAGE_PAGE_SIZE
        : (existing?.hasMore ?? localMessages.length >= MESSAGE_PAGE_SIZE);

      if (this._repository) {
        this._repository.updateMessages(sessionClientId, merged);
        this._repository.setHasMore(sessionClientId, hasMore);
        this._repository.setOldestOffset(
          sessionClientId,
          this._buildCursor(oldestInMerged.timestamp, oldestInMerged.clientId),
        );
        this._repository.setNewestOffset(
          sessionClientId,
          this._buildCursor(newestInMerged.timestamp, newestInMerged.clientId),
        );
      }
    } else {
      // Merged is empty (both existing and fresh are empty)
      if (this._repository) {
        this._repository.updateMessages(sessionClientId, []);
        this._repository.setHasMore(sessionClientId, false);
      }
    }

    this.host.requestUpdate();
  }

  /**
   * Merge existing messages with freshly fetched messages.
   *
   * Strategy: Pure clientId deduplication.
   * - Put existing first, then overwrite with fresh for same clientId (fresh is newer version)
   * - Sort by (timestamp, clientId) composite key, matching persistence layer sorting
   *
   * Why not timestamp-based partitioning?
   * - Timestamps are not unique (multiple messages can be created in the same millisecond)
   * - clientId is the unique business identifier, deduplication by it is unambiguous
   */
  private _mergeMessages(existing: Message[], fresh: Message[]): Message[] {
    const map = new Map<string, Message>();
    for (const msg of existing) map.set(msg.clientId, msg);
    for (const msg of fresh) map.set(msg.clientId, msg); // fresh overwrites existing

    const mergedCount = map.size;
    const dedupCount = existing.length + fresh.length - mergedCount;

    // Composite sort (timestamp, clientId) to match persistence layer (entity-repository.ts)
    // Sorting by timestamp alone is non-deterministic when timestamps are equal
    // (e.g., toolcall_input/output pairs created in the same millisecond)
    const result = [...map.values()].sort(this._compareMessages);

    log.debug(
      `[merge] existing=${existing.length}, fresh=${fresh.length}, ` +
      `merged=${mergedCount}, dedup=${dedupCount}`
    );

    return result;
  }

  /**
   * Get user message history for the current session (used for up/down arrow navigation in input).
   *
   * Returns an array of plain text content in reverse chronological order (newest first).
   * Queried via PersistenceLayer.
   */
  async getUserMessageHistory(
    sessionId: string,
    limit = 200,
  ): Promise<string[]> {
    if (!this._persistence) return [];

    try {
      const messages = await this._persistence.listMessages(
        sessionId,
        undefined,
        limit,
        'backward',
      );

      return messages
        .filter((m) => m.role === 'user' && m.content)
        .reverse()
        .map((m) => this._extractTextFromContent(m.content));
    } catch (error) {
      log.warn('getUserMessageHistory failed:', error);
      return [];
    }
  }

  /**
   * Check if a value is a valid ContentData type.
   * Used to validate JSON.parse results before casting to ContentData.
   */
  private _isValidContentDataType(parsed: unknown): parsed is ContentData {
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return false;
    }
    const type = (parsed as ContentData).type;
    return (
      type === 'text' ||
      type === 'markdown' ||
      type === 'thinking' ||
      type === 'user_message' ||
      type === 'toolcall_input' ||
      type === 'toolcall_output' ||
      type === 'error' ||
      type === 'prompt' ||
      type === 'summary'
    );
  }

  /**
   * Extract plain text from a message's content field.
   *
   * Content storage formats:
   * - Current format (post-fix): full ContentData JSON, e.g. '{"type":"user_message","data":{"text":"..."}}'
   * - Legacy format (historical data): plain text string or object with data only, e.g. '{"text":"..."}'
   * - Plain text: returned as-is
   */
  private _extractTextFromContent(content: string | undefined): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        // Current format: full ContentData (contains type field)
        if ('type' in parsed) {
          const contentData = parsed as ContentData;
          if (
            contentData.type === 'text' ||
            contentData.type === 'markdown' ||
            contentData.type === 'thinking'
          ) {
            return (contentData.data as string) ?? '';
          } else if (contentData.type === 'user_message') {
            // user_message type: extract from data.text
            return ((contentData.data as { text?: string })?.text) ?? '';
          }
        } else {
          // Legacy format: no type field, attempt to extract from known fields
          // Compatible with historical user_message data: {"text":"...","scenarios":[...]}
          if ('text' in parsed && typeof parsed.text === 'string') {
            return parsed.text;
          }
        }
      }
    } catch {
      // Not JSON — treat as plain text
    }
    return content;
  }

  private _localMessageToUI(local: LocalMessage): Message {
    // local.content is a JSON string of ContentData from the DB — parse it
    let contentData: ContentData = { type: 'text', data: '' };
    if (local.content) {
      try {
        const parsed = JSON.parse(local.content);
        if (this._isValidContentDataType(parsed)) {
          contentData = parsed;
        } else {
          // Fallback: treat raw string as text data
          contentData = { type: 'text', data: local.content };
        }
      } catch {
        // Not valid JSON — use as plain text
        contentData = { type: 'text', data: local.content };
      }
    }
    return {
      clientId: local.client_id,
      role: local.role as MessageRole,
      content: contentData,
      timestamp: new Date(local.created_at).getTime(),
      streaming: local.streaming_status === 'streaming',
      syncStatus: local.sync_status,
      parentClientId: local.parent_client_id,
    };
  }

  private _appendToLastMessage(chunk: string) {
    const currentSessionId =
      this._sessionController?.value.state.currentSessionId;
    if (!this._repository || !currentSessionId) return;

    // Track streaming session to detect session switches
    this._streamingSessionId = currentSessionId;

    const state = this._repository.getSessionState(currentSessionId);
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg) return;

    // Append chunk to the ContentData's data field (text type uses string data)
    const newData =
      typeof lastMsg.content.data === 'string'
        ? (lastMsg.content.data as string) + chunk
        : JSON.stringify(lastMsg.content.data) + chunk;

    this._repository.patchMessage(
      currentSessionId,
      lastMsg.clientId,
      (msg) => ({
        ...msg,
        content: { ...msg.content, data: newData },
        streaming: true,
      }),
    );

    this.host.requestUpdate();
  }

  private _finalizeLastMessage() {
    const currentSessionId =
      this._sessionController?.value.state.currentSessionId;
    if (!this._repository || !currentSessionId) return;

    // Check if session changed during streaming - if so, skip finalization
    // to prevent stale streaming operations from affecting the new session
    if (
      this._streamingSessionId &&
      this._streamingSessionId !== currentSessionId
    ) {
      log.debug(
        `Skipping finalize: session changed from ${this._streamingSessionId} to ${currentSessionId}`,
      );
      this._streamingSessionId = undefined;
      return;
    }

    const state = this._repository.getSessionState(currentSessionId);
    const lastMsg = state.messages[state.messages.length - 1];
    if (!lastMsg) return;

    this._repository.patchMessage(
      currentSessionId,
      lastMsg.clientId,
      (msg) => ({
        ...msg,
        streaming: false,
      }),
    );

    // Clear streaming session tracker
    this._streamingSessionId = undefined;

    this.host.requestUpdate();
  }

  private _clearMessages() {
    // Reset repository state for the current session.
    // Must clear hasMore and cursors alongside the messages array to prevent
    // stale pagination state from triggering loadMore on an empty session.
    const currentSessionId =
      this._sessionController?.value.state.currentSessionId;
    if (this._repository && currentSessionId) {
      this._repository.updateMessages(currentSessionId, []);
      this._repository.setHasMore(currentSessionId, false);
      this._repository.setHasMoreNewer(currentSessionId, false);
      // Clear residual cursors to maintain state consistency
      this._repository.setOldestOffset(currentSessionId, '');
      this._repository.setNewestOffset(currentSessionId, '');
    }

    // Cancel any in-flight streaming operations to prevent them from
    // affecting the new session after a session switch
    this._cancelStreaming();

    // Proactively clean up session chain for the cleared session to free memory.
    // This prevents accumulation of stale chains when switching between sessions.
    // Note: We only delete the current session's chain; other sessions' chains
    // are managed by LRU eviction in _getUpdateChain().
    if (currentSessionId) {
      this._sessionUpdateChains.delete(currentSessionId);
    }

    this.host.requestUpdate();
  }

  /**
   * Cancel any in-flight streaming operations.
   * Called during session switch to prevent stale streaming updates
   * from the old session from affecting the new session.
   */
  private _cancelStreaming() {
    if (this._streamingSessionId) {
      log.debug(
        `Cancelling streaming for session: ${this._streamingSessionId}`,
      );
      this._streamingSessionId = undefined;
    }
  }
}
