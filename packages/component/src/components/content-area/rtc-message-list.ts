/**
 * RTC Message List Component
 *
 * Renders messages in a scrollable container with timeline layout.
 * Each `<rtc-message-list>` subscribes directly to `MessageRepository` for a
 * specific `sessionId`. This allows multiple instances to coexist (e.g. one per
 * open tab) without relying on a shared `MessageContext`.
 *
 * ## Auto-scroll mechanism (Intent-Based Architecture)
 *
 * Auto-scroll is controlled by a **computed property** `_shouldAutoScroll()` that
 * combines geometric state (`_userAtBottom`) with behavioral intent (`_followInvalidatedUntil`):
 *
 * 1. **`_userAtBottom`** (geometric, `@state`): updated by `_onScroll` on every scroll event.
 *    `distanceFromBottom < AT_BOTTOM_THRESHOLD_PX (300)` → true.
 *
 * 2. **`_followInvalidatedUntil`** (behavioral, plain field): set ONLY by user input events
 *    (wheel, touchstart, pointerdown, keydown) to `Date.now() + 450ms`. Self-expires after
 *    450ms of user inactivity. Programmatic scrolls do NOT modify this field.
 *
 * 3. **`_shouldAutoScroll()`** = `_userAtBottom && Date.now() >= _followInvalidatedUntil`.
 *    Called by `updated()`, `_scheduleScroll()`, ResizeObserver.
 *
 * 4. **ResizeObserver** handles async content (Markdown rendering, thinking expansion).
 *    Scrolls to bottom only if `_shouldAutoScroll()` is true.
 *
 * @element rtc-message-list
 * @csspart scroll - The scroll container
 * @csspart inner - The inner message container
 */
import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import {
  localeContext,
  type LocaleContextValue,
  sourceLocale,
  targetLocales,
} from '../../core/i18n.js';
import { styles } from './rtc-message-list.styles.js';
import { skeletonStyles } from './rtc-message-list.skeleton-styles.js';
import {
  SettingsContext,
  type SettingsContextValue,
} from '../../contexts/settings.js';
import type { MessageController } from '../../controllers/message.controller.js';
import type { Message, MessageState } from '../../types/index.js';
import './rtc-message.js';
import { createLogger } from '@rtc-agent/protocol';

const log = createLogger('MessageList');

import './rtc-user-message.js';
import './rtc-toolcall-card.js';
import './rtc-toolcall-reply.js';
import './rtc-error-message.js';
import {
  MessageVirtualScroll,
  type WindowBoundary,
  type StatefulComponent,
} from '../../utils/message-virtual-scroll.js';
import { MessageSkeletonGenerator } from '../../utils/message-skeleton.js';

/** Type guard: check if an element implements StatefulComponent */
function isStatefulComponent(el: Element): el is Element & StatefulComponent {
  return (
    'getState' in el &&
    typeof (el as Element & StatefulComponent).getState === 'function' &&
    'setState' in el &&
    typeof (el as Element & StatefulComponent).setState === 'function'
  );
}

/** Duration of toolcall jump highlight animation. */
const HIGHLIGHT_ANIMATION_MS = 2000;
/** Distance from bottom threshold for "at bottom" detection (px). Matches Telegram's SCROLLED_DOWN_THRESHOLD. */
const AT_BOTTOM_THRESHOLD_PX = 300;
/** Duration of the follow-invalidation window after user input (ms). Matches Telegram's streamFollowInvalidatedUntil. */
const FOLLOW_INVALIDATE_DURATION_MS = 450;
/** Follow-invalidation duration for explicit navigation (scrollToMessage, toolcall jump). */
const NAVIGATION_INVALIDATE_DURATION_MS = 2000;

@localized()
@customElement('rtc-message-list')
export class RtcMessageList extends LitElement {
  static styles = [styles, skeletonStyles];

  /** Session ID for this message list instance. */
  @property({ type: String })
  sessionId: string | null = null;

  /** Message controller for accessing repository. */
  @property({ attribute: false })
  messageController?: MessageController;

  @consume({ context: localeContext, subscribe: true })
  @state()
  private _localeCtx: LocaleContextValue = {
    locale: sourceLocale,
    setLocale: async () => {
      log.warn('Locale context not initialized');
    },
    locales: [sourceLocale, ...targetLocales],
  };

  @consume({ context: SettingsContext, subscribe: true })
  @state()
  private _settingsCtx: SettingsContextValue = {
    state: {
      appearance: { theme: 'system', fontSize: 14 },
      chat: { sendShortcut: 'Enter', density: 'comfortable' },
      files: { autoSave: true, defaultViewMode: 'split' },
      notifications: { soundEnabled: true, toastEnabled: true },
    },
    actions: {
      updateAppearance: () => {},
      updateChat: () => {},
      updateFiles: () => {},
      updateNotifications: () => {},
      resetAll: () => {},
    },
  };

  // ── Repository subscription state ──

  /** Unsubscribe function returned by MessageRepository.subscribe(). */
  private _subscription?: () => void;

  /** Messages for the current session (driven by repository subscription). */
  @state()
  private _messages: Message[] = [];

  /** Whether older messages are available (backward pagination). */
  @state()
  private _hasMore = false;

  /** Whether initial messages are still loading */
  @state()
  private _isLoading = true;

  @state()
  private _showNewBtn = false;

  @state()
  private _userAtBottom = true;

  /** RAF handle for scroll event throttling (performance optimization) */
  private _scrollRAF: number | null = null;

