/**
 * Dashboard 容器组件
 *
 * 统一管理所有 dashboard iframe：
 * - Jaeger/Pyroscope 各自一个 iframe
 * - Grafana 的每个子 tab 一个独立的 iframe（通过 CSS 控制显示/隐藏）
 * - 所有 iframe 一旦加载就保持缓存，切换时瞬间显示
 * - 支持超时销毁：长时间不访问的 iframe 自动销毁（当前使用的除外）
 */

import { useLocation } from '@umijs/max';
import type { FC } from 'react';
import { useEffect } from 'react';
import IframePanel from '@/components/IframePanel';
import { iframeCacheManager } from '@/utils/iframe-cache';

// 所有 dashboard 配置
const DASHBOARD_CONFIGS = [
  {
    pathPrefix: '/dashboard/jaeger',
    cacheKey: 'jaeger',
    src: '/api/jaeger/',
    title: 'Jaeger Tracing',
  },
  {
    pathPrefix: '/dashboard/pyroscope',
    cacheKey: 'pyroscope',
    src: '/api/pyroscope/',
    title: 'Pyroscope Profiling',
  },
  // Grafana 的子 tab
  {
    pathPrefix: '/dashboard/grafana/rtc-agent',
    cacheKey: 'grafana-rtc-agent',
    src: '/api/grafana/d/rtc-agent/rtc-agent?orgId=1&refresh=30s',
    title: 'Grafana - rtc-agent',
  },
  {
    pathPrefix: '/dashboard/grafana/go-runtime',
    cacheKey: 'grafana-go-runtime',
    src: '/api/grafana/d/go-runtime/go-runtime?orgId=1&refresh=30s',
    title: 'Grafana - go-runtime',
  },
  {
    pathPrefix: '/dashboard/grafana/http-server',
    cacheKey: 'grafana-http-server',
    src: '/api/grafana/d/http-server/http-server?orgId=1&refresh=30s',
    title: 'Grafana - http-server',
  },
  {
    pathPrefix: '/dashboard/grafana/error-feedback-overview',
    cacheKey: 'grafana-error-feedback-overview',
    src: '/api/grafana/d/error-feedback-overview/error-feedback-overview?orgId=1&refresh=30s',
    title: 'Grafana - error-feedback',
  },
  {
    pathPrefix: '/dashboard/grafana/logs-overview',
    cacheKey: 'grafana-logs-overview',
    src: '/api/grafana/d/logs-overview/logs-overview?orgId=1&refresh=30s',
    title: 'Grafana - logs',
  },
  {
    pathPrefix: '/dashboard/grafana/oss3-overview',
    cacheKey: 'grafana-oss3-overview',
    src: '/api/grafana/d/oss3-overview/oss3-overview?orgId=1&refresh=30s',
    title: 'Grafana - oss3',
  },
  {
    pathPrefix: '/dashboard/grafana/minio-overview',
    cacheKey: 'grafana-minio-overview',
    src: '/api/grafana/d/minio-overview/minio-overview?orgId=1&refresh=30s',
    title: 'Grafana - minio',
  },
  {
    pathPrefix: '/dashboard/grafana/system-health-watchdog',
    cacheKey: 'grafana-system-health-watchdog',
    src: '/api/grafana/d/system-health-watchdog/system-health-watchdog?orgId=1&refresh=30s',
    title: 'Grafana - health-watchdog',
  },
];

const DashboardContainer: FC = () => {
  const location = useLocation();
  const currentPath = location.pathname;

  // 找到当前活跃的 dashboard
  const activeConfig = DASHBOARD_CONFIGS.find((config) =>
    currentPath.startsWith(config.pathPrefix),
  );

  // 设置当前活跃的 iframe key
  useEffect(() => {
    if (activeConfig) {
      iframeCacheManager.setActiveKey(activeConfig.cacheKey);
    }
  }, [activeConfig?.cacheKey]);

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 140px)' }}>
      {DASHBOARD_CONFIGS.map((config) => {
        const isVisible = currentPath.startsWith(config.pathPrefix);

        return (
          <IframePanel
            key={config.cacheKey}
            cacheKey={config.cacheKey}
            src={config.src}
            title={config.title}
            visible={isVisible}
          />
        );
      })}
    </div>
  );
};

export default DashboardContainer;
