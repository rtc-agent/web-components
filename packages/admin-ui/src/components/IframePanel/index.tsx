/**
 * Iframe 面板组件
 *
 * 支持按需加载和缓存：
 * - 首次访问时加载 iframe
 * - 切换 tab 时保持已加载的 iframe（移出视口而非隐藏）
 * - 切换回已访问的 tab 时瞬间显示
 *
 * 使用方式：
 * - 在父组件中为每个可能的 iframe 渲染一个 IframePanel
 * - 通过 visible 属性控制显示/隐藏
 * - 只有 visible=true 的 iframe 才会被加载
 */

import { Spin, theme } from 'antd';
import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { iframeCacheManager } from '@/utils/iframe-cache';

interface IframePanelProps {
  /** 缓存 key（通常是路由路径或 dashboard 类型） */
  cacheKey: string;
  /** iframe 源地址 */
  src: string;
  /** iframe 标题 */
  title: string;
  /** 是否可见（控制显示/隐藏） */
  visible: boolean;
}

const IframePanel: FC<IframePanelProps> = ({
  cacheKey,
  src,
  title,
  visible,
}) => {
  const { token } = theme.useToken();
  const containerRef = useRef<HTMLDivElement>(null);
  // 如果已有缓存，初始 loading 为 false
  const [loading, setLoading] = useState(
    () => !iframeCacheManager.getCachedIframe(cacheKey),
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // 检查是否有缓存的 iframe
  useEffect(() => {
    const cachedIframe = iframeCacheManager.getCachedIframe(cacheKey);

    if (cachedIframe && containerRef.current) {
      // 有缓存，检查是否已经在 DOM 中
      if (cachedIframe.parentNode !== containerRef.current) {
        containerRef.current.appendChild(cachedIframe);
      }
      iframeRef.current = cachedIframe as HTMLIFrameElement;
      setLoading(false);
    } else if (visible && !iframeRef.current) {
      // 没有缓存（可能被销毁了）且未加载，创建新 iframe
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = title;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.allowFullscreen = true;

      iframe.onload = () => {
        setLoading(false);
      };

      if (containerRef.current) {
        containerRef.current.appendChild(iframe);
        iframeRef.current = iframe;

        // 缓存 iframe DOM
        iframeCacheManager.cacheIframe(cacheKey, iframe);
        iframeCacheManager.markVisited(cacheKey);
      }
    }

    // 组件卸载时清理引用（但不销毁 iframe，由缓存管理器负责）
    return () => {
      iframeRef.current = null;
    };
  }, [cacheKey, src, title, visible]);

  return (
    <div
      ref={containerRef}
      style={{
        // 使用 position + visibility 而非 display，避免 iframe 尺寸为 0
        position: visible ? 'relative' : 'absolute',
        visibility: visible ? 'visible' : 'hidden',
        width: visible ? '100%' : '100%',
        height: visible ? '100%' : '100%',
        top: visible ? undefined : '-9999px',
        left: visible ? undefined : '-9999px',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: visible ? 1 : -1,
      }}
    >
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: token.colorBgLayout,
            zIndex: 1,
          }}
        >
          <Spin size="large" tip="加载中..." />
        </div>
      )}
    </div>
  );
};

export default IframePanel;
