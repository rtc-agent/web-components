/**
 * Iframe 全局缓存管理器
 *
 * 解决路由切换时 iframe 被卸载的问题：
 * - 在应用顶层缓存所有已访问的 iframe DOM 节点
 * - 路由切换时，只是移动 DOM 节点（不销毁）
 * - 切换回已访问的页面时，瞬间显示
 * - 支持超时销毁：长时间不访问的 iframe 自动销毁（当前使用的除外）
 */

// 默认超时时间：5 分钟
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

interface CachedIframe {
  element: HTMLElement;
  lastAccessTime: number;
}

class IframeCacheManager {
  // 存储已访问的 iframe DOM 节点和访问时间
  private iframeCache = new Map<string, CachedIframe>();

  // 存储已访问的页面 key
  private visitedKeys = new Set<string>();

  // 当前活跃的 iframe key（不能销毁）
  private activeKey: string | null = null;

  // 超时清理定时器
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // 超时时间（毫秒）
  private timeout: number = DEFAULT_TIMEOUT;

  constructor() {
    // 每分钟检查一次超时
    this.startCleanupTimer();
  }

  /**
   * 设置当前活跃的 iframe key
   */
  setActiveKey(key: string | null) {
    this.activeKey = key;
    if (key) {
      // 更新访问时间
      const cached = this.iframeCache.get(key);
      if (cached) {
        cached.lastAccessTime = Date.now();
      }
    }
  }

  /**
   * 标记页面为已访问
   */
  markVisited(key: string) {
    this.visitedKeys.add(key);
    // 更新访问时间
    const cached = this.iframeCache.get(key);
    if (cached) {
      cached.lastAccessTime = Date.now();
    }
  }

  /**
   * 检查页面是否已访问
   */
  hasVisited(key: string): boolean {
    return this.visitedKeys.has(key);
  }

  /**
   * 缓存 iframe DOM 节点
   */
  cacheIframe(key: string, element: HTMLElement) {
    this.iframeCache.set(key, {
      element,
      lastAccessTime: Date.now(),
    });
  }

  /**
   * 获取缓存的 iframe DOM 节点
   */
  getCachedIframe(key: string): HTMLElement | null {
    const cached = this.iframeCache.get(key);
    if (cached) {
      // 更新访问时间
      cached.lastAccessTime = Date.now();
      return cached.element;
    }
    return null;
  }

  /**
   * 获取所有已访问的 key
   */
  getVisitedKeys(): string[] {
    return Array.from(this.visitedKeys);
  }

  /**
   * 检查 iframe 是否应该被销毁
   */
  private shouldDestroy(key: string): boolean {
    // 当前活跃的不能销毁
    if (key === this.activeKey) {
      return false;
    }

    const cached = this.iframeCache.get(key);
    if (!cached) {
      return false;
    }

    // 检查是否超时
    const now = Date.now();
    return now - cached.lastAccessTime > this.timeout;
  }

  /**
   * 清理超时的 iframe
   */
  private cleanup() {
    const keysToDestroy: string[] = [];

    // 找出需要销毁的 iframe
    for (const key of this.iframeCache.keys()) {
      if (this.shouldDestroy(key)) {
        keysToDestroy.push(key);
      }
    }

    // 销毁
    for (const key of keysToDestroy) {
      const cached = this.iframeCache.get(key);
      if (cached) {
        // 从 DOM 中移除
        if (cached.element.parentNode) {
          cached.element.parentNode.removeChild(cached.element);
        }
        this.iframeCache.delete(key);
        this.visitedKeys.delete(key);
      }
    }
  }

  /**
   * 启动定时清理
   */
  private startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // 每分钟检查一次
  }

  /**
   * 停止定时清理
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 设置超时时间
   */
  setTimeout(timeout: number) {
    this.timeout = timeout;
  }

  /**
   * 清除缓存（用于登出等场景）
   */
  clear() {
    // 从 DOM 中移除所有 iframe
    for (const cached of this.iframeCache.values()) {
      if (cached.element.parentNode) {
        cached.element.parentNode.removeChild(cached.element);
      }
    }
    this.iframeCache.clear();
    this.visitedKeys.clear();
    this.activeKey = null;
    this.stopCleanupTimer();
  }
}

// 全局单例
export const iframeCacheManager = new IframeCacheManager();

/**
 * Hook: 使用 iframe 缓存
 */
export function useIframeCache() {
  return {
    setActiveKey: (key: string | null) => iframeCacheManager.setActiveKey(key),
    markVisited: (key: string) => iframeCacheManager.markVisited(key),
    hasVisited: (key: string) => iframeCacheManager.hasVisited(key),
    cacheIframe: (key: string, element: HTMLElement) =>
      iframeCacheManager.cacheIframe(key, element),
    getCachedIframe: (key: string) => iframeCacheManager.getCachedIframe(key),
    visitedKeys: iframeCacheManager.getVisitedKeys(),
  };
}
