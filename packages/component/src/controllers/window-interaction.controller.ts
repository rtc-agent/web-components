/**
 * Window Interaction Controller
 *
 * Manages drag-to-move, resize, and keyboard controls for the floating window.
 * Does NOT own position/size state — delegates to WindowStateController via callbacks.
 *
 * Features:
 * - Drag via title bar (mouse/touch)
 * - Resize from 8 directions (4 corners + 4 edges)
 * - Keyboard controls with explicit mode activation
 * - Viewport boundary constraints
 * - Reduced motion support
 *
 * @example
 * ```typescript
 * const controller = new WindowInteractionController(this);
 *
 * // After Shadow DOM ready
 * controller.bindElements(this, titleBarElement);
 *
 * // Wire callbacks to WindowStateController
 * controller.onPositionChange = (x, y) => windowState.actions.setPosition(x, y);
 * controller.onSizeChange = (w, h) => windowState.actions.setSize(w, h);
 *
 * controller.actions.enable();
 * ```
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import interact from 'interactjs';
import type { InteractEvent } from '@interactjs/core/InteractEvent';
import type { ResizeEvent } from '@interactjs/actions/resize/plugin';
import { createLogger } from '@rtc-agent/client';

const log = createLogger('WindowInteractionController');

export interface InteractionState {
  isDragging: boolean;
  isResizing: boolean;
  interactionMode: 'none' | 'move' | 'resize';
}

export interface InteractionActions {
  enable(): void;
  disable(): void;
  enterMoveMode(): void;
  enterResizeMode(): void;
  exitInteractionMode(): void;
}

export interface WindowInteractionValue {
  state: InteractionState;
  actions: InteractionActions;
}

export class WindowInteractionController implements ReactiveController {
  value: WindowInteractionValue;

  // Callbacks — wired by host component
  onPositionChange?: (x: number, y: number) => void;
  onSizeChange?: (width: number, height: number) => void;

  private _host: ReactiveControllerHost;
  private _windowElement?: HTMLElement;
  private _titleBarElement?: HTMLElement;

  private _state: InteractionState = {
    isDragging: false,
    isResizing: false,
    interactionMode: 'none',
  };

  private _isEnabled = false;

  /** Window configuration */
  private _draggable = true;
  private _resizable = true;

  /** Defer config update (cache during interaction) */
  private _pendingConfig?: { draggable?: boolean; resizable?: boolean };

  /** Ghost preview element (lightweight visual feedback during drag/resize) */
  private _ghostElement?: HTMLElement;
  /** Ghost start state (used to compute delta) */
  private _ghostStartRect?: { left: number; top: number; width: number; height: number };
  /** Cumulative drag offset (during drag) */
  private _ghostDragOffset = { x: 0, y: 0 };
  /** Cached margin value (reused during drag/resize to avoid repeated getComputedStyle calls) */
  private _cachedMargin = 20;

  /** Bound keydown handler — stored so it can be removed on cleanup. */
  private _boundOnKeydown = (event: KeyboardEvent) => this._handleKeydown(event);

  constructor(host: ReactiveControllerHost, config?: { draggable?: boolean; resizable?: boolean }) {
    this._host = host;
    this._draggable = config?.draggable ?? true;
    this._resizable = config?.resizable ?? true;

    // selectstart event interception registered at enable time

    this.value = {
      state: this._state,
      actions: {
        enable: () => this._enable(),
        disable: () => this._disable(),
        enterMoveMode: () => this._enterMoveMode(),
        enterResizeMode: () => this._enterResizeMode(),
        exitInteractionMode: () => this._exitInteractionMode(),
      },
    };

    // Listen for reduced motion preference changes — currently unused since
    // ghost preview disables inertia unconditionally, but kept as a hook for
    // future animation tuning.
  }

  /** Update config */
  setConfig(config: { draggable?: boolean; resizable?: boolean }): void {
    // Fix 53: Check whether config actually changed
    const draggableChanged = config.draggable !== undefined && config.draggable !== this._draggable;
    const resizableChanged = config.resizable !== undefined && config.resizable !== this._resizable;

    if (!draggableChanged && !resizableChanged) {
      return; // No change, skip
    }

    // Fix 53: If interaction in progress, defer until interaction ends
    if (this._state.isDragging || this._state.isResizing) {
      log.debug('setConfig: interaction in progress, deferring');
      this._pendingConfig = config;
      return;
    }

    this._draggable = config.draggable ?? true;
    this._resizable = config.resizable ?? true;
    log.debug('setConfig:', {draggable: this._draggable, resizable: this._resizable});

    // Destroy existing interact instances first
    if (this._windowElement) {
      interact(this._windowElement).unset();
    }
    if (this._titleBarElement) {
      interact(this._titleBarElement).unset();
    }

    // Re-initialize interactions (if enabled)
    if (this._isEnabled) {
      this._initInteractions();
    }
  }

  /** Whether dragging is allowed */
  get draggable(): boolean {
    return this._draggable;
  }

  /** Whether resizing is allowed */
  get resizable(): boolean {
    return this._resizable;
  }

  /**
   * Bind DOM elements after Shadow DOM is ready.
   * Must be called before enable().
   */
  bindElements(windowElement: HTMLElement, titleBarElement: HTMLElement): void {
    this._windowElement = windowElement;
    this._titleBarElement = titleBarElement;
    this._initInteractions();
  }

  hostConnected(): void {
    // Viewport resize is handled by WindowStateController
  }

  hostDisconnected(): void {
    // Ensure ghost element is cleaned up (prevent leak when component is dynamically removed)
    this._destroyGhostElement();
    this.destroy();
  }

  /**
   * Cleanup interact.js instances and ghost element.
   */
  destroy(): void {
    if (this._windowElement) {
      interact(this._windowElement).unset();
    }
    if (this._titleBarElement) {
      this._titleBarElement.removeEventListener('keydown', this._boundOnKeydown);
      interact(this._titleBarElement).unset();
    }
    // Clean up ghost element
    this._destroyGhostElement();
    this._isEnabled = false;
  }

  private _enable(): void {
    // Fix 54: Idempotent guard, avoid creating duplicate interact instances
    if (this._isEnabled) {
      return;
    }
    if (!this._windowElement || !this._titleBarElement) return;
    this._isEnabled = true;
    this._initInteractions();
  }

  private _disable(): void {
    this._isEnabled = false;
    // Destroy existing interact instances
    if (this._windowElement) {
      interact(this._windowElement).unset();
    }
    if (this._titleBarElement) {
      this._titleBarElement.removeEventListener('keydown', this._boundOnKeydown);
      interact(this._titleBarElement).unset();
    }
  }

  private _initInteractions(): void {
    if (!this._isEnabled || !this._windowElement || !this._titleBarElement) return;

    // Initialize drag
    this._initDrag();

    // Initialize resize
    this._initResize();

    // Initialize keyboard
    this._initKeyboard();
  }

  private _initDrag(): void {
    if (!this._titleBarElement || !this._draggable) return;

    interact(this._titleBarElement).draggable({
      listeners: {
        start: () => this._onDragStart(),
        move: (event: InteractEvent) => this._onDragMove(event),
        end: () => this._onDragEnd(),
      },
      // Removed allowFrom — title bar element is directly draggable
      // Disable inertia in ghost preview mode to avoid move/end events after ghost is destroyed
      inertia: false,
    });
  }

  private _initResize(): void {
    if (!this._windowElement || !this._resizable) return;

    const minSize = this._getMinSize();
    const margin = this._getMargin();

    interact(this._windowElement).resizable({
      edges: { top: true, right: true, bottom: true, left: true },
      listeners: {
        start: () => this._onResizeStart(),
        move: (event: ResizeEvent) => this._onResizeMove(event),
        end: () => this._onResizeEnd(),
      },
      modifiers: [
        interact.modifiers.restrictSize({
          min: minSize,
          max: {
            width: window.innerWidth - 2 * margin,
            height: window.innerHeight - 2 * margin,
          },
        }),
      ],
      // Disable inertia in ghost preview mode
      inertia: false,
    });
  }

  private _initKeyboard(): void {
    if (!this._titleBarElement) return;

    // Remove previous listener to prevent stacking on re-init (setConfig / enable)
    this._titleBarElement.removeEventListener('keydown', this._boundOnKeydown);
    this._titleBarElement.addEventListener('keydown', this._boundOnKeydown);
  }

  /**
   * Keyboard handler for title bar interactions.
   *
   * - Enter/Space: activate move mode
   * - Arrow keys (in move mode): nudge window position
   * - Escape: exit interaction mode
   */
  private _handleKeydown(event: KeyboardEvent): void {
    // Enter/Space to activate move mode
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this._enterMoveMode();
      return;
    }

    // Arrow keys in move mode
    if (this._state.interactionMode === 'move') {
      const step = event.shiftKey ? 20 : 10;
      let dx = 0;
      let dy = 0;

      switch (event.key) {
        case 'ArrowUp':
          dy = -step;
          break;
        case 'ArrowDown':
          dy = step;
          break;
        case 'ArrowLeft':
          dx = -step;
          break;
        case 'ArrowRight':
          dx = step;
          break;
        case 'Escape':
          event.preventDefault();
          this._exitInteractionMode();
          return;
        default:
          return;
      }

      event.preventDefault(); // Prevent page scroll

      const windowElement = this._windowElement;
      if (!windowElement) return;
      const rect = windowElement.getBoundingClientRect();
      const margin = this._getMargin();
      const newX = Math.max(margin, Math.min(rect.left + dx, window.innerWidth - rect.width - margin));
      const newY = Math.max(margin, Math.min(rect.top + dy, window.innerHeight - rect.height - margin));

      this.onPositionChange?.(newX, newY);
    }
  }

  private _enterMoveMode(): void {
    this._state = { ...this._state, interactionMode: 'move' };
    this._titleBarElement?.setAttribute('aria-grabbed', 'true');
    this._host.requestUpdate();
  }

  private _enterResizeMode(): void {
    this._state = { ...this._state, interactionMode: 'resize' };
    this._host.requestUpdate();
  }

  private _exitInteractionMode(): void {
    this._state = { ...this._state, interactionMode: 'none' };
    this._titleBarElement?.setAttribute('aria-grabbed', 'false');
    this._host.requestUpdate();
  }

  private _onDragStart(): void {
    this._state = { ...this._state, isDragging: true };
    this._windowElement?.classList.add('dragging');

    // Cache margin (avoid repeated getComputedStyle calls during move)
    this._cachedMargin = this._getMargin();

    // Synchronously create ghost preview element (ensure subsequent move event dx/dy are not lost)
    this._createGhostElement();
    // Reset cumulative offset
    this._ghostDragOffset = { x: 0, y: 0 };

    // Defer Lit render to next frame to avoid racing with ghost creation in the same frame
    requestAnimationFrame(() => this._host.requestUpdate());
  }

  private _onDragMove(event: InteractEvent): void {
    if (!this._windowElement || !this._ghostElement || !this._ghostStartRect) return;

    const margin = this._cachedMargin;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // Cumulative offset
    this._ghostDragOffset.x += event.dx;
    this._ghostDragOffset.y += event.dy;

    // Compute constrained offset
    let offsetX = this._ghostDragOffset.x;
    let offsetY = this._ghostDragOffset.y;

    const { left, top, width, height } = this._ghostStartRect;
    const newLeft = left + offsetX;
    const newTop = top + offsetY;

    // Clamp to viewport
    const clampedLeft = Math.max(margin, Math.min(newLeft, viewport.width - width - margin));
    const clampedTop = Math.max(margin, Math.min(newTop, viewport.height - height - margin));

    // Update cumulative offset to the clamped value (prevent continued accumulation after hitting the boundary)
    this._ghostDragOffset.x = clampedLeft - left;
    this._ghostDragOffset.y = clampedTop - top;

    // Only update the ghost CSS transform (GPU-accelerated, zero rendering overhead)
    this._ghostElement.style.transform = `translate3d(${this._ghostDragOffset.x}px, ${this._ghostDragOffset.y}px, 0)`;
  }

  private _onDragEnd(): void {
    this._state = { ...this._state, isDragging: false };
    this._windowElement?.classList.remove('dragging');

    // Commit final position (exactly one Lit render)
    if (this._ghostStartRect && this._ghostElement) {
      const finalX = this._ghostStartRect.left + this._ghostDragOffset.x;
      const finalY = this._ghostStartRect.top + this._ghostDragOffset.y;
      this.onPositionChange?.(finalX, finalY);
    }

    // Destroy ghost
    this._destroyGhostElement();
    this._host.requestUpdate();

    // Fix 53: Handle deferred config update (only when no interaction is in progress)
    if (this._pendingConfig && !this._state.isDragging && !this._state.isResizing) {
      const config = this._pendingConfig;
      this._pendingConfig = undefined;
      this.setConfig(config);
    }
  }

  private _onResizeStart(): void {
    this._state = { ...this._state, isResizing: true };
    this._windowElement?.classList.add('resizing');

    // Cache margin (avoid repeated getComputedStyle calls during move)
    this._cachedMargin = this._getMargin();

    // Synchronously create ghost preview element
    this._createGhostElement();

    // Defer Lit render to next frame to avoid racing with ghost creation in the same frame
    requestAnimationFrame(() => this._host.requestUpdate());
  }

  private _onResizeMove(event: ResizeEvent): void {
    if (!this._windowElement || !this._ghostElement || !this._ghostStartRect) return;

    const { width, height } = event.rect;
    const margin = this._cachedMargin;
    const edges = event.edges;

    // Compute ghost position offset (left/top edge resize also changes position)
    let offsetX = 0;
    let offsetY = 0;

    if (edges?.left || edges?.top) {
      const newLeft = edges.left ? event.rect.left : this._ghostStartRect.left;
      const newTop = edges.top ? event.rect.top : this._ghostStartRect.top;

      // Clamp to viewport
      const clampedLeft = Math.max(margin, Math.min(newLeft, window.innerWidth - width - margin));
      const clampedTop = Math.max(margin, Math.min(newTop, window.innerHeight - height - margin));

      offsetX = clampedLeft - this._ghostStartRect.left;
      offsetY = clampedTop - this._ghostStartRect.top;
    }

    // Update ghost size and position (GPU-accelerated)
    this._ghostElement.style.width = `${width}px`;
    this._ghostElement.style.height = `${height}px`;
    this._ghostElement.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
  }

  private _onResizeEnd(): void {
    this._state = { ...this._state, isResizing: false };
    this._windowElement?.classList.remove('resizing');

    // Commit final size and position (exactly one Lit render)
    if (this._ghostElement && this._ghostStartRect) {
      const ghostRect = this._ghostElement.getBoundingClientRect();
      const finalWidth = this._ghostElement.offsetWidth;
      const finalHeight = this._ghostElement.offsetHeight;
      const finalX = ghostRect.left;
      const finalY = ghostRect.top;

      // Commit position first (if changed), then size
      if (finalX !== this._ghostStartRect.left || finalY !== this._ghostStartRect.top) {
        this.onPositionChange?.(finalX, finalY);
      }
      this.onSizeChange?.(finalWidth, finalHeight);
    }

    // Destroy ghost
    this._destroyGhostElement();
    this._host.requestUpdate();

    // Fix 53: Handle deferred config update (only when no interaction is in progress)
    if (this._pendingConfig && !this._state.isDragging && !this._state.isResizing) {
      const config = this._pendingConfig;
      this._pendingConfig = undefined;
      this.setConfig(config);
    }
  }

  private _getMargin(): number {
    if (!this._windowElement) return 20;
    const styles = getComputedStyle(this._windowElement);
    const value = styles.getPropertyValue('--rtc-window-margin');
    return parseInt(value) || 20;
  }

  private _getMinSize(): { width: number; height: number } {
    if (!this._windowElement) return { width: 350, height: 520 };
    const styles = getComputedStyle(this._windowElement);
    return {
      width: parseInt(styles.getPropertyValue('--rtc-window-min-width')) || 350,
      height: parseInt(styles.getPropertyValue('--rtc-window-min-height')) || 520,
    };
  }

  /**
   * Create Ghost preview element
   *
   * Creates a lightweight dashed-border element in document.body
   * to provide visual feedback during drag/resize, avoiding Lit re-renders.
   */
  private _createGhostElement(): void {
    if (!this._windowElement) return;

    // Clean up any pre-existing ghost (defensive programming)
    this._destroyGhostElement();

    const rect = this._windowElement.getBoundingClientRect();
    const styles = getComputedStyle(this._windowElement);

    this._ghostStartRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };

    const ghost = document.createElement('div');
    ghost.className = 'rtc-window-ghost';
    ghost.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px dashed ${styles.borderColor || 'var(--rtc-color-primary, #007acc)'};
      border-radius: ${styles.borderRadius || '8px'};
      background: transparent;
      pointer-events: none;
      z-index: ${styles.zIndex || '9999'};
      box-sizing: border-box;
      will-change: transform, width, height;
    `;

    document.body.appendChild(ghost);
    this._ghostElement = ghost;
  }

  /**
   * Destroy Ghost preview element
   */
  private _destroyGhostElement(): void {
    if (this._ghostElement) {
      this._ghostElement.remove();
      this._ghostElement = undefined;
    }
    this._ghostStartRect = undefined;
    this._ghostDragOffset = { x: 0, y: 0 };
  }
}
