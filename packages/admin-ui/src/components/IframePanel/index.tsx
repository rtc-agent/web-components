/**
 * Iframe 面板组件
 *
 * 支持按需加载和缓存：
 * - 首次访问时加载 iframe
 * - 切换 tab 时保持已加载的 iframe（移出视口而非隐藏）
 * - 切换回已访问的 tab 时瞬间显示
 * - 支持加载失败和超时（30s）错误处理，可点击重试
 *
 * 使用方式：
 * - 在父组件中为每个可能的 iframe 渲染一个 IframePanel
 * - 通过 visible 属性控制显示/隐藏
 * - 只有 visible=true 的 iframe 才会被加载
 */

import { useIntl } from '@umijs/max';
import { Button, Result, Spin, theme } from 'antd';
import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { iframeCacheManager } from '@/utils/iframe-cache';

// iframe 加载超时时间（毫秒）
const IFRAME_LOAD_TIMEOUT = 30_000;

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
  const intl = useIntl();
  const containerRef = useRef<HTMLDivElement>(null);
  // 如果已有缓存，初始 loading 为 false
  const [loading, setLoading] = useState(
    () => !iframeCacheManager.getCachedIframe(cacheKey),
  );
  // 加载错误类型：null=正常，'loadFailed'=加载失败，'timeout'=超时
  const [error, setError] = useState<'loadFailed' | 'timeout' | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理超时计时器
  const clearTimer = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  // 创建并挂载 iframe
  const createIframe = useCallback(() => {
    if (!containerRef.current) return;

    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.title = title;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.allowFullscreen = true;

    // 防止 onload/onerror/timeout 多次触发导致状态混乱
    let isResolved = false;

    iframe.onload = () => {
      if (isResolved) return;
      isResolved = true;
      clearTimer();
      setLoading(false);
      setError(null);
    };

    iframe.onerror = () => {
      if (isResolved) return;
      isResolved = true;
      clearTimer();
      // 移除加载失败的 iframe DOM 节点
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      iframeRef.current = null;
      setLoading(false);
      setError('loadFailed');
    };

    // 启动超时计时器
    clearTimer();
    timeoutTimerRef.current = setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      // 超时：移除可能还在加载中的 iframe
      if (iframeRef.current?.parentNode) {
        iframeRef.current.parentNode.removeChild(iframeRef.current);
      }
      iframeRef.current = null;
      setLoading(false);
      setError('timeout');
    }, IFRAME_LOAD_TIMEOUT);

    containerRef.current.appendChild(iframe);
    iframeRef.current = iframe;

    // 缓存 iframe DOM 并标记为已访问
    iframeCacheManager.cacheIframe(cacheKey, iframe);
    iframeCacheManager.markVisited(cacheKey);
  }, [cacheKey, src, title, clearTimer]);

  // 重试：清除错误状态，重新创建 iframe
  const handleRetry = useCallback(() => {
    // 防御性清理：确保旧 iframe 已移除
    if (iframeRef.current?.parentNode) {
      iframeRef.current.parentNode.removeChild(iframeRef.current);
    }
    iframeRef.current = null;
    setError(null);
    setLoading(true);
    // createIframe 会覆盖缓存中可能残留的失效条目
    createIframe();
  }, [createIframe]);

  // 检查是否有缓存的 iframe，或创建新的
  useEffect(() => {
    const cachedIframe = iframeCacheManager.getCachedIframe(cacheKey);

    if (cachedIframe && containerRef.current) {
      // 验证缓存有效性：若 iframe 已从 DOM 中移除（加载失败被清理），视为缓存失效
      const isCacheValid = cachedIframe.parentNode != null;

      if (isCacheValid) {
        if (cachedIframe.parentNode !== containerRef.current) {
          containerRef.current.appendChild(cachedIframe);
        }
        iframeRef.current = cachedIframe as HTMLIFrameElement;
        // 检查 iframe 是否已加载完成，避免对已完成的 iframe 显示 loading
        const iframe = cachedIframe as HTMLIFrameElement;
        const isLoaded = iframe.contentDocument?.readyState === 'complete';
        setLoading(!isLoaded);
        setError(null);
      } else if (visible) {
        // 缓存失效且当前可见，重新创建
        createIframe();
      }
      // 缓存失效但不可见时不做操作，等 visible 变为 true 时再创建
    } else if (visible && !iframeRef.current) {
      // 没有缓存（可能被销毁了）且未加载，创建新 iframe
      createIframe();
    }

    // 组件卸载时清理引用和计时器（但不销毁 iframe，由缓存管理器负责）
    return () => {
      iframeRef.current = null;
      clearTimer();
    };
  }, [cacheKey, src, title, visible, createIframe, clearTimer]);

  const loadingText = intl.formatMessage({
    id: 'common.loading',
    defaultMessage: '加载中...',
  });

  // 错误态：显示错误提示与重试按钮
  if (error) {
    const errorTitle =
      error === 'timeout'
        ? intl.formatMessage({
            id: 'dashboard.timeout',
            defaultMessage: '加载超时',
          })
        : intl.formatMessage({
            id: 'dashboard.loadFailed',
            defaultMessage: '加载失败',
          });

    const retryText = intl.formatMessage({
      id: 'dashboard.retry',
      defaultMessage: '点击重试',
    });

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: token.colorBgLayout,
        }}
      >
        <Result
          status="error"
          title={errorTitle}
          extra={
            <Button type="primary" onClick={handleRetry}>
              {retryText}
            </Button>
          }
        />
      </div>
    );
  }

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
          <Spin size="large" tip={loadingText} />
        </div>
      )}
    </div>
  );
};

export default IframePanel;
