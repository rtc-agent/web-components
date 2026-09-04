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
  onViewportTooSmall?: () => void;

  private _host: ReactiveControllerHost;
  private _windowElement?: HTMLElement;
  private _titleBarElement?: HTMLElement;
  private _resizeHandles: HTMLElement[] = [];
  private _liveRegion?: HTMLElement;

  private _state: InteractionState = {
    isDragging: false,
    isResizing: false,
    interactionMode: 'none',
  };

  private _isEnabled = false;
  private _prefersReducedMotion: boolean;
  private _boundHandleResize: () => void;

  constructor(host: ReactiveControllerHost) {
    this._host = host;
    this._prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._boundHandleResize = this._handleViewportResize.bind(this);

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

    // Listen for reduced motion preference changes
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      this._prefersReducedMotion = e.matches;
    });
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
    window.addEventListener('resize', this._boundHandleResize);
  }

  hostDisconnected(): void {
    window.removeEventListener('resize', this._boundHandleResize);
    this.destroy();
  }

  /**
   * Cleanup interact.js instances.
   */
  destroy(): void {
    if (this._windowElement) {
      interact(this._windowElement).unset();
    }
    if (this._titleBarElement) {
      interact(this._titleBarElement).unset();
    }
    this._isEnabled = false;
  }

  private _enable(): void {
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
    if (!this._titleBarElement) return;

    interact(this._titleBarElement).draggable({
      listeners: {
        start: () => this._onDragStart(),
        move: (event: InteractEvent) => this._onDragMove(event),
        end: () => this._onDragEnd(),
      },
      // Removed allowFrom — title bar element is directly draggable
      inertia: !this._prefersReducedMotion,
    });
  }

  private _initResize(): void {
    if (!this._windowElement) return;

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
      inertia: !this._prefersReducedMotion,
    });
  }

  private _initKeyboard(): void {
    if (!this._titleBarElement) return;

    this._titleBarElement.addEventListener('keydown', (event: KeyboardEvent) => {
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

        const rect = this._windowElement!.getBoundingClientRect();
        const margin = this._getMargin();
        const newX = Math.max(margin, Math.min(rect.left + dx, window.innerWidth - rect.width - margin));
        const newY = Math.max(margin, Math.min(rect.top + dy, window.innerHeight - rect.height - margin));

        this.onPositionChange?.(newX, newY);
      }
    });
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
    this._host.requestUpdate();
  }

  private _onDragMove(event: InteractEvent): void {
    if (!this._windowElement) return;

    const margin = this._getMargin();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const rect = this._windowElement.getBoundingClientRect();

    // Calculate new position
    let x = rect.left + event.dx;
    let y = rect.top + event.dy;

    // Constrain to viewport
    x = Math.max(margin, Math.min(x, viewport.width - rect.width - margin));
    y = Math.max(margin, Math.min(y, viewport.height - rect.height - margin));

    // Delegate to WindowStateController via callback
    this.onPositionChange?.(x, y);
  }

  private _onDragEnd(): void {
    this._state = { ...this._state, isDragging: false };
    this._windowElement?.classList.remove('dragging');
    this._host.requestUpdate();
  }

  private _onResizeStart(): void {
    this._state = { ...this._state, isResizing: true };
    this._windowElement?.classList.add('resizing');
    this._host.requestUpdate();
  }

  private _onResizeMove(event: ResizeEvent): void {
    if (!this._windowElement) return;

    const { width, height } = event.rect;
    const margin = this._getMargin();

    // When resizing from left/top edges, we must also update position so the
    // opposite edge stays fixed. interact.js adjusts event.rect but does NOT
    // move the element in the DOM — we have to do it ourselves.
    const edges = event.edges;
    if (edges?.left || edges?.top) {
      const rect = this._windowElement.getBoundingClientRect();
      // event.rect.left/top represent the absolute position the resized element
      // should occupy (computed from the initial rect + accumulated deltas).
      const newLeft = edges.left
        ? event.rect.left
        : rect.left;
      const newTop = edges.top
        ? event.rect.top
        : rect.top;

      // Clamp position to viewport
      const clampedLeft = Math.max(margin, Math.min(newLeft, window.innerWidth - width - margin));
      const clampedTop = Math.max(margin, Math.min(newTop, window.innerHeight - height - margin));

      // Apply position to the DOM element directly so the left/top edge
      // follows the cursor during the drag.
      this._windowElement.style.left = `${clampedLeft}px`;
      this._windowElement.style.top = `${clampedTop}px`;

      // Notify state controller
      this.onPositionChange?.(clampedLeft, clampedTop);
    }

    this.onSizeChange?.(width, height);
  }

  private _onResizeEnd(): void {
    this._state = { ...this._state, isResizing: false };
    this._windowElement?.classList.remove('resizing');
    this._host.requestUpdate();
  }

  private _handleViewportResize(): void {
    if (!this._windowElement) return;

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    const minSize = this._getMinSize();

    // Check if viewport too small
    if (viewport.width < minSize.width || viewport.height < minSize.height) {
      this.onViewportTooSmall?.();
      return;
    }

    // Adjust position to keep window in viewport
    const rect = this._windowElement.getBoundingClientRect();
    const margin = this._getMargin();

    let x = rect.left;
    let y = rect.top;
    let needsUpdate = false;

    // Right edge
    if (x + rect.width > viewport.width - margin) {
      x = viewport.width - rect.width - margin;
      needsUpdate = true;
    }

    // Bottom edge
    if (y + rect.height > viewport.height - margin) {
      y = viewport.height - rect.height - margin;
      needsUpdate = true;
    }

    // Left edge
    if (x < margin) {
      x = margin;
      needsUpdate = true;
    }

    // Top edge
    if (y < margin) {
      y = margin;
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.onPositionChange?.(x, y);
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
}
