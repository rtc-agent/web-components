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

const log = createLogger('WindowInteraction');

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

  /** 窗口配置 */
  private _draggable = true;
  private _resizable = true;

  /** Ghost 预览元素（拖动/缩放期间的轻量级视觉反馈） */
  private _ghostElement?: HTMLElement;
  /** Ghost 起始状态（用于计算 delta） */
  private _ghostStartRect?: { left: number; top: number; width: number; height: number };
  /** 累计拖动偏移（drag 期间） */
  private _ghostDragOffset = { x: 0, y: 0 };
  /** 缓存的 margin 值（拖动/缩放期间复用，避免重复调用 getComputedStyle） */
  private _cachedMargin = 20;

  /** Bound keydown handler — stored so it can be removed on cleanup. */
  private _boundOnKeydown = (event: KeyboardEvent) => this._handleKeydown(event);

  constructor(host: ReactiveControllerHost, config?: { draggable?: boolean; resizable?: boolean }) {
    this._host = host;
    this._draggable = config?.draggable ?? true;
    this._resizable = config?.resizable ?? true;

    // selectstart 事件拦截在 enable 时注册

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

  /** 更新配置 */
  setConfig(config: { draggable?: boolean; resizable?: boolean }): void {
    this._draggable = config.draggable ?? true;
    this._resizable = config.resizable ?? true;
    log.debug('setConfig:', {draggable: this._draggable, resizable: this._resizable});

    // 先销毁现有的 interact 实例
    if (this._windowElement) {
      interact(this._windowElement).unset();
    }
    if (this._titleBarElement) {
      interact(this._titleBarElement).unset();
    }

    // 重新初始化交互（如果已启用）
    if (this._isEnabled) {
      this._initInteractions();
    }
  }

  /** 是否允许拖拽 */
  get draggable(): boolean {
    return this._draggable;
  }

  /** 是否允许调整大小 */
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
    // 确保 ghost 元素被清理（防止组件被动态移除时泄漏）
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
    // 清理 ghost 元素
    this._destroyGhostElement();
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
      // Ghost 预览模式下禁用 inertia，避免 ghost 销毁后仍有 move/end 事件
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
      // Ghost 预览模式下禁用 inertia
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

    // 缓存 margin（避免在 move 期间重复调用 getComputedStyle）
    this._cachedMargin = this._getMargin();

    // 同步创建 ghost 预览元素（确保不丢失后续 move 事件的 dx/dy）
    this._createGhostElement();
    // 重置累计偏移
    this._ghostDragOffset = { x: 0, y: 0 };

    // 延迟 Lit 渲染到下一帧，避免与 ghost 创建在同一帧内竞争
    requestAnimationFrame(() => this._host.requestUpdate());
  }

  private _onDragMove(event: InteractEvent): void {
    if (!this._windowElement || !this._ghostElement || !this._ghostStartRect) return;

    const margin = this._cachedMargin;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // 累计偏移
    this._ghostDragOffset.x += event.dx;
    this._ghostDragOffset.y += event.dy;

    // 计算约束后的偏移
    let offsetX = this._ghostDragOffset.x;
    let offsetY = this._ghostDragOffset.y;

    const { left, top, width, height } = this._ghostStartRect;
    const newLeft = left + offsetX;
    const newTop = top + offsetY;

    // 约束到视口
    const clampedLeft = Math.max(margin, Math.min(newLeft, viewport.width - width - margin));
    const clampedTop = Math.max(margin, Math.min(newTop, viewport.height - height - margin));

    // 更新累计偏移为约束后的值（防止超出后继续累加）
    this._ghostDragOffset.x = clampedLeft - left;
    this._ghostDragOffset.y = clampedTop - top;

    // 只更新 ghost 的 CSS transform（GPU 加速，零渲染开销）
    this._ghostElement.style.transform = `translate3d(${this._ghostDragOffset.x}px, ${this._ghostDragOffset.y}px, 0)`;
  }

  private _onDragEnd(): void {
    this._state = { ...this._state, isDragging: false };
    this._windowElement?.classList.remove('dragging');

    // 提交最终位置（恰好一次 Lit 渲染）
    if (this._ghostStartRect && this._ghostElement) {
      const finalX = this._ghostStartRect.left + this._ghostDragOffset.x;
      const finalY = this._ghostStartRect.top + this._ghostDragOffset.y;
      this.onPositionChange?.(finalX, finalY);
    }

    // 销毁 ghost
    this._destroyGhostElement();
    this._host.requestUpdate();
  }

  private _onResizeStart(): void {
    this._state = { ...this._state, isResizing: true };
    this._windowElement?.classList.add('resizing');

    // 缓存 margin（避免在 move 期间重复调用 getComputedStyle）
    this._cachedMargin = this._getMargin();

    // 同步创建 ghost 预览元素
    this._createGhostElement();

    // 延迟 Lit 渲染到下一帧，避免与 ghost 创建在同一帧内竞争
    requestAnimationFrame(() => this._host.requestUpdate());
  }

  private _onResizeMove(event: ResizeEvent): void {
    if (!this._windowElement || !this._ghostElement || !this._ghostStartRect) return;

    const { width, height } = event.rect;
    const margin = this._cachedMargin;
    const edges = event.edges;

    // 计算 ghost 的位置偏移（left/top 边缘 resize 时位置也会变化）
    let offsetX = 0;
    let offsetY = 0;

    if (edges?.left || edges?.top) {
      const newLeft = edges.left ? event.rect.left : this._ghostStartRect.left;
      const newTop = edges.top ? event.rect.top : this._ghostStartRect.top;

      // 约束到视口
      const clampedLeft = Math.max(margin, Math.min(newLeft, window.innerWidth - width - margin));
      const clampedTop = Math.max(margin, Math.min(newTop, window.innerHeight - height - margin));

      offsetX = clampedLeft - this._ghostStartRect.left;
      offsetY = clampedTop - this._ghostStartRect.top;
    }

    // 更新 ghost 尺寸和位置（GPU 加速）
    this._ghostElement.style.width = `${width}px`;
    this._ghostElement.style.height = `${height}px`;
    this._ghostElement.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
  }

  private _onResizeEnd(): void {
    this._state = { ...this._state, isResizing: false };
    this._windowElement?.classList.remove('resizing');

    // 提交最终尺寸和位置（恰好一次 Lit 渲染）
    if (this._ghostElement && this._ghostStartRect) {
      const ghostRect = this._ghostElement.getBoundingClientRect();
      const finalWidth = this._ghostElement.offsetWidth;
      const finalHeight = this._ghostElement.offsetHeight;
      const finalX = ghostRect.left;
      const finalY = ghostRect.top;

      // 先提交位置（如果有变化），再提交尺寸
      if (finalX !== this._ghostStartRect.left || finalY !== this._ghostStartRect.top) {
        this.onPositionChange?.(finalX, finalY);
      }
      this.onSizeChange?.(finalWidth, finalHeight);
    }

    // 销毁 ghost
    this._destroyGhostElement();
    this._host.requestUpdate();
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
   * 创建 Ghost 预览元素
   *
   * 在 document.body 中创建一个轻量级的虚线边框元素，
   * 用于在拖动/缩放期间提供视觉反馈，避免触发 Lit 重渲染。
   */
  private _createGhostElement(): void {
    if (!this._windowElement) return;

    // 清理可能存在的旧 ghost（防御性编程）
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
   * 销毁 Ghost 预览元素
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