  /** Debounce timer for loadMore operations to prevent rapid successive calls */
  private _loadMoreDebounceTimer?: number;
  private _loadMoreInProgress = false;

  /**
   * Follow-invalidation timestamp for auto-scroll.
   *
   * **Behavioral intent**, NOT scroll position. Set ONLY by user input events
   * (wheel, touchstart, pointerdown, keydown) via `_setupFollowInvalidation()`.
   *
   * When `Date.now() < _followInvalidatedUntil`, auto-scroll is suppressed.
   * After 450ms of user inactivity, it self-expires — no "user stopped scrolling"
   * detection needed.
   *
   * This breaks the feedback loop: programmatic scrolls do NOT modify this field,
   * so they cannot re-enable auto-scroll against user intent.
   *
   * Consumed by: `_shouldAutoScroll()` method (computed property).
   */
  private _followInvalidatedUntil = 0;

  private _scrollEl?: HTMLElement;
  private _resizeObserver?: ResizeObserver;
  private _resizeDebounceTimer?: number;

  /** Document visibility change listener for browser window blur/focus */
  private _documentVisibilityHandler?: () => void;

  /** Tracked short-lived timers — cleared in disconnectedCallback to prevent leaks. */
  private _virtualScrollOpTimer?: number;
  private _highlightTimer?: number;
  private _scrollToMessageTimer?: number;
  private _scrollToBottomTimer?: number;

  /** Debounce timer for scroll-to-bottom operations */
  private _scrollDebounceTimer?: number;

  /** Flag to track if new messages arrived while Tab was hidden */
  private _hasNewMessagesWhileHidden = false;

  /** Virtual scroll instance for efficient rendering */
  private _virtualScroll?: MessageVirtualScroll<Message>;

  /**
   * WeakMap cache for getChangeableContent in virtual scroll.
   *
   * PERFORMANCE: Avoids creating a new object on every comparison during streaming.
   * Keyed by Message object reference — when the repository emits a new array with
   * new Message objects, cache misses naturally and old entries are GC'd via WeakMap.
   * Same reference hits the cache, eliminating per-comparison object allocation.
   */
  private _changeableContentCache = new WeakMap<Message, {
    content: Message['content'];
    status: Message['syncStatus'];
    timestamp: Message['timestamp'];
    streaming: Message['streaming'];
  }>();

  /** Flag to prevent ResizeObserver feedback loop during virtual scroll operations */
  private _isVirtualScrollOperation = false;

  /**
   * Monotonically increasing version counter for scroll debouncing.
   * Each scroll request increments and captures the current value.
   * Before executing, the async scroll checks if its version is still current.
   * A newer request invalidates older ones -- no boolean flag needed.
   */
  private _scrollVersion = 0;

  get messages(): Message[] {
    return this._messages;
  }

  /**
   * Public API: scroll to the bottom of the message list.
   * Called by parent components (e.g., rtc-content-area) when needed.
   */
  scrollToBottom() {
    this._followInvalidatedUntil = 0; // Resume follow intent
    this._scrollToBottom(true);
  }

  /**
   * Unified scroll-to-bottom method with optional debouncing.
   *
   * @param immediate - If true, scrolls immediately. If false, debounces by 50ms.
   *
   * This is the single entry point for all scroll-to-bottom operations.
   * It checks virtual scroll readiness and applies debouncing to prevent
   * rapid successive scrolls from causing jank.
   */
  private _scrollToBottom(immediate = false) {
    if (immediate) {
      this._doScrollToBottom();
    } else {
      // Debounce: clear any pending scroll and schedule a new one
      clearTimeout(this._scrollDebounceTimer);
      this._scrollDebounceTimer = window.setTimeout(() => {
        this._doScrollToBottom();
      }, 50);
    }
  }

  /**
   * Internal scroll-to-bottom execution.
   * Only scrolls if virtual scroll is ready.
   */
  private _doScrollToBottom() {
    if (!this._virtualScroll?.isReady) {
      log.debug('Virtual scroll not ready, skipping scroll to bottom');
      return;
    }

    this._virtualScroll.scrollToBottom();
    this._userAtBottom = true;
    this._showNewBtn = false;
  }

  /**
   * Public API: scroll to a specific message by clientId.
   * Called by parent components to navigate to a particular message.
   *
   * Phase 5 (I3): Enhanced with debounce and skeleton awareness.
   * - Debounces rapid successive calls (100ms)
   * - If target is a skeleton placeholder, sync-restores it first
   * - Falls back to DOM query if virtual scroll is not initialized
   */
  scrollToMessage(clientId: string): void {
    // Debounce: prevent rapid successive calls from blocking main thread
    clearTimeout(this._scrollToMessageTimer);
    this._scrollToMessageTimer = window.setTimeout(() => {
      this._doScrollToMessage(clientId);
    }, 100);
  }

  private _doScrollToMessage(clientId: string): void {
    if (!this._scrollEl) return;

    // Phase 5 (I3): If virtual scroll has the item as a skeleton, sync-restore it first
    if (this._virtualScroll?.isPlaceholder(clientId)) {
      this._virtualScroll.syncRestorePlaceholder(clientId);
    }

    // Try to find the element (may have just been restored from skeleton)
    const el = this._scrollEl.querySelector(
      `[data-client-id="${clientId}"]`,
    ) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief follow invalidation: let the smooth scroll animation complete
      // and give the user time to view the message. After 2s, if the user
      // is still at bottom, auto-scroll resumes naturally via _userAtBottom.
      this._followInvalidatedUntil =
        Date.now() + NAVIGATION_INVALIDATE_DURATION_MS;
    }
  }

  firstUpdated() {
    this._scrollEl = this.shadowRoot!.querySelector(
      '.message-list-scroll',
    ) as HTMLElement;
    const innerEl = this.shadowRoot!.querySelector(
      '.message-list-inner',
    ) as HTMLElement;

    // Defeat browser scroll restoration on initial mount: force scrollTop to 0
    // so the first `updated()` cycle can scroll cleanly to the bottom.
    if (this._scrollEl) {
      this._scrollEl.scrollTop = 0;
      // Add scroll listener for UI state updates (button visibility, geometric state)
      this._scrollEl.addEventListener('scroll', this._onScroll, {
        passive: true,
      });
    }

    // Setup follow invalidation: user input events immediately suppress auto-scroll
    this._setupFollowInvalidation();

    // Initialize virtual scroll
    if (this._scrollEl && innerEl) {
      this._virtualScroll = new MessageVirtualScroll<Message>({
        scrollContainer: this._scrollEl,
        innerContainer: innerEl,
        renderItem: (msg, index) => this._renderMessageElement(msg, index),
        getItemId: (msg) => msg.clientId,
        onLoadMore: (direction, boundary) =>
          this._handleVirtualScrollLoadMore(direction, boundary),
        query: '[data-client-id]',
        preloadThreshold: 300, // Telegram uses 300px
        bufferMessages: 20,
        // Extract only the fields that affect rendering for efficient comparison.
        // Tab switching returns new array references with identical content;
        // comparing only these fields avoids unnecessary Markdown DOM recreation.
        // PERFORMANCE: WeakMap cache avoids per-comparison object allocation during streaming.
        getChangeableContent: (msg: Message) => {
          let cached = this._changeableContentCache.get(msg);
          if (!cached) {
            cached = {
              content: msg.content,
              status: msg.syncStatus,
              timestamp: msg.timestamp,
              streaming: msg.streaming,
            };
            this._changeableContentCache.set(msg, cached);
          }
          return cached;
        },
        // In-place update: preserve DOM state (rendered Markdown) during streaming.
        // Without this, each streaming token would destroy-rebuild the element,
        // causing flicker and breaking auto-scroll.
        updateItemElement: (el, msg, index) =>
          this._updateMessageElement(el, msg, index),
        // Phase 1+2: Create skeleton placeholder using MessageSkeletonGenerator
        createPlaceholder: (msg, height) =>
          MessageSkeletonGenerator.create(msg, height),
        // Phase 2: Extract component state before skeletonization
        extractComponentState: (_msg, el) => {
          if (isStatefulComponent(el)) {
            return el.getState();
          }
          return null;
        },
        // Phase 2: Inject component state after restoration
        injectComponentState: (_msg, el, state) => {
          if (isStatefulComponent(el)) {
            el.setState(state);
          }
        },
        // Phase 2+4: Check if item is stable (safe to skeletonize)
        isItemStable: (msg) => {
          // Streaming messages are unstable - content is actively changing
          if (msg.streaming) return false;

          // Recently arrived messages (< 2s) are unstable - Markdown may still be rendering
          if (msg.timestamp) {
            const age = Date.now() - new Date(msg.timestamp).getTime();
            if (age < 2000) return false;
          }

          // All other messages are stable
          return true;
        },
      });
    }

    // NOTE: _subscribeToSession() is NOT called here intentionally.
    // It is called from updated() when sessionId is in the changed set,
    // which includes the first render cycle. Calling it from both
    // firstUpdated() and updated() would cause a redundant subscribe +
    // fetchInitialMessages on initial mount.

    // ResizeObserver: safety net for post-render content growth.
    // Fires when inner container size changes (streaming chunks, late Markdown,
    // thinking-block expansion). Uses debounced scroll to handle async renders
    // (e.g., Markdown that renders after the initial updateComplete).
    // IMPORTANT: Ignore resizes from virtual scroll's own operations to prevent feedback loop.
    if (innerEl) {
      this._resizeObserver = new ResizeObserver(() => {
        // Ignore resizes from virtual scroll operations (prependItems/appendItems)
        if (this._isVirtualScrollOperation) return;

        if (!this._shouldAutoScroll()) return;
        // Debounced compensation: handles late async renders (Markdown, etc.)
        // 50ms provides responsive UX during streaming while preventing feedback loops.
        clearTimeout(this._resizeDebounceTimer);
        this._resizeDebounceTimer = window.setTimeout(() => {
          if (this._shouldAutoScroll() && !this._isVirtualScrollOperation) {
            // Use debounced scroll to prevent rapid successive scrolls
            this._scrollToBottom(false);
          }
        }, 50);
      });
      this._resizeObserver.observe(innerEl);
    }

    // Listen for toolcall jump events (from rtc-toolcall-reply)
    this.addEventListener(
      'rtc-toolcall-jump',
      this._handleToolcallJump as EventListener,
    );

    // Listen for browser window visibility changes (blur/focus)
    // This works alongside Tab visibility (onTabVisibilityChange) to ensure
    // the virtual scroll pauses when the user leaves the browser window
    this._documentVisibilityHandler = () => {
      // Only update if we have a virtual scroll and the Tab is currently active
      // (Tab visibility is controlled by onTabVisibilityChange)
      if (this._virtualScroll) {
        // Check if this Tab is the active one
        const tabContent = this.closest('.tab-content');
        const isTabActive = tabContent?.classList.contains('active') ?? true;

        // Update visibility: visible only if both document and Tab are visible
        const isVisible = !document.hidden && isTabActive;
        this._virtualScroll.setVisibility(isVisible);
      }
    };
    document.addEventListener(
      'visibilitychange',
      this._documentVisibilityHandler,
    );
  }

  /**
   * Subscribe to MessageRepository for the current session.
   * Called on firstUpdated and when sessionId changes.
   */
  private _subscribeToSession() {
    if (!this.sessionId || !this.messageController) return;

    // Unsubscribe from previous session
    this._subscription?.();
    this._subscription = undefined;

    // Reset loading state for new session
    this._isLoading = true;

    // Clear virtual scroll for new session
    this._virtualScroll?.clear();
    // Only assign a new empty array if current _messages is non-empty.
    // Avoids creating a new reference (and triggering @state change detection)
    // when _messages is already empty.
    if (this._messages.length > 0) {
      this._messages = [];
    }

    try {
      // Subscribe to repository for this session
      this._subscription = this.messageController.repository.subscribe(
        this.sessionId,
        (data: MessageState) => {
          this._handleMessagesUpdate(data);
        },
      );

      // Trigger initial data load
      this.messageController.fetchInitialMessages(this.sessionId);
    } catch (err) {
      log.debug('Repository not ready:', (err as Error).message);
      this._isLoading = false;
    }
  }

  /**
   * Handle messages update from repository subscription.
   * Simplified: just call setItems, which handles all diff logic internally.
   */
  private _handleMessagesUpdate(data: MessageState) {
    const oldMessages = this._messages;
    const newMessages = data.messages;

    // Track if new messages arrived while Tab was hidden
    // This is used by onTabVisibilityChange to scroll to bottom when Tab becomes visible
    if (this._virtualScroll && newMessages.length > oldMessages.length) {
      // Check if Tab is currently hidden (virtual scroll is not visible)
      const isTabHidden = !this._virtualScroll.isVisible();
      if (isTabHidden) {
        this._hasNewMessagesWhileHidden = true;
      }
    }

    // Update loading state - once we receive any messages, we're done loading
    if (newMessages.length > 0 || data.hasMore === false) {
      this._isLoading = false;
    }

    if (!this._virtualScroll) {
      this._messages = newMessages;
      this._hasMore = data.hasMore;
      return;
    }

    // Update _messages BEFORE virtual scroll operations so that
    // _renderMessageElement can correctly determine isLast
    this._messages = newMessages;

    // Mark as virtual scroll operation to prevent auto-scroll interference
    this._isVirtualScrollOperation = true;

    // Smart setItems handles all diff logic internally:
    // - Detects prepend/append/update/middle-insert/removal
    // - Applies optimal DOM operations with scroll compensation
    // - No need for complex change detection here!
    this._virtualScroll.setItems(newMessages);

    // Auto-scroll only on initial load (empty → items)
    if (
      oldMessages.length === 0 &&
      newMessages.length > 0 &&
      this._shouldAutoScroll()
    ) {
      // Initial load: scroll to bottom immediately
      this._scrollToBottom(true);
    }

    // Reset flag after a short delay to allow ResizeObserver to fire and be ignored
    clearTimeout(this._virtualScrollOpTimer);
    this._virtualScrollOpTimer = window.setTimeout(() => {
      this._isVirtualScrollOperation = false;
    }, 50);

    this._hasMore = data.hasMore;

    // Update loadedTop/loadedBottom based on hasMore AND virtual scroll alignment.
    //
    // Key insight: hasMore only tells us if the REPOSITORY has more messages.
    // But the virtual scroll may have sliced away messages that are still in the repository.
    // So loadedTop should be true only when:
    //   1. hasMore=false (no more messages in DB), AND
    //   2. Virtual scroll's first item = repository's first item (nothing was sliced away)
    //
    // If messages were sliced away, loadedTop must be false so scrolling back
    // triggers loadMore to restore them from repository cache.
    if (this._virtualScroll) {
      const stats = this._virtualScroll.getStats();
      const repoFirstId =
        newMessages.length > 0 ? newMessages[0].clientId : undefined;
      const repoLastId =
        newMessages.length > 0
          ? newMessages[newMessages.length - 1].clientId
          : undefined;

      // loadedTop: repository has no more AND virtual scroll starts at repository's first
      if (this._hasMore === false && stats.firstId === repoFirstId) {
        this._virtualScroll.setFullyLoaded('top', true);
      } else if (
        this._hasMore === true ||
        (stats.firstId !== undefined && stats.firstId !== repoFirstId)
      ) {
        this._virtualScroll.setFullyLoaded('top', false);
      }

      // loadedBottom: repository has no more newer AND virtual scroll ends at repository's last
      if (data.hasMoreNewer === false && stats.lastId === repoLastId) {
        this._virtualScroll.setFullyLoaded('bottom', true);
      } else if (
        data.hasMoreNewer === true ||
        (stats.lastId !== undefined && stats.lastId !== repoLastId)
      ) {
        this._virtualScroll.setFullyLoaded('bottom', false);
      }
    }
  }

  /**
   * Auto-scroll decision point.
   *
   * The component is responsible for its own scrolling. It does not analyze
   * what kind of change happened (growth, shrink, reorder, toolcall merge, etc.).
   * It only asks two questions:
   *
   * 1. **Did messages change?** (`_messages` changed) → if following, scroll to bottom.
   * 2. **Did session change?** (`sessionId` changed) → reset follow intent to true,
   *    then scroll to bottom (user expects to see latest messages in a new session).
   *
   * Async content rendering (Markdown, tool call expansion) is handled by
   * ResizeObserver, which scrolls when the inner container size changes.
   *
   * Load-more (prepend) is a special case: preserve scroll position via anchor.
   */
  updated(changed: Map<string, unknown>) {
    super.updated(changed);

    // Set density attribute for CSS styling
    const density = this._settingsCtx.state.chat.density;
    this.setAttribute('data-density', density);

    // --- Session switch: clear virtual scroll, re-subscribe, scroll to bottom ---
    if (changed.has('sessionId')) {
      this._virtualScroll?.clear();
      // Defer subscription and @state mutations to avoid Lit "change-in-update" warning.
      // _subscribeToSession() sets @state _messages and the subscription callback
      // sets @state _messages/_hasMore — doing this synchronously inside updated()
      // triggers requestUpdate() during the active update cycle.
      queueMicrotask(() => {
        this._subscribeToSession();
        this._followInvalidatedUntil = 0; // Reset behavioral intent: follow new session
        // Session switch: scroll to bottom immediately
        this._scrollToBottom(true);
      });
    }

    // --- Messages changed: scroll if following ---
    // Virtual scroll handles its own scroll preservation via ScrollSaver.
    // We only need to scroll to bottom for new messages (append).
    if (changed.has('_messages')) {
      if (this._shouldAutoScroll()) {
        this._scheduleScroll();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._scrollEl?.removeEventListener('scroll', this._onScroll);
    this._resizeObserver?.disconnect();
    clearTimeout(this._resizeDebounceTimer);
    clearTimeout(this._virtualScrollOpTimer);
    clearTimeout(this._highlightTimer);
    clearTimeout(this._scrollToMessageTimer);
    clearTimeout(this._scrollToBottomTimer);
    clearTimeout(this._loadMoreDebounceTimer);
    clearTimeout(this._scrollDebounceTimer);
    // Cleanup scroll RAF to prevent memory leaks
    if (this._scrollRAF !== null) {
      cancelAnimationFrame(this._scrollRAF);
      this._scrollRAF = null;
    }
    this.removeEventListener(
      'rtc-toolcall-jump',
      this._handleToolcallJump as EventListener,
    );

    // Cleanup document visibility listener
    if (this._documentVisibilityHandler) {
      document.removeEventListener(
        'visibilitychange',
        this._documentVisibilityHandler,
      );
      this._documentVisibilityHandler = undefined;
    }

    this._subscription?.();
    this._subscription = undefined;
    this._virtualScroll?.dispose();
    this._virtualScroll = undefined;
    // Clear WeakMap cache — old Message refs are no longer meaningful
    this._changeableContentCache = new WeakMap();
  }

  /**
   * Tab visibility handler - called by parent component when tab switches.
   *
   * This is the primary mechanism for the visibility state machine:
   * - When Tab becomes active: setVisibility(true) → VISIBLE state
   * - When Tab becomes inactive: setVisibility(false) → HIDDEN state
   *
   * The state machine ensures:
   * - HIDDEN: pauses all skeletonize/restore operations (prevents bug)
   * - VISIBLE: synchronously rebuilds skeleton positions and restores visible skeletons
   *
   * @param visible - Whether the tab is currently visible (active)
   */
  onTabVisibilityChange(visible: boolean): void {
    if (this._virtualScroll) {
      this._virtualScroll.setVisibility(visible);

      // Tab became visible: if new messages arrived while hidden, scroll to bottom
      if (visible && this._hasNewMessagesWhileHidden && this._shouldAutoScroll()) {
        this._scrollToBottom(true);
        this._hasNewMessagesWhileHidden = false;
      }
    }
  }

  /**
   * Computed property: whether auto-scroll should fire.
   *
   * Combines geometric state (`_userAtBottom`) with behavioral intent
   * (`_followInvalidatedUntil`). This is NOT a stored field — it's computed
   * on every access, so there's no state to manage and no feedback loop possible.
   *
   * Architecture: mirrors Telegram's `scrolledDown && Date.now() >= streamFollowInvalidatedUntil`.
   */
  private _shouldAutoScroll(): boolean {
    return this._userAtBottom && Date.now() >= this._followInvalidatedUntil;
  }

  /**
   * Schedule a scroll-to-bottom after the current render completes.
   *
   * Uses a version counter for clean debouncing:
   * - Each call increments `_scrollVersion`
   * - The async callback captures its version
   * - If version is stale when callback runs, a newer request has superseded it
   *
   * Waits for:
   * 1. `this.updateComplete` -- this component's render is done (new message
   *    element is in the DOM)
   * 2. All child message elements' `updateComplete` -- their first render
   *    (empty content for async Markdown, complete for sync components)
   *
   * Note: async Markdown rendering (marked + DOMPurify + highlight.js) happens
   * AFTER the child's first `updateComplete` resolves. The ResizeObserver is the
   * safety net that scrolls again when the content actually renders and the inner
   * container size changes.
   */
  private _scheduleScroll() {
    const version = ++this._scrollVersion;

    this.updateComplete
      .then(async () => {
        if (version !== this._scrollVersion) return;

        // Wait for all message children to finish their first render
        const msgEls = this.shadowRoot!.querySelectorAll(
          'rtc-message, rtc-user-message, rtc-toolcall-card, rtc-error-message',
        );
        if (msgEls.length > 0) {
          await Promise.all(
            Array.from(msgEls).map((el) => (el as LitElement).updateComplete),
          );
        }

        if (version !== this._scrollVersion) return;
        // Re-check follow intent before scrolling — user may have scrolled
        // up while we were waiting for updateComplete.
        if (!this._shouldAutoScroll()) return;
        // Use debounced scroll for async content updates
        this._scrollToBottom(false);
      })
      .catch((err) => {
        log.error('Scheduled scroll after update failed:', err);
      });
  }

  /**
   * Set scroll position. _onScroll always processes scroll events normally
   * (geometric state update). After programmatic scroll to bottom, _onScroll
   * calculates distanceFromBottom ≈ 0 and sets _userAtBottom = true — the same
   * value _scrollToBottom() would set. No suppression needed.
   *
   * The virtual scroll's scroll handler may fire, but it has its own guards
   * (1.5s debounce, stability checks, _isVirtualScrollOperation) so this is harmless.
   */

  /**
   * Register user input event listeners to invalidate follow intent.
   *
   * Architecture: mirrors Telegram's `streamFollowInvalidatedUntil` pattern.
   * Any user input (wheel, touchstart, pointerdown, keydown) extends the
   * invalidation timestamp by 450ms. Every auto-scroll check reads
   * `Date.now() < _followInvalidatedUntil` — if the user touched anything
   * in the last 450ms, the follow is skipped.
   *
   * This is the key mechanism that breaks the feedback loop:
   * - User intent is detected from INPUT EVENTS, not scroll position
   * - Programmatic scrolls do NOT fire wheel/touchstart/pointerdown/keydown
   * - Therefore programmatic scrolls cannot re-enable auto-scroll
   */
  private _setupFollowInvalidation() {
    if (!this._scrollEl) return;

    const invalidate = () => {
      this._followInvalidatedUntil = Date.now() + FOLLOW_INVALIDATE_DURATION_MS;
    };

    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      this._scrollEl.addEventListener(event, invalidate, { passive: true });
    }
  }

  private _onScroll = () => {
    if (!this._scrollEl) return;

    // Guard: during programmatic scroll-to-bottom (smooth scroll from button click),
    // skip geometric state update to prevent UI flicker.
    if (this._scrollingToBottom) return;

    // PERFORMANCE: Use requestAnimationFrame to throttle scroll updates.
    // This reduces unnecessary re-renders during rapid scroll events.
    // The actual state update happens on the next animation frame.
    if (this._scrollRAF !== null) {
      cancelAnimationFrame(this._scrollRAF);
    }

    this._scrollRAF = requestAnimationFrame(() => {
      this._scrollRAF = null;

      if (!this._scrollEl) return;

      const { scrollHeight, scrollTop, clientHeight } = this._scrollEl;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      // Pure geometric state: is the user at the bottom?
      // Threshold 300px (matches Telegram's SCROLLED_DOWN_THRESHOLD).
      // No hysteresis needed — this is purely geometric, not behavioral.
      const atBottom = distanceFromBottom < AT_BOTTOM_THRESHOLD_PX;

      // UI state
      this._userAtBottom = atBottom;
      this._showNewBtn = !atBottom;

      // NOTE: _onScroll does NOT modify _followInvalidatedUntil or _shouldAutoScroll().
      // Behavioral intent is controlled exclusively by user input events
      // (wheel/touchstart/pointerdown/keydown) via _setupFollowInvalidation().
      // This breaks the feedback loop where programmatic scrolls could re-enable auto-scroll.
    });
  };

  /**
   * Handle virtual scroll's onLoadMore callback.
   * Triggers load-more from repository. The actual prepend/append is handled by
   * _handleMessagesUpdate via repository subscription.
   * Returns empty array since we don't prepend/append here.
   *
   * IMPORTANT: For bottom direction, first check if repository has messages
   * after the current window (from viewport slicing). If yes, return them
   * directly from cache instead of going to DB.
   *
   * Includes debouncing to prevent rapid successive calls from overwhelming
   * the repository and causing UI jank.
   */
  private async _handleVirtualScrollLoadMore(
    direction: 'top' | 'bottom',
    boundary: WindowBoundary,
  ): Promise<Message[]> {
    if (!this.sessionId || !this.messageController) return [];

    // Debounce: prevent rapid successive calls (e.g., from scroll events)
    // If a load is already in progress, wait and retry
    if (this._loadMoreInProgress) {
      log.debug('loadMore already in progress, skipping');
      return [];
    }

    // Clear any pending debounce timer
    clearTimeout(this._loadMoreDebounceTimer);

    return new Promise<Message[]>((resolve) => {
      this._loadMoreDebounceTimer = window.setTimeout(async () => {
        this._loadMoreInProgress = true;
        try {
          const result = await this._doLoadMore(direction, boundary);
          resolve(result);
        } finally {
          this._loadMoreInProgress = false;
        }
      }, 100); // 100ms debounce delay — balances responsiveness with call throttling
    });
  }

  /**
   * Internal loadMore implementation (extracted for debouncing).
   */
  private async _doLoadMore(
    direction: 'top' | 'bottom',
    boundary: WindowBoundary,
  ): Promise<Message[]> {
    if (!this.sessionId || !this.messageController) return [];

    try {
      // Snapshot message count before load to detect if anything arrived
      const countBefore = this._messages.length;

      if (direction === 'top') {
        if (!boundary.firstId) return [];

        // First, check if repository has messages BEFORE the current window.
        // Virtual scroll's _sliceViewport removes items from its internal _items,
        // but they're still in repository's messages array. Return them from cache
        // instead of going to DB.
        const repoState = this.messageController.repository.getSessionState(
          this.sessionId,
        );
        const firstRenderedId = boundary.firstId;
        const firstRenderedIndex = repoState.messages.findIndex(
          (m) => m.clientId === firstRenderedId,
        );

        if (firstRenderedIndex > 0) {
          // Repository has messages before the current window — return from cache
          const cachedOlder = repoState.messages.slice(0, firstRenderedIndex);
          log.debug(
            `loadMore(top): returning ${cachedOlder.length} messages from repository cache`,
          );
          return cachedOlder;
        }

        // No cached messages before the window — try loading from DB
        await this.messageController.loadMoreForSession(this.sessionId);

        // After loadMore, check if we should mark loadedTop=true.
        // Only mark true if hasMore=false AND virtual scroll's first item
        // matches repository's first item (no sliced-away messages above).
        const repoStateAfter =
          this.messageController.repository.getSessionState(this.sessionId);
        const repoFirstId =
          repoStateAfter.messages.length > 0
            ? repoStateAfter.messages[0].clientId
            : undefined;
        if (!repoStateAfter.hasMore && boundary.firstId === repoFirstId) {
          log.debug(
            'loadMore(top): hasMore=false and aligned, marking loadedTop=true',
          );
          this._virtualScroll?.setFullyLoaded('top', true);
        }
      } else {
        // direction === 'bottom'
        if (!boundary.lastId) return [];

        // First, check if repository has messages after the current window.
        // Virtual scroll's _sliceViewport removes items from its internal _items,
        // but they're still in repository's messages array. Return them from cache
        // instead of going to DB.
        const repoState = this.messageController.repository.getSessionState(
          this.sessionId,
        );
        const lastRenderedId = boundary.lastId;
        const lastRenderedIndex = repoState.messages.findIndex(
          (m) => m.clientId === lastRenderedId,
        );

        if (
          lastRenderedIndex >= 0 &&
          lastRenderedIndex < repoState.messages.length - 1
        ) {
          // Repository has messages after the current window — return from cache
          const cachedNewer = repoState.messages.slice(lastRenderedIndex + 1);
          log.debug(
            `loadMore(bottom): returning ${cachedNewer.length} messages from repository cache`,
          );
          return cachedNewer;
        }

        // No cached messages — try loading from DB via loadNewerForSession
        // But first check if there might be newer messages (hasMoreNewer)
        // Since hasMoreNewer is rarely set, we still try the load in case
        // new messages arrived from another tab or WebSocket
        await this.messageController.loadNewerForSession(this.sessionId);

        // If no new messages arrived, check if we should mark loadedBottom=true.
        // Only mark true if hasMoreNewer=false AND virtual scroll's last item
        // matches repository's last item (no sliced-away messages below).
        if (this._messages.length === countBefore) {
          const repoState = this.messageController.repository.getSessionState(
            this.sessionId,
          );
          const repoLastId =
            repoState.messages.length > 0
              ? repoState.messages[repoState.messages.length - 1].clientId
              : undefined;
          if (!repoState.hasMoreNewer && boundary.lastId === repoLastId) {
            log.debug(
              'loadMore(bottom): hasMoreNewer=false and aligned, marking loadedBottom=true',
            );
            this._virtualScroll?.setFullyLoaded('bottom', true);
          }
        }
      }

      // Return empty array - actual prepend/append is handled by _handleMessagesUpdate
      // (except for bottom cache hit above, which returns messages directly)
      return [];
    } catch (err) {
      log.error('loadMore failed:', err);
      return [];
    }
  }

  /**
   * Render a message element for virtual scroll.
   * Toolcall input renders as a card; output renders as a reply with jump.
   */
  private _renderMessageElement(msg: Message, index: number): HTMLElement {
    const isLast = index === this._messages.length - 1;

    // Error messages
    if (msg.content?.type === 'error') {
      const el = document.createElement('rtc-error-message');
      el.setAttribute('data-client-id', msg.clientId);
      el.message = msg;
      return el;
    }

    // Toolcall input → card (output is rendered separately as reply)
    if (msg.content?.type === 'toolcall_input') {
      const el = document.createElement('rtc-toolcall-card');
      el.setAttribute('data-client-id', msg.clientId);
      el.pair = { input: msg };
      if (isLast) el.setAttribute('is-last', '');
      return el;
    }

    // Toolcall output → reply (with clickable jump to input)
    if (msg.content?.type === 'toolcall_output') {
      // If no parentClientId, try to find the input message by tool call ID
      // Search backwards from current position, limit to 5 messages for efficiency
      let parentClientId = msg.parentClientId;
      if (!parentClientId) {
        const toolCallData = msg.content.data as { id?: string } | undefined;
        const toolCallId = toolCallData?.id;
        if (toolCallId) {
          // Find current message index and search backwards (max 5)
          const currentIndex = this._messages.findIndex(
            (m) => m.clientId === msg.clientId,
          );
          const startIndex = Math.max(0, currentIndex - 5);
          for (let i = currentIndex - 1; i >= startIndex; i--) {
            const m = this._messages[i];
            const inputData = m.content?.data as { id?: string } | undefined;
            if (
              m.content?.type === 'toolcall_input' &&
              inputData?.id === toolCallId
            ) {
              parentClientId = m.clientId;
              break;
            }
          }
        }
      }

      // Always render as rtc-toolcall-reply (even without parentClientId)
      // This ensures proper formatting with max-height constraint and scrolling
      const el = document.createElement('rtc-toolcall-reply');
      el.setAttribute('data-client-id', msg.clientId);
      // Create a new message object with the resolved parentClientId (may be undefined)
      el.message = { ...msg, parentClientId };
      return el;
    }

    // User messages
    if (msg.role === 'user') {
      const el = document.createElement('rtc-user-message');
      el.setAttribute('data-client-id', msg.clientId);
      el.message = msg;
      return el;
    }

    // Assistant/system messages (including prompt type) → rtc-message
    // Prompt messages (role: system, type: prompt) fall through to here
    // and are rendered by rtc-message's _renderPromptBlock().
    const el = document.createElement('rtc-message');
    el.setAttribute('data-client-id', msg.clientId);
    el.message = msg;
    if (isLast) {
      el.setAttribute('is-last', '');
    }
    return el;
  }

  /**
   * Update a message element in-place with new data.
   * Preserves DOM state (rendered Markdown) to prevent flicker during streaming.
   * Lit's property setter triggers requestUpdate() → lit-html diffing for efficient updates.
   */
  private _updateMessageElement(el: HTMLElement, msg: Message, index: number) {
    const isLast = index === this._messages.length - 1;
    const tagName = el.tagName.toLowerCase();

    // Update the appropriate property based on element type
    if (tagName === 'rtc-toolcall-card') {
      // Toolcall card: update the pair (input only, output is rendered separately)
      (el as HTMLElementTagNameMap['rtc-toolcall-card']).pair = {
        input: msg,
      };
    } else {
      // rtc-message, rtc-error-message, rtc-user-message, rtc-toolcall-reply: all have `message`
      (el as HTMLElement & { message: Message }).message = msg;
    }

    // Update is-last attribute (may have changed if messages were added/removed)
    if (isLast) {
      el.setAttribute('is-last', '');
    } else {
      el.removeAttribute('is-last');
    }
  }

  /**
   * Guard: prevents _onScroll from modifying geometric state (_userAtBottom)
   * during programmatic smooth scroll-to-bottom (initiated by _handleNewBtnClick).
   * Without this, _onScroll fires mid-animation and may cause UI flicker
   * (showNewBtn toggling) as the scroll position passes through non-bottom areas.
   */
  private _scrollingToBottom = false;

  private _handleNewBtnClick = () => {
    // Set intent FIRST (before scroll), so ResizeObserver safety net stays active
    this._followInvalidatedUntil = 0; // Resume follow intent
    this._userAtBottom = true;
    this._showNewBtn = false;

    if (this._scrollEl) {
      // 1. Synchronously restore all skeletons → scrollHeight becomes stable.
      //    Without this, smooth scroll targets a stale scrollHeight (captured at T0)
      //    while skeletons are being restored mid-animation, causing the scroll
      //    to stop short of the actual bottom.
      this._virtualScroll?.restoreAll();

      // 2. Now scrollHeight reflects the true bottom.
      //    Use _scrollingToBottom guard to prevent _onScroll from overriding intent.
      this._scrollingToBottom = true;
      this._scrollEl.scrollTo({
        top: this._scrollEl.scrollHeight,
        behavior: 'smooth',
      });

      // 3. Release guard after animation completes (~500ms)
      clearTimeout(this._scrollToBottomTimer);
      this._scrollToBottomTimer = window.setTimeout(() => {
        this._scrollingToBottom = false;
      }, 600);
    }
  };

  /**
   * Handle toolcall jump: scroll to the input message and highlight it.
   * Triggered by clicking the reply header in rtc-toolcall-reply.
   */
  private _handleToolcallJump = (
    e: CustomEvent<{ targetClientId: string }>,
  ) => {
    const { targetClientId } = e.detail;
    if (!targetClientId || !this._scrollEl) return;

    const el = this._scrollEl.querySelector(
      `[data-client-id="${targetClientId}"]`,
    ) as HTMLElement | null;
    if (!el) {
      // Input may have been sliced away — scroll to bottom as fallback
      log.debug(`Jump target ${targetClientId} not in DOM`);
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Brief follow invalidation for navigation
    this._followInvalidatedUntil =
      Date.now() + NAVIGATION_INVALIDATE_DURATION_MS;

    // Brief highlight animation
    el.classList.add('highlight');
    clearTimeout(this._highlightTimer);
    this._highlightTimer = window.setTimeout(
      () => el.classList.remove('highlight'),
      HIGHLIGHT_ANIMATION_MS,
    );
  };

  render() {
    void this._localeCtx.locale;
    // _userAtBottom is a @state driving re-render on scroll; consumed implicitly.
    void this._userAtBottom;

    // Show empty state when loading is complete and no messages exist
    const showEmptyState = !this._isLoading && this._messages.length === 0;

    // Virtual scroll manages DOM elements directly.
    // render() only provides the container structure.
    return html`
            <div class="message-list-scroll" part="scroll">
                <div class="message-list-inner" part="inner">
                    ${showEmptyState ? this._renderEmptyState() : nothing}
                    <!-- MessageVirtualScroll dynamically inserts message elements here -->
                </div>
            </div>
            <button
                class="new-message-btn"
                ?hidden=${!this._showNewBtn}
                @click=${this._handleNewBtnClick}
            >${msg('↓ 新消息')}</button>
        `;
  }

  /**
   * Render empty state placeholder when no messages exist.
   * Provides friendly feedback to users starting a new conversation.
   */
  private _renderEmptyState() {
    return html`
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 12h8M8 8h8M8 16h5" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="4" y="4" width="16" height="16" rx="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="empty-state-title">${msg('开始新对话')}</div>
        <div class="empty-state-description">${msg('发送消息开始与 AI 助手交流')}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rtc-message-list': RtcMessageList;
  }
}
